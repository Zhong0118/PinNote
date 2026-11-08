<script lang="ts">
  import { browser } from "$app/environment";
  import { onMount } from "svelte";
  import SourceEditor from "./SourceEditor.svelte";
  import { ListTodo, Plus, Bell, CheckCheck } from 'lucide-svelte';
  import { checklistProgress } from '$lib/checklist';
  import { perfCount, perfTime } from '$lib/perf';

  type Props = {
    value: string;
    onChange: (value: string) => void;
    initialPosition?: {from:number;to:number;scroll:number};
    readonly?: boolean;
    onReminder?: () => void;
  };

  let { value, onChange, initialPosition, readonly = false, onReminder }: Props = $props();
  let taskInput=$state('');
  let showTaskInput=$state(false);
  let taskField=$state<HTMLInputElement>();
  let composingTask=false;
  const progress=$derived(checklistProgress(value));
  let root = $state<HTMLDivElement>();
  let failed = $state(false);
  let disposed = false;
  let updateTimer: ReturnType<typeof setTimeout>;
  let editorInstance: any;
  let editorViewCtxRef: any;
  let serializerCtxRef: any;

  export function flush() {
    if (!editorInstance || disposed || readonly) return;
    const markdown = perfTime('md.serialize', () => editorInstance.action((ctx: any) =>
      ctx.get(serializerCtxRef)(ctx.get(editorViewCtxRef).state.doc)));
    if (markdown !== value) onChange(markdown);
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
  function taskKey(event: KeyboardEvent) {
    if(readonly || event.isComposing || !(event.metaKey||event.ctrlKey) || !event.shiftKey || event.key!=='Enter' || !editorInstance) return;
    editorInstance.action((ctx:any)=>{
      const view=ctx.get(editorViewCtxRef); const from=view.state.selection.$from;
      for(let depth=from.depth;depth>0;depth--){const node=from.node(depth);
        if(node.type.name==='list_item'&&node.attrs.checked!=null){event.preventDefault();view.dispatch(view.state.tr.setNodeMarkup(from.before(depth),undefined,{...node.attrs,checked:!node.attrs.checked}));return;}
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

  onMount(() => {
    void setup();

    return () => {
      // Callers flush() before switching notes or closing; flushing here could
      // write this editor's text into whichever note the props now point at.
      disposed = true;
      clearTimeout(updateTimer);
      if (editorInstance) perfCount(readonly ? 'editor.destroy.readonly' : 'editor.destroy');
      void editorInstance?.destroy();
    };
  });

  function handleTaskClick(event: MouseEvent) {
    if(readonly)return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const li = target.closest('li[data-item-type="task"]') as HTMLElement | null;
    if (!li) return;

    // Only toggle when clicking in the checkbox zone (left 28px)
    const rect = li.getBoundingClientRect();
    if (event.clientX > rect.left + 28) return;

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
          found = true;
          return false;
        }
        count++;
      }
    });
  }

  async function setup() {
    if (!browser || !root) return;

    try {
      const [
        { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx, editorViewOptionsCtx },
        { commonmark },
        { gfm },
        { $prose: prosePlugin },
        { Plugin },
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
          view: () => ({
            update: (view, previous) => {
              if (view.state.doc.eq(previous.doc)) return;
              // Serializing the whole document is O(size): do it once typing pauses,
              // not on every keystroke. Explicit flush() calls still save immediately.
              clearTimeout(updateTimer);
              updateTimer = setTimeout(flush, 250);
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
      }
    } catch (e) {
      console.error("Milkdown setup failed:", e);
      if (!disposed) failed = true;
    }
  }
</script>

{#if failed}
  {#if readonly}<p class="render-error">预览加载失败，请在独立窗口查看</p>{:else}<SourceEditor {value} {onChange} />{/if}
{:else}
  <div class="editor-layout" class:readonly>
    {#if progress.total || showTaskInput}
      <div class="task-tools">
        {#if progress.total}<span class="task-progress"><ListTodo size={14}/>{progress.done===progress.total?'待办已全部完成':'已完成'}<span class="count">{progress.done}/{progress.total}</span></span>{/if}
        {#if !readonly}<button class="add-task" onclick={()=>showTaskInput=!showTaskInput} aria-expanded={showTaskInput}><Plus size={14}/>添加待办</button>{/if}
        {#if progress.total && onReminder}<button aria-label="提醒这张待办便签" title="为这张便签设置提醒" onclick={onReminder}><Bell size={14}/></button>{/if}
        {#if progress.done && !readonly}<button title="移除已完成项 · 可撤销" aria-label="移除已完成待办" onclick={clearCompleted}><CheckCheck size={14}/></button>{/if}
      </div>
    {/if}
    {#if showTaskInput && !readonly}<form class="task-entry" onsubmit={e=>{e.preventDefault();void addTask();}}><input bind:this={taskField} bind:value={taskInput} aria-label="待办内容" placeholder="写下下一件要做的事" oncompositionstart={()=>composingTask=true} oncompositionend={()=>composingTask=false} onkeydown={e=>{if(e.isComposing&&e.key==='Enter')e.preventDefault();}}/><button type="submit" disabled={!taskInput.trim()}>添加</button><small>Enter 添加 · 正文中也可以输入 - [ ] 创建待办</small></form>{/if}
    {#if !readonly && !progress.total && !showTaskInput}
      <!-- Plain notes stay clean: the to-do entry only surfaces on hover or keyboard focus. -->
      <button class="quiet-task" title="添加待办（也可输入 - [ ] ）" onclick={()=>{showTaskInput=true;requestAnimationFrame(()=>taskField?.focus());}}><Plus size={13}/>待办</button>
    {/if}
   <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
    <div class="milkdown-host" bind:this={root} role="application" onclick={handleTaskClick} onkeydown={taskKey}></div>
  </div>
{/if}

<style>
  .editor-layout{position:relative;height:100%;min-height:0;display:flex;flex-direction:column}
  .quiet-task{position:absolute;z-index:2;top:4px;right:14px;display:inline-flex;align-items:center;gap:3px;border:0;border-radius:6px;padding:2px 7px;font:inherit;font-size:11px;color:var(--pin-muted,#737373);background:color-mix(in srgb,var(--pin-bg,#fff) 88%,transparent);cursor:pointer;opacity:0;transition:opacity 140ms}
  .editor-layout:hover .quiet-task,.quiet-task:focus-visible{opacity:.85}.quiet-task:hover{color:var(--pin-accent,#2563eb);opacity:1}
  @media(prefers-reduced-motion:reduce){.quiet-task{transition:none}}.task-tools{display:flex;align-items:center;gap:8px;padding:5px 16px;color:var(--pin-muted,#737373);font-size:11px;flex-shrink:0}.task-progress{display:flex;align-items:center;gap:6px}.count{color:var(--pin-muted,#737373);opacity:.75}.task-tools button,.task-entry button{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:6px;padding:4px 6px;color:var(--pin-accent,#2563eb);background:transparent;cursor:pointer;font:inherit;transition:background 140ms,transform 140ms}.task-tools button:hover,.task-entry button:hover{background:var(--pin-active,#eff6ff)}.task-tools button:active,.task-entry button:active{transform:scale(.96)}.task-tools .add-task{margin-left:auto}.task-entry{display:grid;grid-template-columns:1fr auto;gap:5px;margin:4px 16px 8px}.task-entry input{min-width:0;padding:7px 9px;border:1px solid var(--pin-border,#ddd);border-radius:7px;background:var(--pin-bg,#fff);color:var(--pin-text,#171717);font:inherit;font-size:12px}.task-entry small{grid-column:1/-1;font-size:10px;color:var(--pin-muted,#737373)}.readonly .milkdown-host{height:auto}.readonly :global(li[data-item-type="task"])::before{cursor:default}.render-error{padding:16px;color:#737373;font-size:12px}@media(prefers-reduced-motion:reduce){.task-tools button,.task-entry button{transition:none}}
  .milkdown-host {
    flex:1;
    min-height: 0;
    overflow: auto;
    padding: 8px 16px 18px;
    scrollbar-gutter: stable;
  }

  .milkdown-host :global(.milkdown) {
    min-height: 100%;
  }

  .milkdown-host :global(.editor) {
    min-height: 100%;
    /* Comfortable reading measure in wide windows; narrow notes simply fill. */
    max-width: 820px;
    margin: 0 auto;
    display: flow-root;
    outline: 0;
    color: var(--pin-text);
    caret-color: var(--pin-accent-strong);
    font-size: 14px;
    line-height: 1.6;
  }

  .milkdown-host :global(.editor > :first-child) { margin-top: 0; }
  .milkdown-host :global(.editor > :last-child) { margin-bottom: 0; }

  .milkdown-host :global(h1) {
    margin: 0.15em 0 0.55em;
    color: var(--pin-heading);
    font-size: 20px;
    font-weight: 600;
    line-height: 1.2;
  }

  .milkdown-host :global(h2) {
    margin: 1em 0 0.45em;
    color: var(--pin-heading);
    font-size: 17px;
    font-weight: 600;
  }

  .milkdown-host :global(p) {
    margin: 0.55em 0;
  }

  .milkdown-host :global(ul),
  .milkdown-host :global(ol) {
    padding-left: 1.25rem;
  }

  .milkdown-host :global(input[type="checkbox"]) {
    width: 15px;
    height: 15px;
    margin: 0 7px 0 0;
    vertical-align: -2px;
    accent-color: var(--pin-accent);
  }

  .milkdown-host :global(li[data-item-type="task"]),
  .milkdown-host :global(li[data-checked]),
  .milkdown-host :global(li.task-list-item) {
    list-style: none;
    margin-left: -1.2rem;
    position: relative;
    padding-left: 1.5rem;
  }

  .milkdown-host :global(li[data-item-type="task"])::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.32em;
    width: 15px;
    height: 15px;
    border: 2px solid var(--pin-accent);
    border-radius: 3px;
    cursor: pointer;
    background: transparent;
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"])::before {
    background: var(--pin-accent);
    border-color: var(--pin-accent);
    /* Checkmark via background image */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='white' d='M6.5 11.5L3 8l1-1 2.5 2.5L12 4l1 1z'/%3E%3C/svg%3E");
    background-size: 13px;
    background-position: center;
    background-repeat: no-repeat;
  }

  .milkdown-host :global(li[data-item-type="task"][data-checked="true"]),
  .milkdown-host :global(li[data-checked="true"]) {
    color: color-mix(in srgb, var(--pin-text), transparent 38%);
    text-decoration: line-through;
  }

  .milkdown-host :global(blockquote) {
    margin: 0.85em 0;
    border-left: 3px solid var(--pin-accent);
    padding: 0.2rem 0 0.2rem 0.75rem;
    color: color-mix(in srgb, var(--pin-text), transparent 24%);
    background: color-mix(in srgb, var(--pin-accent), transparent 91%);
  }

  .milkdown-host :global(code) {
    border-radius: 5px;
    padding: 0.08rem 0.28rem;
    color: var(--pin-accent-strong);
    background: color-mix(in srgb, var(--pin-text) 8%, transparent);
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 0.9em;
  }

  .milkdown-host :global(pre) {
    overflow: auto;
    border-radius: 8px;
    padding: 0.85rem;
    background: color-mix(in srgb, var(--pin-text) 8%, transparent);
  }

  /* Code inside a block already sits on the block's background. */
  .milkdown-host :global(pre code) {
    padding: 0;
    border-radius: 0;
    background: none;
  }

  .milkdown-host :global(table) {
    display: block;
    width: 100%;
    max-width: 100%;
    margin: 0.9rem 0;
    overflow: auto;
    border-collapse: collapse;
    border-spacing: 0;
    font-size: 0.92em;
  }

  .milkdown-host :global(th),
  .milkdown-host :global(td) {
    min-width: 7rem;
    border: 1px solid color-mix(in srgb, var(--pin-border), var(--pin-text) 10%);
    padding: 0.42rem 0.58rem;
    text-align: left;
    vertical-align: top;
  }

  .milkdown-host :global(th) {
    color: var(--pin-heading);
    background: color-mix(in srgb, var(--pin-accent), transparent 88%);
    font-weight: 750;
  }

  .milkdown-host :global(td) {
    background: color-mix(in srgb, var(--pin-bg), transparent 8%);
  }

  .milkdown-host :global(tr:nth-child(even) td) {
    background: color-mix(in srgb, var(--pin-accent), transparent 95%);
  }

  .milkdown-host :global(th p),
  .milkdown-host :global(td p) {
    margin: 0.15em 0;
  }
</style>
