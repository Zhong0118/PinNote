<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import { slide } from "svelte/transition";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { isNativeApp } from "$lib/settings";
  import SourceEditor from "./SourceEditor.svelte";
  import FindBar from "./FindBar.svelte";
  import { ListTodo, Plus, Bell, CheckCheck, X, Copy, Check, Archive, ArrowDownToLine, Heading2, Quote, Code2, Minus, ImagePlus } from 'lucide-svelte';
  import { checklistProgress } from '$lib/checklist';
  import { perfCount, perfTime } from '$lib/perf';
  import { tintedConfetti, tick } from '$lib/celebrate';
  import { motionReduced, popup, reveal } from '$lib/motion';
  import PixelMark from './PixelMark.svelte';

  type Props = {
    value: string;
    onChange: (value: string) => void;
    initialPosition?: {from:number;to:number;scroll:number};
    readonly?: boolean;
    autoFocus?: boolean;
    onReminder?: () => void;
    onArchive?: () => void;
    /** Called synchronously on every document change, before the text is serialized. */
    onEdit?: () => void;
    /** Serialization found nothing new: the last value covers every edit so far. */
    onSettled?: () => void;
  };

  let { value, onChange, initialPosition, readonly = false, autoFocus = false, onReminder, onArchive, onEdit, onSettled }: Props = $props();
  let taskInput = $state('');
  let showTaskInput = $state(false);
  let taskField = $state<HTMLInputElement>();
  let composingTask = false;
  const progress = $derived(checklistProgress(value));
  let layout = $state<HTMLDivElement>();
  let root = $state<HTMLDivElement>();
  let failed = $state(false);
  let disposed = false;
  let updateTimer: ReturnType<typeof setTimeout>;
  let editorInstance: any;
  let editorViewCtxRef: any;
  let serializerCtxRef: any;
  let textSelectionRef: any;
  let imagePicker = $state<HTMLInputElement>();
  let insertOpen = $state(false);
  let insertTrigger = $state<HTMLButtonElement>();
  let editorReady = $state(false);

  // Prevent repeated confetti spam when toggling the final task back and forth.
  let celebratedAll = false;
  let justFinishedAll = $state(false);
  let finishedTimer: ReturnType<typeof setTimeout>;

  // Code block copy overlay positioned outside ProseMirror's DOM.
  let codeHover = $state<{ el: HTMLElement; top: number; right: number; lang: string; copied: boolean } | null>(null);
  let copyTimer: ReturnType<typeof setTimeout>;

  // In-note find bar using CSS Custom Highlight API (never mutates ProseMirror DOM).
  let findOpen = $state(false);
  let findQuery = $state('');
  let findIndex = $state(0);
  let findRanges: Range[] = [];
  let findCount = $state(0);
  let findBar = $state<FindBar>();

  function clearFindHighlights() {
    const cssAny = globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined;
    cssAny?.highlights?.delete('pinnote-find');
    cssAny?.highlights?.delete('pinnote-find-active');
  }
  function applyFindHighlights() {
    clearFindHighlights();
    if (!findRanges.length) return;
    const active = findRanges[findIndex] ?? findRanges[0];
    const cssAny = globalThis.CSS as unknown as { highlights?: Map<string, unknown> } | undefined;
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    if (cssAny?.highlights && HighlightCtor) {
      cssAny.highlights.set('pinnote-find', new HighlightCtor(...findRanges));
      cssAny.highlights.set('pinnote-find-active', new HighlightCtor(active));
    } else if (active) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(active.cloneRange());
    }
    const anchor = active?.startContainer.parentElement;
    anchor?.scrollIntoView({ block: 'nearest', behavior: motionReduced() ? 'auto' : 'smooth' });
  }
  function runFind(q: string, keepIndex = false) {
    findQuery = q;
    findRanges = [];
    const needle = q.trim().toLowerCase();
    const container = root?.querySelector('.editor') ?? root;
    if (!needle || !container) {
      findCount = 0;
      findIndex = 0;
      clearFindHighlights();
      return;
    }
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent ?? '';
      const lower = text.toLowerCase();
      let at = lower.indexOf(needle);
      while (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        findRanges.push(range);
        at = lower.indexOf(needle, at + needle.length);
      }
    }
    findCount = findRanges.length;
    findIndex = findCount ? (keepIndex ? Math.min(findIndex, findCount - 1) : 0) : 0;
    applyFindHighlights();
  }
  function stepFind(delta: number) {
    if (!findRanges.length) return;
    findIndex = (findIndex + delta + findRanges.length) % findRanges.length;
    applyFindHighlights();
  }
  export function openFind() {
    findOpen = true;
    requestAnimationFrame(() => {
      findBar?.focus();
      if (findQuery) runFind(findQuery, true);
    });
  }
  export function closeFind() {
    findOpen = false;
    clearFindHighlights();
  }

  $effect(() => {
    if (progress.total === 0 || progress.done < progress.total) {
      celebratedAll = false;
      justFinishedAll = false;
      clearTimeout(finishedTimer);
    }
  });

  export function focus() {
    if (!editorInstance || disposed || readonly) return;
    try {
      editorInstance.action((ctx: any) => ctx.get(editorViewCtxRef).focus());
    } catch { /* editor still booting */ }
  }

  export function flush() {
    if (!editorInstance || disposed || readonly) return;
    clearTimeout(updateTimer);
    const markdown = perfTime('md.serialize', () => editorInstance.action((ctx: any) =>
      ctx.get(serializerCtxRef)(ctx.get(editorViewCtxRef).state.doc)));
    if (markdown !== value) onChange(markdown);
    else onSettled?.();
  }
  /** Debounced save: waits for typing to pause and for an IME composition to finish. */
  function flushWhenIdle() {
    const composing = editorInstance?.action((ctx: any) => ctx.get(editorViewCtxRef).composing);
    if (composing) { updateTimer = setTimeout(flushWhenIdle, 250); return; }
    flush();
  }
  export function capture() {
    if(!editorInstance || disposed) return;
    const selection=editorInstance.action((ctx:any)=>ctx.get(editorViewCtxRef).state.selection);
    return {from:selection.from,to:selection.to,scroll:root?.scrollTop??0};
  }
  export function clearCompleted() {
    if(!editorInstance || disposed || readonly) return;
    editorInstance.action((ctx:any)=>{
      const view=ctx.get(editorViewCtxRef); const ranges:Array<{from:number;to:number}>=[];
      view.state.doc.descendants((node:any,pos:number)=>{if(node.type.name==='list_item'&&node.attrs.checked===true){ranges.push({from:pos,to:pos+node.nodeSize});return false;}});
      let tr=view.state.tr; for(const range of ranges.reverse())tr=tr.delete(range.from,range.to);
      if(tr.docChanged)view.dispatch(tr); // One transaction, native editor undo restores it.
    });
  }
  export function moveCompletedBottom() {
    if (!editorInstance || disposed || readonly) return;
    editorInstance.action((ctx: any) => {
      const view = ctx.get(editorViewCtxRef);
      const replacements: Array<{ pos: number; node: any }> = [];
      view.state.doc.descendants((node: any, pos: number) => {
        if (node.type.name !== 'bullet_list' && node.type.name !== 'ordered_list') return;
        const children: any[] = [];
        let hasOpen = false, hasDone = false, outOfOrder = false;
        node.forEach((child: any) => {
          const isTask = child.type.name === 'list_item' && child.attrs.checked != null;
          if (isTask) {
            if (child.attrs.checked) hasDone = true;
            else { if (hasDone) outOfOrder = true; hasOpen = true; }
          }
          children.push(child);
        });
        if (!hasOpen || !hasDone || !outOfOrder) return false;
        const open = children.filter(c => !(c.type.name === 'list_item' && c.attrs.checked === true));
        const done = children.filter(c => c.type.name === 'list_item' && c.attrs.checked === true);
        replacements.push({ pos, node: node.type.create(node.attrs, [...open, ...done], node.marks) });
        return false;
      });
      if (!replacements.length) return;
      let tr = view.state.tr;
      for (const r of replacements.reverse()) {
        tr = tr.replaceWith(r.pos, r.pos + r.node.nodeSize, r.node);
      }
      if (tr.docChanged) view.dispatch(tr);
    });
  }
  /** After a to-do is ticked: a pop and a pen stroke; tinted confetti once when the checklist finishes. */
  function celebrateTick(view:any, pos:number) {
    const li=view.nodeDOM(pos) as HTMLElement|null;
    if(!(li instanceof HTMLElement)) return;
    const accent=getComputedStyle(li).getPropertyValue('--pin-accent').trim()||'#2563eb';
    tick(li,accent);
    let total=0,done=0;
    view.state.doc.descendants((node:any)=>{if(node.type.name==='list_item'&&node.attrs.checked!=null){total++;if(node.attrs.checked)done++;}});
    if (total > 0 && done === total) {
      if (!celebratedAll) {
        celebratedAll = true;
        const r = li.getBoundingClientRect();
        tintedConfetti(r.left + 8, r.top + 10, accent);
      }
      if (onArchive) {
        justFinishedAll = true;
        clearTimeout(finishedTimer);
        finishedTimer = setTimeout(() => { justFinishedAll = false; }, 9000);
      }
    }
  }
  function taskKey(event: KeyboardEvent) {
    if(readonly || event.isComposing || !(event.metaKey||event.ctrlKey) || !event.shiftKey || event.key!=='Enter' || !editorInstance) return;
    editorInstance.action((ctx:any)=>{
      const view=ctx.get(editorViewCtxRef); const from=view.state.selection.$from;
      for(let depth=from.depth;depth>0;depth--){const node=from.node(depth);
        if(node.type.name==='list_item'&&node.attrs.checked!=null){event.preventDefault();const pos=from.before(depth);view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...node.attrs,checked:!node.attrs.checked}));if(!node.attrs.checked)celebrateTick(view,pos);return;}
      }
    });
  }
  async function addTask() {
    const text=taskInput.trim();if(!text||!editorInstance||readonly||composingTask)return;
    editorInstance.action((ctx:any)=>{
      const view=ctx.get(editorViewCtxRef);const schema=view.state.schema;
      const item=schema.nodes.list_item.create({checked:false},schema.nodes.paragraph.create(null,schema.text(text)));
      const list=schema.nodes.bullet_list.create(null,item);
      view.dispatch(view.state.tr.insert(view.state.doc.content.size,list).scrollIntoView());
    });
    taskInput='';taskField?.focus();
  }

  function insertBlock(kind: 'task' | 'heading' | 'quote' | 'code' | 'hr') {
    insertOpen = false;
    if (!editorInstance || !editorViewCtxRef || disposed || readonly) return;
    editorInstance.action((ctx: any) => {
      const view = ctx.get(editorViewCtxRef);
      const { state } = view;
      const { schema, selection } = state;
      const para = schema.nodes.paragraph;
      let block: any;
      let cursorOffset = 1;
      if (kind === 'task') {
        const item = schema.nodes.list_item.create({ checked: false }, para.create());
        block = schema.nodes.bullet_list.create(null, item);
        cursorOffset = 3;
      } else if (kind === 'heading') {
        block = schema.nodes.heading.create({ level: 2 });
      } else if (kind === 'quote') {
        block = schema.nodes.blockquote.create(null, para.create());
        cursorOffset = 2;
      } else if (kind === 'code') {
        block = schema.nodes.code_block.create();
      } else if (kind === 'hr') {
        block = schema.nodes.hr.create();
      }
      const from = selection.$from;
      const atEmptyRootPara = from.depth === 1 && from.parent.type === para && from.parent.content.size === 0;
      let tr = state.tr;
      let insertPos: number;
      if (atEmptyRootPara && kind !== 'hr') {
        insertPos = from.before(1);
        tr = tr.replaceWith(insertPos, from.after(1), block);
      } else {
        insertPos = from.depth >= 1 ? from.after(1) : state.doc.content.size;
        if (kind === 'hr') {
          tr = tr.insert(insertPos, [block, para.create()]);
          cursorOffset = block.nodeSize + 1;
        } else {
          tr = tr.insert(insertPos, block);
        }
      }
      if (textSelectionRef) {
        const pos = Math.min(insertPos + cursorOffset, tr.doc.content.size);
        tr = tr.setSelection(textSelectionRef.near(tr.doc.resolve(pos)));
      }
      view.dispatch(tr.scrollIntoView());
      view.focus();
    });
  }

  const insertItems = [
    { kind: 'task', label: '待办项', icon: ListTodo },
    { kind: 'heading', label: '二级标题', icon: Heading2 },
    { kind: 'quote', label: '引用', icon: Quote },
    { kind: 'code', label: '代码块', icon: Code2 },
    { kind: 'hr', label: '分割线', icon: Minus },
  ] as const;

  function handleImagePick(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []).filter(f => f.type.startsWith('image/'));
    input.value = '';
    if (!files.length || !editorInstance || !editorViewCtxRef || disposed || readonly) return;
    editorInstance.action((ctx: any) => {
      const view = ctx.get(editorViewCtxRef);
      for (const file of files) void insertImageFile(view, file);
    });
  }

  function handleHostMouseOver(event: MouseEvent) {
    if (!layout) return;
    const pre = (event.target instanceof Element ? event.target.closest('pre') : null) as HTMLElement | null;
    if (!pre || !root?.contains(pre)) {
      if (codeHover && !(event.target instanceof Element && event.target.closest('.code-bar'))) codeHover = null;
      return;
    }
    if (codeHover?.el === pre) return;
    const box = layout.getBoundingClientRect();
    const r = pre.getBoundingClientRect();
    const code = pre.querySelector('code');
    const langMatch = code?.className.match(/language-([\w-]+)/i);
    codeHover = {
      el: pre,
      top: Math.max(4, r.top - box.top + 6),
      right: Math.max(6, box.right - r.right + 6),
      lang: pre.dataset.language ?? langMatch?.[1] ?? '',
      copied: false,
    };
  }
  async function copyHoveredCode() {
    const hovered = codeHover;
    if (!hovered) return;
    const text = hovered.el.querySelector('code')?.textContent ?? hovered.el.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      if (codeHover !== hovered) return;
      codeHover = { ...codeHover, copied: true };
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { if (codeHover) codeHover = { ...codeHover, copied: false }; }, 1500);
    } catch { /* clipboard unavailable */ }
  }

  onMount(() => {
    const initial = checklistProgress(value);
    if (initial.total > 0 && initial.done === initial.total) celebratedAll = true;
    void setup();

    return () => {
      // Callers flush() before switching notes or closing; flushing here could
      // write this editor's text into whichever note the props now point at.
      disposed = true;
      clearTimeout(updateTimer);
      clearTimeout(finishedTimer);
      clearTimeout(copyTimer);
      clearFindHighlights();
      if (editorInstance) perfCount(readonly ? 'editor.destroy.readonly' : 'editor.destroy');
      void editorInstance?.destroy();
    };
  });

  function handleHostClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Never allow an in-note link to navigate the Tauri webview away from PinNote.
    const link = target.closest('a[href]') as HTMLAnchorElement | null;
    if (link) {
      event.preventDefault();
      const href = link.getAttribute('href')?.trim() ?? '';
      if ((readonly || event.metaKey || event.ctrlKey) && /^(https?:|mailto:)/i.test(href)) {
        void openUrl(href).catch(() => window.open(href, '_blank', 'noopener,noreferrer'));
      }
      return;
    }

    if (readonly) return;
    const li = target.closest('li[data-item-type="task"]') as HTMLElement | null;
    if (!li) return;

    // Leave the first characters of the task available for normal text selection.
    const rect = li.getBoundingClientRect();
    if (event.clientX > rect.left + 19) return;
    event.preventDefault();

    if (!editorInstance || !editorViewCtxRef) return;
    let view: any;
    try {
      view = editorInstance.action((ctx: any) => ctx.get(editorViewCtxRef));
    } catch {
      return;
    }
    if (!view?.state) return;

    // Walk the document to find the matching list_item node by DOM index
    const liElements = root?.querySelectorAll('li[data-item-type="task"]');
    if (!liElements) return;
    const liIndex = Array.from(liElements).indexOf(li);
    if (liIndex < 0) return;

    let count = 0;
    let found = false;
    view.state.doc.descendants((node: any, pos: number) => {
      if (found) return false;
      if (node.type.name === "list_item" && node.attrs.checked != null) {
        if (count === liIndex) {
          const tr = view.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: !node.attrs.checked,
          });
          view.dispatch(tr);
          if (!node.attrs.checked) celebrateTick(view, pos);
          found = true;
          return false;
        }
        count++;
      }
    });
  }

  function resolveAssetSrc(src: string) {
    if (!src.startsWith('assets/')) return src;
    const name = src.slice('assets/'.length);
    const isWin = browser && /Win/.test(navigator.platform);
    return isWin
      ? `http://inkpin-asset.localhost/${encodeURIComponent(name)}`
      : `inkpin-asset://localhost/${encodeURIComponent(name)}`;
  }

  function extFromImageFile(file: File) {
    const byName = file.name.match(/\.(png|jpe?g|webp|gif)$/i)?.[1]?.toLowerCase();
    if (byName) return byName === 'jpeg' ? 'jpg' : byName;
    const byType = file.type.split('/')[1]?.toLowerCase();
    if (byType === 'jpeg') return 'jpg';
    if (byType && ['png', 'jpg', 'webp', 'gif'].includes(byType)) return byType;
    return 'png';
  }

  async function insertImageFile(view: any, file: File) {
    if (!isNativeApp() || readonly) return;
    try {
      const buf = await file.arrayBuffer();
      const rel = await invoke<string>('save_note_image', {
        ext: extFromImageFile(file),
        bytes: Array.from(new Uint8Array(buf)),
      });
      const imageType = view.state.schema.nodes.image;
      if (disposed || readonly || !imageType) return;
      const alt = file.name ? file.name.replace(/\.[^.]+$/, '') : '图片';
      const node = imageType.create({ src: rel, alt, title: '' });
      view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    } catch (err) {
      console.error('Image paste failed:', err);
    }
  }

  async function setup() {
    if (!browser || !root) return;

    try {
      const [
        { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, editorViewOptionsCtx },
        { commonmark },
        { gfm },
        { $prose: prosePlugin },
        { Plugin, TextSelection },
        { history },
      ] = await Promise.all([
        import("@milkdown/kit/core"),
        import("@milkdown/kit/preset/commonmark"),
        import("@milkdown/kit/preset/gfm"),
        import("@milkdown/kit/utils"),
        import("@milkdown/kit/prose/state"),
        import("@milkdown/plugin-history"),
      ]);

      if (disposed || !root) return;
      editorViewCtxRef = editorViewCtx;
      serializerCtxRef = serializerCtx;
      textSelectionRef = TextSelection;

      const createStart = performance.now();
      editorInstance = await Editor.make()
        .config((ctx: any) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, value);
          ctx.update(editorViewOptionsCtx, (options:any)=>({...options,editable:()=>!readonly}));
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(prosePlugin(() => new Plugin({
          props: {
            nodeViews: {
              image: (node: any) => {
                const img = document.createElement('img');
                const sync = (n: any) => {
                  img.src = resolveAssetSrc(String(n.attrs.src ?? ''));
                  img.alt = String(n.attrs.alt ?? '');
                  if (n.attrs.title) img.title = String(n.attrs.title);
                  else img.removeAttribute('title');
                };
                sync(node);
                return {
                  dom: img,
                  update: (next: any) => {
                    if (next.type.name !== 'image') return false;
                    sync(next);
                    return true;
                  },
                };
              },
            },
            handlePaste: (view, event) => {
              if (readonly || !isNativeApp()) return false;
              const files = Array.from(event.clipboardData?.files ?? []).filter(f => f.type.startsWith('image/'));
              if (!files.length) return false;
              event.preventDefault();
              for (const file of files) void insertImageFile(view, file);
              return true;
            },
            handleDrop: (view, event) => {
              if (readonly || !isNativeApp()) return false;
              const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'));
              if (!files.length) return false;
              event.preventDefault();
              for (const file of files) void insertImageFile(view, file);
              return true;
            },
          },
          view: () => ({
            update: (view, previous) => {
              if (view.state.doc.eq(previous.doc) || readonly) return;
              // Mark the draft at once (cheap), so nothing from outside can replace it.
              onEdit?.();
              // Serializing the whole document is O(size): do it once typing pauses,
              // not on every keystroke. Explicit flush() calls still save immediately.
              clearTimeout(updateTimer);
              updateTimer = setTimeout(flushWhenIdle, 250);
            },
            destroy: () => clearTimeout(updateTimer),
          }),
        })))
        .create();
      perfCount(readonly ? 'editor.create.readonly' : 'editor.create', performance.now() - createStart);
      if (disposed) { perfCount(readonly ? 'editor.destroy.readonly' : 'editor.destroy'); await editorInstance.destroy(); }
      else if(initialPosition) {
        const {TextSelection}=await import('@milkdown/kit/prose/state');
        editorInstance.action((ctx:any)=>{const view=ctx.get(editorViewCtxRef);const size=view.state.doc.content.size;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,Math.min(initialPosition!.from,size),Math.min(initialPosition!.to,size))));});
        if(root) root.scrollTop=initialPosition.scroll;
      } else if (autoFocus && !readonly) {
        focus();
      }
      if (!disposed) editorReady = true;
    } catch (e) {
      console.error("Milkdown setup failed:", e);
      if (!disposed) failed = true;
    }
  }
</script>

{#if failed}
  {#if readonly}<p class="render-error">预览加载失败，请在独立窗口查看</p>{:else}<SourceEditor {value} {onChange} />{/if}
{:else}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="editor-layout" class:readonly bind:this={layout} onmouseleave={() => (codeHover = null)}>
    {#if progress.total || showTaskInput}
      <div class="task-tools">
        {#if progress.total}<span class="task-progress"><ListTodo size={13}/>{progress.done===progress.total?'待办已全部完成':'已完成'}<span class="count">{progress.done}/{progress.total}</span></span>{/if}
        {#if justFinishedAll && onArchive && !readonly}
          <button class="archive-prompt" onclick={() => { justFinishedAll = false; onArchive?.(); }}><Archive size={12}/>归档便签</button>
        {/if}
        {#if !readonly}<button class="add-task" onclick={()=>{showTaskInput=!showTaskInput; if(showTaskInput) requestAnimationFrame(()=>taskField?.focus());}} aria-expanded={showTaskInput}>{#if showTaskInput}<X size={13}/>取消添加{:else}<Plus size={13}/>添加待办{/if}</button>{/if}
        {#if progress.total && onReminder}<button aria-label="提醒这张待办便签" title="为这张便签设置提醒" onclick={onReminder}><Bell size={13}/></button>{/if}
        {#if progress.done > 0 && progress.done < progress.total && !readonly}<button title="已完成项沉底 · 可撤销" aria-label="已完成项沉底" onclick={moveCompletedBottom}><ArrowDownToLine size={13}/></button>{/if}
        {#if progress.done && !readonly}<button title="移除已完成项 · 可撤销" aria-label="移除已完成待办" onclick={clearCompleted}><CheckCheck size={13}/></button>{/if}
      </div>
      {#if progress.total}
        <div class="task-bar" aria-hidden="true">
          <i class:complete={progress.done === progress.total} style:width="{(progress.done / progress.total) * 100}%"></i>
        </div>
      {/if}
    {/if}
    {#if showTaskInput && !readonly}
      <form class="task-entry" transition:slide={{ duration: motionReduced() ? 0 : 180 }} onsubmit={e=>{e.preventDefault();void addTask();}}>
        <input bind:this={taskField} bind:value={taskInput} aria-label="待办内容" placeholder="写下下一件要做的事" oncompositionstart={()=>composingTask=true} oncompositionend={()=>composingTask=false} onkeydown={e=>{if(e.isComposing&&e.key==='Enter')e.preventDefault(); else if(e.key==='Escape'){showTaskInput=false;}}} />
        <button type="submit" disabled={!taskInput.trim()}>添加</button>
        <small>Enter 添加 · 正文中也可以输入 - [ ] 创建待办</small>
      </form>
    {/if}
    {#if !readonly && editorReady}
      <div class="editor-actions" class:open={insertOpen} transition:reveal>
        {#if !progress.total && !showTaskInput}
          <button class="quiet-task" title="添加待办（也可输入 - [ ] ）" onclick={()=>{showTaskInput=true;requestAnimationFrame(()=>taskField?.focus());}}><Plus size={13}/>待办</button>
        {/if}
        <button type="button" bind:this={insertTrigger} aria-haspopup="menu" aria-expanded={insertOpen}
          onkeydown={e => {
            if (e.key === 'Escape' && insertOpen) { e.preventDefault(); e.stopPropagation(); insertOpen = false; }
            if (e.key === 'ArrowDown' && !insertOpen) { e.preventDefault(); insertOpen = true; }
          }}
          onclick={() => (insertOpen = !insertOpen)}><PixelMark variant="nib" size={16} />插入</button>
        {#if isNativeApp()}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden bind:this={imagePicker} onchange={handleImagePick} />{/if}
      </div>
      {#if insertOpen}
        <div class="insert-menu" role="menu" aria-label="插入内容" tabindex="-1"
          use:popup={{ close: () => (insertOpen = false), trigger: insertTrigger }} transition:reveal>
          {#each insertItems as item (item.kind)}
            <button type="button" role="menuitem" onclick={() => insertBlock(item.kind)}><item.icon size={14} />{item.label}</button>
          {/each}
          {#if isNativeApp()}
            <button type="button" role="menuitem" onclick={() => { insertOpen = false; imagePicker?.click(); }}><ImagePlus size={14} />图片</button>
          {/if}
        </div>
      {/if}
    {/if}
    {#if findOpen}
      <FindBar bind:this={findBar} query={findQuery} matchIndex={findIndex} matchCount={findCount} onQuery={q => runFind(q)} onNext={() => stepFind(1)} onPrev={() => stepFind(-1)} onClose={closeFind} />
    {/if}
    {#if codeHover}
      <div class="code-bar" style:top="{codeHover.top}px" style:right="{codeHover.right}px" transition:reveal>
        {#if codeHover.lang}<span class="code-lang">{codeHover.lang}</span>{/if}
        <button type="button" class="code-copy" title="复制代码" aria-label="复制代码" onclick={() => void copyHoveredCode()}>
          {#if codeHover.copied}<Check size={12}/>已复制{:else}<Copy size={12}/>复制{/if}
        </button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_mouse_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div class="milkdown-host" bind:this={root} role="application" onclick={handleHostClick} onkeydown={taskKey} onmouseover={handleHostMouseOver} onscroll={() => (codeHover = null)}></div>
  </div>
{/if}

<style>
  .editor-layout { position: relative; height: 100%; min-height: 0; display: flex; flex-direction: column; }
  .editor-actions {
    position: absolute; z-index: 6; bottom: 10px; right: 20px;
    display: flex; align-items: center; gap: 2px; padding: 2px;
    border-radius: var(--radius-sm); background: var(--material); box-shadow: var(--material-shadow);
    -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur);
    opacity: 0; pointer-events: none;
    transition: opacity var(--motion-fast);
  }
  .editor-layout:hover .editor-actions, .editor-actions:focus-within, .editor-actions.open {
    opacity: 1; pointer-events: auto;
  }
  .editor-actions button, .insert-menu button {
    display: flex; align-items: center; gap: 5px; padding: 4px 8px;
    border: 0; border-radius: var(--radius-sm); background: transparent;
    color: var(--pin-muted, var(--muted)); font: inherit; font-size: 11px; cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast);
  }
  .editor-actions button:hover, .insert-menu button:hover, .editor-actions button[aria-expanded="true"] { background: var(--pin-active); color: var(--pin-accent); }
  .editor-actions button:active, .insert-menu button:active { transform: scale(.96); }
  .insert-menu {
    position: absolute; z-index: 7; right: 20px; bottom: 42px; padding: 4px; min-width: 112px;
    max-height: calc(100% - 50px); overflow: auto;
    border-radius: var(--radius); background: var(--material); box-shadow: var(--material-shadow);
    -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur);
    transform-origin: bottom right;
  }
  .insert-menu button { width: 100%; color: var(--pin-text, var(--text)); white-space: nowrap; }
  .task-tools {
    /* Same column as the text below: 820px plus the host's 16px padding and 10px scrollbar gutter. */
    box-sizing: border-box; width: 100%; max-width: 862px; margin: 0 auto;
    display: flex; align-items: center; gap: 8px; padding: 5px 26px 4px 16px;
    color: var(--pin-muted, #737373); font-size: 11px; flex-shrink: 0;
  }
  .task-progress { display: flex; align-items: center; gap: 6px; }
  .count { color: var(--pin-muted, #737373); font-family: var(--font-pixel); font-variant-numeric: tabular-nums; }
  .task-bar {
    box-sizing: border-box; width: 100%; max-width: 862px; margin: 0 auto 4px;
    padding: 0 26px 0 16px; height: 2px; flex-shrink: 0;
  }
  .task-bar i {
    display: block; height: 100%;
    background: repeating-linear-gradient(90deg, var(--pin-accent, #2563eb) 0 6px, transparent 6px 8px);
    transition: width 260ms var(--ease-out), background var(--motion-fast);
  }
  .task-bar i.complete { animation: bar-complete 600ms var(--ease-out); }
  @keyframes bar-complete { 40% { box-shadow: 0 0 8px color-mix(in srgb, var(--pin-accent, #2563eb) 55%, transparent); } }
  .archive-prompt {
    background: var(--pin-active, #eff6ff) !important; color: var(--pin-accent, #2563eb) !important;
    border-radius: 999px !important; padding: 2px 9px !important; font-size: 11px !important;
  }
  .task-tools button, .task-entry button {
    display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: var(--radius-sm);
    padding: 4px 6px; color: var(--pin-accent, #2563eb); background: transparent; cursor: pointer;
    font: inherit; transition: background var(--motion-fast), transform var(--motion-fast);
  }
  .task-tools button:hover, .task-entry button:hover { background: var(--pin-active, #eff6ff); }
  .task-tools button:active, .task-entry button:active { transform: scale(.96); }
  .task-tools .add-task { margin-left: auto; }
  .task-entry {
    box-sizing: border-box; display: grid; grid-template-columns: 1fr auto; gap: 5px;
    width: 100%; max-width: 862px; margin: 4px auto 8px; padding: 0 26px 0 16px;
  }
  .task-entry input {
    min-width: 0; padding: 7px 9px; border: 1px solid var(--pin-border, #ddd); border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--pin-bg, #fff) 80%, transparent); color: var(--pin-text, #171717);
    font: inherit; font-size: 12px;
  }
  .task-entry small { grid-column: 1 / -1; font-size: 10px; color: var(--pin-muted, #737373); }

  .code-bar {
    position: absolute; z-index: 5; display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 4px 2px 8px; border-radius: var(--radius-sm);
    background: var(--material); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur);
    box-shadow: var(--material-shadow); font-size: 11px; color: var(--muted);
  }
  .code-lang { font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace; font-size: 10px; text-transform: lowercase; opacity: .8; }
  .code-copy {
    display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 4px;
    padding: 2px 6px; background: transparent; color: var(--text); font: inherit; font-size: 11px;
    cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast);
  }
  .code-copy:hover { background: var(--hover-strong); color: var(--pin-accent, var(--accent)); }

  .readonly .milkdown-host { height: auto; }
  .readonly :global(li[data-item-type="task"])::before { cursor: default; }
  .render-error { padding: 16px; color: var(--pin-muted, var(--muted)); font-size: 12px; }

  .milkdown-host {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 8px 16px 44px;
    background-image: var(--paper-grid);
    background-position: 8px 0;
    scrollbar-gutter: stable;
  }
  .readonly .milkdown-host { padding-bottom: 22px; }

  .milkdown-host :global(.milkdown) { min-height: 100%; }

  .milkdown-host :global(.editor) {
    min-height: 100%;
    max-width: 820px;
    margin: 0 auto;
    display: flow-root;
    outline: 0;
    color: var(--pin-text);
    caret-color: var(--pin-accent-strong);
    font-size: var(--editor-font-size, 14px);
    line-height: 1.65;
  }

  :global(::highlight(pinnote-find)) {
    background-color: color-mix(in srgb, #f5c542 42%, transparent);
  }
  :global(::highlight(pinnote-find-active)) {
    background-color: color-mix(in srgb, var(--accent, #2563eb) 36%, transparent);
  }

  .milkdown-host :global(.editor ::selection) {
    background: color-mix(in srgb, var(--pin-accent, var(--accent)) 22%, transparent);
  }

  .milkdown-host :global(.editor > :first-child) { margin-top: 0; }
  .milkdown-host :global(.editor > :last-child) { margin-bottom: 0; }

  .milkdown-host :global(h1) { margin: 0.2em 0 0.55em; color: var(--pin-heading); font-size: 20px; font-weight: 650; line-height: 1.25; }
  .milkdown-host :global(h2) { margin: 1.05em 0 0.45em; color: var(--pin-heading); font-size: 17px; font-weight: 600; line-height: 1.3; }
  .milkdown-host :global(h3) { margin: 0.9em 0 0.35em; color: var(--pin-heading); font-size: 15px; font-weight: 600; line-height: 1.35; }
  .milkdown-host :global(h4),
  .milkdown-host :global(h5),
  .milkdown-host :global(h6) { margin: 0.8em 0 0.3em; color: var(--pin-heading); font-size: 13.5px; font-weight: 600; opacity: .9; }

  .milkdown-host :global(p) { margin: 0.55em 0; }
  .milkdown-host :global(ul), .milkdown-host :global(ol) { padding-left: 1.25rem; }
  .milkdown-host :global(ul) { list-style-type: square; }
  .milkdown-host :global(ul > li)::marker { color: var(--pin-accent); }

  .milkdown-host :global(a) {
    color: var(--pin-accent, var(--accent));
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--pin-accent, var(--accent)) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
    transition: text-decoration-color var(--motion-fast);
  }
  .milkdown-host :global(a:hover) { text-decoration-color: currentColor; }
  .milkdown-host :global(hr) {
    border: 0; height: 1px; margin: 1.1em 0;
    background: repeating-linear-gradient(90deg, var(--pin-border) 0 4px, transparent 4px 8px);
  }
  .milkdown-host :global(del), .milkdown-host :global(s) { opacity: .62; }
  .milkdown-host :global(img) { max-width: 100%; border-radius: var(--radius); margin: 0.4em 0; }

  .milkdown-host :global(input[type="checkbox"]) {
    width: 15px; height: 15px; margin: 0 7px 0 0; vertical-align: -2px; accent-color: var(--pin-accent);
  }

  .milkdown-host :global(li[data-item-type="task"]),
  .milkdown-host :global(li[data-checked]),
  .milkdown-host :global(li.task-list-item) {
    list-style: none; margin-left: -1.2rem; position: relative; padding-left: 1.5rem;
  }

  .milkdown-host :global(li[data-item-type="task"])::before {
    content: "";
    position: absolute; left: 0; top: 0.32em; width: 15px; height: 15px;
    box-sizing: border-box; border: 2px solid var(--pin-accent); border-radius: 2px; cursor: pointer; background: transparent;
    transition: background var(--motion-fast), border-color var(--motion-fast), transform 220ms var(--ease-spring);
  }

  .milkdown-host :global(li[data-item-type="task"])::after {
    content: "";
    position: absolute; left: 0; top: 0.32em; width: 15px; height: 15px; pointer-events: none;
    background-color: var(--pin-on-accent, var(--on-accent));
    -webkit-mask: var(--px-check-mask) center / 10px no-repeat;
    mask: var(--px-check-mask) center / 10px no-repeat;
    clip-path: inset(0 100% 0 0);
    transition: clip-path var(--motion-fast) steps(5, end);
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"])::before {
    background: var(--pin-accent);
    border-color: var(--pin-accent);
    transform: scale(1.04);
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"])::after {
    clip-path: inset(0 0 0 0);
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"]),
  .milkdown-host :global(li[data-checked="true"]) {
    color: color-mix(in srgb, var(--pin-text), transparent 40%);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--pin-text), transparent 55%);
  }

  .milkdown-host :global(blockquote) {
    margin: 0.85em 0;
    border-left: 2px solid var(--pin-accent);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    padding: 0.25rem 0.6rem 0.25rem 0.8rem;
    color: color-mix(in srgb, var(--pin-text), transparent 24%);
    background: color-mix(in srgb, var(--pin-accent), transparent 94%);
  }

  .milkdown-host :global(code) {
    border-radius: var(--radius-sm);
    padding: 0.08rem 0.3rem;
    color: var(--pin-accent-strong);
    background: color-mix(in srgb, var(--pin-text) 7%, transparent);
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 0.89em;
  }

  .milkdown-host :global(pre) {
    overflow: auto;
    border-radius: var(--radius);
    padding: 0.85rem 1rem;
    background: color-mix(in srgb, var(--pin-text) 6%, transparent);
    box-shadow: inset 0 0 0 1px var(--pin-border), var(--px-shadow);
  }

  .milkdown-host :global(pre code) { padding: 0; border-radius: 0; background: none; color: inherit; }

  .milkdown-host :global(table) {
    display: block; width: 100%; max-width: 100%; margin: 0.9rem 0;
    overflow: auto; border-collapse: collapse; border-spacing: 0; font-size: 0.92em;
  }

  .milkdown-host :global(th), .milkdown-host :global(td) {
    min-width: 7rem; border: 1px solid color-mix(in srgb, var(--pin-border), var(--pin-text) 10%);
    padding: 0.42rem 0.58rem; text-align: left; vertical-align: top;
  }

  .milkdown-host :global(th) {
    color: var(--pin-heading); background: color-mix(in srgb, var(--pin-accent), transparent 89%); font-weight: 650;
  }

  .milkdown-host :global(td) { background: color-mix(in srgb, var(--pin-bg), transparent 8%); }
  .milkdown-host :global(tr:nth-child(even) td) { background: color-mix(in srgb, var(--pin-accent), transparent 95%); }
  .milkdown-host :global(th p), .milkdown-host :global(td p) { margin: 0.15em 0; }

  @media (prefers-reduced-motion: reduce) {
    .quiet-task, .task-tools button, .task-entry button, .task-bar i,
    .milkdown-host :global(li[data-item-type="task"])::before,
    .milkdown-host :global(li[data-item-type="task"])::after { transition: none; animation: none; }
  }
</style>
