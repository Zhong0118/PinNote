<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, emitTo } from '@tauri-apps/api/event';
  import { getCurrentWindow, availableMonitors, LogicalPosition, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import { PanelLeft, Plus, X, MoreHorizontal, Monitor, Archive, Trash2, Settings, Search, Pin, PinOff, Minimize2, PanelRight, ChevronsLeft, ChevronsRight, Maximize2, PenLine } from 'lucide-svelte';
  import { answerRelease } from '$lib/editorHandoff';
  import { animateWindow, canAnimateWindow } from '$lib/nativeMotion';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { EDGE_TAB, displayFor, normalizeBounds, normalizeDisplays, type Bounds } from '$lib/windowGeometry';
  import { CENTER_PANEL, CENTER_WINDOW_MIN, barBounds, handleBounds, nearestSide, panelBounds, type CenterMode, type CenterSide } from '$lib/centerLayout';
  import MilkdownEditor from '../../components/MilkdownEditor.svelte';
  import { createNote, loadNotes, saveNoteNow, scheduleNoteSave, flushNoteSave, noteOperation, hasPendingSave, type PinNote } from '$lib/notesStore';
  import { openNoteWindow, findNoteWindow } from '$lib/noteWindows';
  import { requestWindowVisibility } from '$lib/windowVisibility';
  import { loadSettings, isMacPlatform } from '$lib/settings';
  import { registerGlobalShortcuts, unregisterGlobalShortcuts } from '$lib/shortcuts';
  import { openSettingsWindow } from '$lib/settingsWindow';
  import { reveal, popup } from '$lib/motion';
  import { createQuitGuard } from '$lib/quitGuard';
  import ReminderDialog from '../../components/ReminderDialog.svelte';
  import { checklistProgress } from '$lib/checklist';
  import NoteColorPicker from '../../components/NoteColorPicker.svelte';
  import {noteBackground} from '$lib/noteAppearance';
  import type {NoteTheme} from '$lib/settings';
  let reminderOpen=$state(false);
  let due=$state<PinNote[]>([]);
  const quitGuard = createQuitGuard();

  let notes = $state<PinNote[]>([]);
  let tabs = $state<string[]>([]);
  let selected = $state('');
  let draft = $state<PinNote>();
  const progress=$derived(checklistProgress(draft?.content??''));
  let query = $state('');
  let filter = $state('active');
  let sidebar = $state(true);
  let menu = $state(false);
  let status = $state('正在加载…');
  let busy = $state(false);
  let revision = $state(0);
  let editor = $state<MilkdownEditor>();
  let undo = $state<{id:string;at:number}|null>(null);
  let dragTab = '';
  const positions = new Map<string,{from:number;to:number;scroll:number}>();
  const visible = $derived(notes.filter(n => (filter === 'desktop' ? n.lifecycle === 'active' && n.placement === 'desktop' : n.lifecycle === filter) && `${n.title}\n${n.content}`.toLowerCase().includes(query.toLowerCase())));
  // One writer per note: the center edits center notes and desktop notes that are only a
  // capsule/edge tab. An expanded desktop window owns its note until editing is handed back.
  let handoff = $state('');
  let handoffTimer: ReturnType<typeof setTimeout>;
  const editable = $derived(draft?.lifecycle === 'active' && (draft.placement === 'center' || (Boolean(draft.window?.collapsed) && handoff !== draft.id)));
  const desktopEditing = $derived(draft?.lifecycle === 'active' && draft.placement === 'desktop' && !draft.window?.collapsed);

  async function refresh() { notes = Object.values((await loadNotes()).notes).sort((a,b)=>b.updatedAt-a.updatedAt); due=notes.filter(n=>n.lifecycle==='active'&&n.reminder?.state==='delivered'); }
  async function run(action:()=>Promise<void>) {
    if(busy) return; busy=true;
    try { await action(); } catch(e) { status=String(e); } finally { busy=false; }
  }
  async function persist() {
    editor?.flush();
    if(draft && editable) { const pos=editor?.capture(); if(pos) positions.set(draft.id,pos); await flushNoteSave(draft.id); await refresh(); }
  }
  async function select(id:string) {
    await persist(); await refresh();
    const note=notes.find(n=>n.id===id); if(!note) return;
    selected=id; draft=structuredClone($state.snapshot(note));
    if(!tabs.includes(id)) tabs=[...tabs,id];
    revision++; menu=false;
  }
  function update(patch:Partial<PinNote>) {
    if(!draft || !editable) return;
    // No per-keystroke status churn or extra list reloads: notes-changed refreshes the list.
    draft={...draft,...patch};
    scheduleNoteSave(draft,e=>{status=e?`保存失败：${e}`:'已保存';},'body');
  }
  async function create() {
    await persist(); const note=createNote({title:'未命名便签',content:'',placement:'center'});
    await saveNoteNow(note); await select(note.id);
    await getCurrentWindow().show(); await getCurrentWindow().setFocus();
  }
  async function closeTab(id:string) {
    if(id===selected) await persist();
    tabs=tabs.filter(t=>t!==id);
    if(id===selected) {
      if(tabs.length) await select(tabs.at(-1)!);
      else { editor=undefined; selected=''; draft=undefined; }
    }
    status='已保存 · 已关闭 Tab';
  }
  async function desktop() {
    if(!draft) return;
    await persist(); const note=(await loadNotes()).notes[draft.id];
    await openNoteWindow(note,{locate:true}); await select(note.id);status='已展开并高亮桌面便签';
  }
  async function changeColor(theme:NoteTheme,customColor?:string) {
    if(!draft)return;
    const current=(await loadNotes()).notes[draft.id];
    await noteOperation(current,'appearance',{patch:{theme,...(customColor?{customColor}:{})}});
    draft={...draft,theme:current.theme,customColor:current.customColor};
    await refresh();status='颜色已同步到桌面便签';
  }
  /** Hand editing of an expanded desktop note to the center; the desktop keeps its capsule/tab. */
  async function editHere() {
    if(!draft) return;
    const id=draft.id; const win=await findNoteWindow(id);
    if(win) { await emitTo(win.label,'collapse-note-requested',{id}); status='正在把编辑移到中心…'; }
    else {
      const note=(await loadNotes()).notes[id];
      await noteOperation(note,'window',{patch:{window:{...note.window,collapsed:true}}});
      await refresh();
    }
  }
  async function recall() {
    if(!draft) return;
    const id=draft.id; const win=await findNoteWindow(id);
    if(win) await requestWindowVisibility(win.label,false);
    const note=(await loadNotes()).notes[id];
    await noteOperation(note,'center');
    if(win) await win.destroy().catch(()=>{});
    await select(id); status='已收回中心 · 编辑历史从此处重新开始';
  }
  async function operation(op:string) {
    if(!draft) return; menu=false;
    if(op==='purge' && !window.confirm('永久删除这张便签？此操作无法撤销。')) return;
    await persist(); const id=draft.id;
    const win=await findNoteWindow(id); if(win) await requestWindowVisibility(win.label,false);
    const note=(await loadNotes()).notes[id]; await noteOperation(note,op);
    if(win && ['archive','trash','restore','purge'].includes(op)) await win.destroy().catch(()=>{});
    const file=await loadNotes();
    if(op==='trash'||op==='archive') { const h=file.history?.filter(h=>h.note.id===id).at(-1); if(h) undo={id,at:h.at}; }
    await refresh();
    if(op==='purge') await closeTab(id); else await select(id);
    status=op==='trash'?'已移到回收站':op==='archive'?'已归档':'已恢复到中心';
  }
  async function undoLast() {
    if(!undo) return; await persist();
    const note=(await loadNotes()).notes[undo.id]; await noteOperation(note,'undo',{historyId:undo.at});
    await select(note.id); undo=null; status='已撤销';
  }
  function reorder(id:string) { if(!dragTab || dragTab===id) return; const next=tabs.filter(t=>t!==dragTab); next.splice(next.indexOf(id),0,dragTab); tabs=next; dragTab=''; }
  let visibility=Promise.resolve();
  function toggleDesktop() {
    visibility=visibility.then(async()=>{
      const all=Object.values((await loadNotes()).notes).filter(n=>n.lifecycle==='active'&&n.placement==='desktop');
      const windows=await Promise.all(all.map(n=>findNoteWindow(n.id)));
      const shown=await Promise.all(windows.map(async w=>w&&await w.isVisible()?w:null));
      if(shown.some(Boolean)) await Promise.all(shown.map(w=>w?requestWindowVisibility(w.label,false):Promise.resolve()));
      else for(const note of all) await openNoteWindow(note);
    }).catch(e=>{status=String(e);});
  }
  // ---- Center window form: free/docked × expanded/collapsed, plus its own pin. ----
  const STORE='pinnote.center';
  const mac=isMacPlatform();
  let mode=$state<CenterMode>('window');
  let side=$state<CenterSide>('right');
  let pinned=$state(false);
  let width=$state(960);
  let savedWindow: Bounds|undefined;
  let panelWidth=CENTER_PANEL.width;
  let modeBusy=false;
  let dockKind: 'bar'|'handle'|undefined;
  const narrow=$derived(mode==='panel'||width<640);
  let restored=false;
  function restoreSession(hidden:boolean) {
    try {
      const saved=JSON.parse(localStorage.getItem(STORE)??'{}');
      side=saved.side==='left'?'left':'right'; pinned=Boolean(saved.pinned);
      savedWindow=saved.window; panelWidth=saved.panelWidth??CENTER_PANEL.width;
      if(!hidden && ['bar','panel','handle'].includes(saved.mode)) mode=saved.mode;
      // Reopen the last working tabs and note.
      tabs=(saved.tabs??[]).filter((id:string)=>notes.some(n=>n.id===id));
      const last=notes.find(n=>n.id===saved.selected);
      if(last){ selected=last.id; draft=structuredClone($state.snapshot(last)); if(!tabs.includes(last.id)) tabs=[...tabs,last.id]; revision++; }
    } catch { /* A damaged preference only loses the remembered layout. */ }
    restored=true;
  }
  $effect(()=>{
    const state={mode,side,pinned,tabs:[...tabs],selected,panelWidth,window:savedWindow};
    if(restored) localStorage.setItem(STORE,JSON.stringify(state));
  });
  async function displays(){ return normalizeDisplays(await availableMonitors(),mac); }
  /** Docked note tabs on this side form a rail the panel sits beside, never over. */
  const railInset=(s:CenterSide)=>notes.some(n=>n.lifecycle==='active'&&n.placement==='desktop'&&n.window.edge?.side===s)?EDGE_TAB.width:0;
  async function readOuter(){
    const win=getCurrentWindow();
    const [p,outer,inner,scale]=await Promise.all([win.outerPosition(),win.outerSize(),win.innerSize(),win.scaleFactor()]);
    const o=outer.toLogical(scale), i=inner.toLogical(scale);
    return { bounds: normalizeBounds({x:p.x,y:p.y,width:o.width,height:o.height,scaleFactor:scale},mac), chrome:{width:o.width-i.width,height:o.height-i.height} };
  }
  /** Move/resize this window by its outer frame, immediately. */
  async function applyOuter(bounds:Bounds) {
    const win=getCurrentWindow();
    if(mac) { await animateWindow({bounds,duration:0}); return; }
    const {chrome}=await readOuter();
    const position=new PhysicalPosition(bounds.x,bounds.y);
    await win.setPosition(position);
    await win.setSize(new LogicalSize(bounds.width-chrome.width,bounds.height-chrome.height));
    await win.setPosition(position);
  }
  // The center never animates a resize: re-laying out the whole page every frame is
  // what made it stutter. It changes size while invisible and moves/fades natively.
  const SLIDE=28;
  const nudge=(b:Bounds,toward:CenterSide|'up',d=SLIDE)=>toward==='up'?{...b,y:b.y+8*b.scaleFactor}:{...b,x:b.x+(toward==='left'?-d:d)*b.scaleFactor};
  async function fadeOut(to?:Bounds,ms=160) {
    if(canAnimateWindow()) await animateWindow({bounds:to,alpha:0,duration:ms,curve:'in'});
  }
  async function hideFaded() {
    const win=getCurrentWindow();
    await win.hide();
    // Restore opacity while hidden so an external show (tray, relaunch) is never invisible.
    if(mac) await animateWindow({alpha:1,duration:0});
  }
  /** Show at `from` (transparent), then glide to `to` while fading in. */
  async function showFaded(to:Bounds, from:Bounds=to, ms=260) {
    const win=getCurrentWindow();
    if(!canAnimateWindow()) { await applyOuter(to); await win.show(); return; }
    await animateWindow({bounds:from,alpha:0,duration:0});
    await win.show();
    await animateWindow({bounds:to,alpha:1,duration:ms,curve:'out'});
  }
  async function syncDock() {
    const dock=await WebviewWindow.getByLabel('center-dock');
    if(!dock||!dockKind) return;
    const title=draft?.title||(notes.length?'':'还没有便签');
    await emitTo('center-dock','center-dock-state',{kind:dockKind,side,title,count:notes.filter(n=>n.lifecycle==='active').length});
  }
  async function showDock(kind:'bar'|'handle', bounds:Bounds) {
    let dock=await WebviewWindow.getByLabel('center-dock');
    if(!dock) {
      dock=new WebviewWindow('center-dock',{url:'/dock',title:'PinNote',width:bounds.width,height:bounds.height,decorations:false,transparent:true,
        backgroundColor:'#00000000',shadow:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,visible:false,focus:false,visibleOnAllWorkspaces:mac});
      await new Promise<void>((resolve,reject)=>{dock!.once('tauri://created',()=>resolve());dock!.once('tauri://error',e=>reject(e.payload));});
    }
    dockKind=kind;
    await dock.setSize(new LogicalSize(bounds.width,bounds.height));
    await dock.setPosition(mac?new LogicalPosition(bounds.x,bounds.y):new PhysicalPosition(bounds.x,bounds.y));
    await syncDock();
    await dock.show();
  }
  async function hideDock() { dockKind=undefined; await (await WebviewWindow.getByLabel('center-dock'))?.hide(); }

  /** Switch the center between its four forms. Each step keeps the current tab and draft. */
  async function applyMode(next:CenterMode, nextSide:CenterSide=side) {
    if(modeBusy || (next===mode && nextSide===side)) return;
    modeBusy=true; menu=false;
    const win=getCurrentWindow();
    const from=mode;
    try {
      await persist();
      const current=(await readOuter()).bounds;
      if(from==='window') savedWindow=current;
      if(from==='panel') panelWidth=current.width;
      const all=await displays();
      const display=displayFor(savedWindow??current,all)??all[0];
      const visible=from==='window'||from==='panel';
      if(next==='window') {
        const target=savedWindow??current;
        if(visible) await fadeOut(nudge(current,from==='panel'?side:'up',12),140);
        await win.setMinSize(new LogicalSize(CENTER_WINDOW_MIN.width,CENTER_WINDOW_MIN.height));
        if(visible) await win.hide();
        sidebar=true;
        await showFaded(target,nudge(target,'up'),240);
        await hideDock();
      } else if(next==='panel') {
        const target=panelBounds(display,nextSide,panelWidth,railInset(nextSide));
        if(visible) { await fadeOut(undefined,140); await win.hide(); }
        await win.setMinSize(new LogicalSize(CENTER_PANEL.minWidth,CENTER_WINDOW_MIN.height));
        sidebar=false;
        // Glide out from the edge it is docked to, staying on the same display.
        await showFaded(target,nudge(target,nextSide),260);
        await hideDock();
      } else if(next==='handle') {
        const panel=from==='panel'?current:panelBounds(display,nextSide,panelWidth,railInset(nextSide));
        await showDock('handle',handleBounds(display,nextSide));
        if(visible) { await fadeOut(nudge(current,nextSide),180); await hideFaded(); }
        // Park the hidden window where the panel will glide back out.
        await win.setMinSize(new LogicalSize(CENTER_PANEL.minWidth,CENTER_WINDOW_MIN.height));
        await applyOuter(panel);
      } else {
        await showDock('bar',barBounds(savedWindow??current,all));
        if(visible) { await fadeOut(undefined,160); await hideFaded(); }
      }
      mode=next; side=nextSide;
      if(next==='window'||next==='panel') await win.setFocus();
      status=next==='bar'?'已收起为条 · 点击条展开':next==='handle'?'已收起到边缘 · 点击把手展开':next==='panel'?`已停靠到${nextSide==='left'?'左':'右'}侧`:'已恢复窗口';
    } catch(error) {
      status=`窗口切换失败：${error}`;
      if(mac) await animateWindow({alpha:1,duration:0}).catch(()=>{});
      await win.show().catch(()=>{}); await hideDock().catch(()=>{});
    }
    finally { modeBusy=false; }
  }
  /** Shown from outside (tray, relaunch) while collapsed: adopt the expanded form in place. */
  async function adoptShown() {
    if(mode==='bar') mode='window'; else if(mode==='handle') mode='panel'; else return;
    if(mac) await animateWindow({alpha:1,duration:0}).catch(()=>{});
    await hideDock();
  }
  async function expandCenter() { await applyMode(mode==='handle'?'panel':mode==='bar'?'window':mode); }
  async function dockSide() {
    const current=(await readOuter()).bounds; const all=await displays();
    await applyMode('panel',nearestSide(current,displayFor(current,all)??all[0]));
  }
  async function togglePinned() {
    pinned=!pinned;
    try { await getCurrentWindow().setAlwaysOnTop(pinned); status=pinned?'便签中心已置顶':'已取消中心置顶'; }
    catch(error) { pinned=!pinned; status=`置顶失败：${error}`; }
  }
  // Entering a narrow layout closes the list drawer; it opens on demand.
  $effect(()=>{ if(narrow) sidebar=false; });
  let tabStrip=$state<HTMLDivElement>();
  let tabsOverflow=$state(false);
  $effect(()=>{
    void tabs.length;
    if(!tabStrip) return;
    const strip=tabStrip;
    const measure=()=>{ tabsOverflow=strip.scrollWidth>strip.clientWidth+1; };
    const observer=new ResizeObserver(measure); observer.observe(strip); measure();
    return()=>observer.disconnect();
  });

  onMount(()=>{
    const setup=(async()=>{
      await refresh();
      const settings=await loadSettings();
      await registerGlobalShortcuts(settings.shortcuts,{toggleWindow:toggleDesktop,newNote:()=>void run(create)});
      const hidden=await invoke<boolean>('startup_hidden');
      restoreSession(hidden);
      if(!hidden) await getCurrentWindow().show();
      if(!hidden && mode!=='window') { const target=mode; mode='window'; await applyMode(target); }
      else mode='window';
      if(pinned) await getCurrentWindow().setAlwaysOnTop(true);
      for(const note of notes.filter(n=>n.lifecycle==='active'&&n.placement==='desktop')) {
        if(!(await invoke<boolean>('startup_hidden'))) await openNoteWindow(note);
      }
      status='已就绪';
    })().catch(e=>{status=String(e); void getCurrentWindow().show();});
    const changes=listen<{id:string;op:string;note:PinNote|null}>('notes-changed',async({payload})=>{
      if(payload.op==='window'&&payload.id===draft?.id&&payload.note){
        // Collapsing or expanding a desktop window moves the editor between it and here.
        draft={...draft,window:payload.note.window}; if(handoff===payload.id) handoff='';
        await refresh(); if(dockKind) void syncDock(); return;
      }
      if(payload.op==='appearance'&&payload.id===draft?.id&&payload.note){draft={...draft,theme:payload.note.theme,customColor:payload.note.customColor,opacity:payload.note.opacity,alwaysOnTop:payload.note.alwaysOnTop};await refresh();return;}
      editor?.flush(); await refresh();
      if(payload.op==='trash'||payload.op==='archive') {const h=(await loadNotes()).history?.filter(h=>h.note.id===payload.id).at(-1);if(h)undo={id:payload.id,at:h.at};}
      if(draft?.id===payload.id && !hasPendingSave(payload.id) && payload.note && payload.note.revision>draft.revision) {
        const changed=draft.content!==payload.note.content || draft.placement!==payload.note.placement || draft.lifecycle!==payload.note.lifecycle;
        draft=structuredClone(payload.note); if(changed) revision++;
      }
    });
    const reminder=listen<{note:PinNote;error?:string}>('reminder-due',async({payload})=>{await refresh();status=payload.error?`通知发送失败：${payload.error}`:`提醒：${payload.note.title}`;});
    const reminderError=listen<string>('reminder-error',e=>{status=`提醒调度失败：${e.payload}`;});
    const newNote=listen('new-note-requested',()=>void run(create));
    // A desktop window is expanding: save our draft of that note and stop editing it here.
    const release=listen<{id:string}>('release-note-editor',async({payload})=>{
      const id=payload.id;
      try {
        if(draft?.id===id){ editor?.flush(); handoff=id; clearTimeout(handoffTimer); handoffTimer=setTimeout(()=>{if(handoff===id)handoff='';},5000); }
        await flushNoteSave(id);
        await answerRelease(id,true);
      } catch(error) {
        if(handoff===id) handoff='';
        status=`草稿未保存，桌面便签保持收起：${error}`;
        await answerRelease(id,false,`便签中心的草稿未保存：${error}`);
      }
    });
    const dockHello=listen('center-dock-hello',()=>void syncDock());
    const dockAction=listen<{action:'expand'|'new'}>('center-dock-action',({payload})=>{
      if(payload.action==='new') void run(async()=>{ await expandCenter(); await create(); });
      else void expandCenter();
    });
    const focus=getCurrentWindow().onFocusChanged(({payload})=>{
      // Shown from the tray or a second launch while collapsed: adopt the expanded form.
      if(payload && !modeBusy && (mode==='bar'||mode==='handle')) void adoptShown();
    });
    const agentOpen=listen<{id:string}>('agent-open-note',e=>void run(async()=>{await persist();const n=(await loadNotes()).notes[e.payload.id];await openNoteWindow(n);if(draft?.id===n.id)await select(n.id);}));
    const toggle=listen('toggle-notes-visibility-requested',toggleDesktop);
    const settings=listen('open-settings-requested',()=>void openSettingsWindow());
    const settingsChanged=listen('settings-changed',async()=>{const s=await loadSettings(); await registerGlobalShortcuts(s.shortcuts,{toggleWindow:toggleDesktop,newNote:()=>void run(create)});});
    const close=getCurrentWindow().onCloseRequested(e=>{e.preventDefault(); void run(async()=>{await persist(); await getCurrentWindow().hide();});});
    async function saveForQuit(attempt:number) {
      if(!quitGuard.begin(attempt)) return;
      document.body.inert=true;
      try{await setup;await persist();await invoke('quit_save_complete',{success:true,attempt});}
      catch(error){if(quitGuard.isCurrent(attempt))document.body.inert=false;status=String(error);await invoke('quit_save_complete',{success:false,attempt});}
    }
    const quit=listen<number>('save-before-quit',e=>void saveForQuit(e.payload));
    void quit.then(async()=>{const attempt=await invoke<number|null>('pending_quit');if(attempt!=null)void saveForQuit(attempt);});
    const cancelled=listen<number>('quit-save-cancelled',e=>{if(quitGuard.cancel(e.payload))document.body.inert=false;});
    const failed=listen<number>('quit-save-failed',e=>{if(quitGuard.cancel(e.payload))document.body.inert=false;});
    return()=>{[changes,newNote,toggle,settings,settingsChanged,close,quit,cancelled,failed,reminder,reminderError,agentOpen,release,dockHello,dockAction,focus].forEach(p=>p.then(f=>f()));void unregisterGlobalShortcuts();clearTimeout(handoffTimer);};
  });
</script>

<svelte:window bind:innerWidth={width}/>
<main class:folded={!sidebar||narrow} class:narrow class:drawer={narrow&&sidebar} class:mac>
  {#if narrow}<button class="scrim" tabindex="-1" aria-label="关闭列表" onclick={()=>sidebar=false}></button>{/if}
  <aside inert={!sidebar} aria-hidden={!sidebar}>
    <div class="side-inner">
      {#if mac}<div class="titlebar-space" data-tauri-drag-region></div>{/if}
      <div class="search"><Search size={15}/><input aria-label="搜索标题和正文" placeholder="搜索便签" bind:value={query}/><button aria-label="新建便签" title="新建便签" onclick={()=>run(create)}><Plus size={17}/></button></div>
      <nav><button class:active={filter==='active'} onclick={()=>filter='active'}>全部便签</button><button class:active={filter==='desktop'} onclick={()=>filter='desktop'}>桌面便签</button></nav>
      <div class="list">
        {#each due as item}<div class="due"><button onclick={()=>run(()=>select(item.id))}>提醒 · {item.title}</button><button onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:Date.now()+10*60000});await refresh();})}>10 分钟后</button><button aria-label="关闭提醒" onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:null});await refresh();})}><X size={12}/></button></div>{/each}
        {#each visible as note(note.id)}
          {@const tasks=checklistProgress(note.content)}
          <button animate:flip={{duration:240,easing:cubicOut}} class="note-row" class:chosen={selected===note.id} onclick={()=>run(async()=>{await select(note.id);if(narrow)sidebar=false;})} draggable="true" ondragstart={e=>e.dataTransfer?.setData('text/pinnote',note.id)}>
             <span class="row-heading"><i class="note-dot" style:background={note.theme==='paper'?'#d4d4d8':note.theme==='custom'?note.customColor:({mint:'#72bca0',rose:'#df9d9a',sky:'#7dafe1',grape:'#b69bd6',ink:'#555'}[note.theme])}></i><b>{note.title||'未命名便签'}</b>{#if note.placement==='desktop'}<Monitor size={12}/>{/if}</span><small>{note.content.replace(/[#*`\[\]]/g,'').slice(0,100)||'空白便签'}</small>
             {#if tasks.total}<small class="list-progress">{tasks.total-tasks.done ? `${tasks.total-tasks.done} 项待办`:'待办已完成'}</small>{/if}
          </button>
        {:else}<p class="empty">{query?'没有匹配的便签':'这里还没有便签'}</p>{/each}
      </div>
      <footer><button class:active={filter==='archived'} onclick={()=>filter='archived'}><Archive size={14}/>归档</button><button class:active={filter==='trash'} onclick={()=>filter='trash'}><Trash2 size={14}/>回收站</button><button aria-label="设置" onclick={()=>openSettingsWindow()}><Settings size={15}/></button></footer>
    </div>
  </aside>
  <section class="work" class:ink={draft?.theme==='ink'} style:--pin-bg={draft?noteBackground(draft.theme,draft.customColor):'#fff'} inert={busy}>
    <header class="tabs" data-tauri-drag-region><button class="list-toggle" aria-label={sidebar?'隐藏列表':'显示列表'} title={sidebar?'隐藏列表':'显示列表'} onclick={()=>sidebar=!sidebar}><PanelLeft size={17}/></button>
      <div class="tab-strip" bind:this={tabStrip} data-tauri-drag-region>
        {#each tabs as id(id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="tab" class:current={selected===id} animate:flip={{duration:200,easing:cubicOut}} draggable="true" ondragstart={()=>dragTab=id} ondragover={e=>e.preventDefault()} ondrop={()=>reorder(id)}>
            <button class="tab-title" title={notes.find(n=>n.id===id)?.title||'未命名便签'} onclick={()=>run(()=>select(id))}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</button><button class="tab-close" aria-label="关闭 Tab" onclick={()=>run(()=>closeTab(id))}><X size={12}/></button>
          </div>
        {/each}
      </div>
      {#if tabsOverflow}<select aria-label="更多工作便签" value={selected} onchange={e=>run(()=>select(e.currentTarget.value))}>{#each tabs as id}<option value={id}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</option>{/each}</select>{/if}
      <div class="window-tools">
        <button class:on={pinned} aria-pressed={pinned} aria-label={pinned?'取消置顶便签中心':'置顶便签中心'} title={pinned?'取消置顶便签中心':'置顶便签中心'} onclick={togglePinned}>{#if pinned}<PinOff size={15}/>{:else}<Pin size={15}/>{/if}</button>
        {#if mode==='panel'}
          <button aria-label="收起到边缘" title="收起到边缘" onclick={()=>applyMode('handle')}>{#if side==='left'}<ChevronsLeft size={16}/>{:else}<ChevronsRight size={16}/>{/if}</button>
          <button aria-label="取消停靠" title="取消停靠，恢复窗口" onclick={()=>applyMode('window')}><Maximize2 size={14}/></button>
        {:else}
          <button aria-label="停靠到侧边" title="停靠到侧边" onclick={dockSide}><PanelRight size={15}/></button>
          <button aria-label="收起为条" title="收起为条" onclick={()=>applyMode('bar')}><Minimize2 size={15}/></button>
        {/if}
      </div>
    </header>
    {#if draft}
      <div class="title-row">
        <input aria-label="便签标题" value={draft.title} readonly={!editable} oninput={e=>update({title:e.currentTarget.value})}/>
        {#if draft.lifecycle==='active'}<NoteColorPicker theme={draft.theme} customColor={draft.customColor} onChange={changeColor}/>{/if}
        {#if draft.reminder}<button class="time" onclick={()=>reminderOpen=true}>{new Date(draft.reminder.at).toLocaleString()}</button>{/if}
        {#if draft.lifecycle==='active'}
          <button class="desktop" disabled={busy} onclick={()=>run(desktop)} ondragover={e=>e.preventDefault()} ondrop={e=>{e.preventDefault();const id=e.dataTransfer?.getData('text/pinnote');void run(async()=>{if(id)await select(id);await desktop();});}}><Monitor size={15}/>{draft.placement==='desktop'?'定位窗口':'放到桌面'}</button>
        {/if}
        <button class="more" aria-label="更多操作" onclick={()=>menu=!menu}><MoreHorizontal size={18}/></button>
        {#if menu}<div class="menu" use:popup={()=>menu=false} transition:reveal role="dialog" tabindex="-1">
          {#if draft.lifecycle==='active'}
            <button onclick={()=>{menu=false;reminderOpen=true;}}>设置提醒</button>
            {#if editable && progress.done}<button onclick={()=>{editor?.clearCompleted();menu=false;}}>移除已完成项（可撤销）</button>{/if}
            {#if draft.placement==='desktop'}<button onclick={()=>run(recall)}>收回中心</button>{/if}
            <button onclick={()=>run(()=>operation('archive'))}>归档</button><button onclick={()=>run(()=>operation('trash'))}>移到回收站</button>
          {:else}<button onclick={()=>run(()=>operation('restore'))}>恢复到中心</button>{#if draft.lifecycle==='trash'}<button class="danger" onclick={()=>run(()=>operation('purge'))}>永久删除</button>{/if}{/if}
          <button onclick={()=>run(async()=>{if(!draft)return;const copy=createNote({title:`${draft.title}（草稿副本）`,content:draft.content});await saveNoteNow(copy);await select(copy.id);})}>保留草稿为新便签</button>
          <button onclick={()=>run(async()=>{if(!draft)return;const fresh=(await loadNotes()).notes[draft.id];if(hasPendingSave(draft.id)&&!window.confirm('放弃本地草稿并载入已保存版本？'))return;const {discardPendingSave}=await import('$lib/notesStore');discardPendingSave(draft.id);draft=fresh;revision++;})}>重新载入已保存版本</button>
        </div>{/if}
      </div>
      {#if editable}
        {#key `${selected}:${revision}`}<MilkdownEditor bind:this={editor} value={draft.content} onChange={content=>update({content})} initialPosition={positions.get(selected)} onReminder={()=>reminderOpen=true}/>{/key}
      {:else}
        <div class="preview" transition:reveal>
          {#if desktopEditing}<div class="notice">正在桌面窗口编辑 <button onclick={()=>run(editHere)}><PenLine size={13}/>在这里编辑</button><button onclick={()=>run(recall)}>收回中心</button></div>{/if}
          {#if draft.lifecycle!=='active'}<div class="notice">{draft.lifecycle==='trash'?'已在回收站':'已归档'} <button onclick={()=>run(()=>operation('restore'))}>恢复</button></div>{/if}
          {#key `${selected}:${revision}`}<MilkdownEditor readonly value={draft.content} onChange={()=>{}} onReminder={draft.lifecycle==='active'?()=>reminderOpen=true:undefined}/>{/key}
        </div>
      {/if}
    {:else}<div class="empty-work"><p>选择一张便签，开始书写</p><button onclick={()=>run(create)}><Plus size={15}/>新建便签</button></div>{/if}
    <div class="status" role="status">{status}{#if undo}<button onclick={()=>run(undoLast)}>撤销移除</button>{/if}</div>
  </section>
</main>
{#if reminderOpen&&draft}<ReminderDialog currentAt={draft.reminder?.at} onClose={()=>reminderOpen=false} onSet={async at=>{await persist();const note=(await loadNotes()).notes[draft!.id];await noteOperation(note,'reminder',{at});draft=note;await refresh();}}/>{/if}

<style>
 :global(*){box-sizing:border-box}:global(body){margin:0;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#171717;background:#fff}
  .time{font-size:11px;color:#2563eb;background:#eff6ff}.due{display:flex;flex-wrap:wrap;font-size:11px;background:#eff6ff;border-radius:6px;margin:4px}.due button{font-size:11px}
  .note-row .row-heading{justify-content:flex-start}.row-heading b{flex:1;overflow:hidden;text-overflow:ellipsis;font-weight:500}.preview :global(pre){white-space:pre-wrap;overflow-wrap:anywhere}
 .work{background:var(--pin-bg);color:var(--pin-text);transition:background 180ms,color 180ms}.work.ink{--pin-text:#f5f5f5;--pin-heading:#fff;--pin-muted:#aaa;--pin-border:#ffffff20;--pin-accent:#93b4ff;--pin-accent-strong:#b6cdff;--pin-active:#343434}.title-row input{background:transparent}.tabs{background:#fafafa;color:#171717}.note-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0}.note-row .list-progress{color:#2563eb;font-size:10px}.preview{display:flex;flex-direction:column;min-height:0}.preview :global(.editor-layout){flex:1;min-height:0}.preview .notice{margin-bottom:8px;color:var(--pin-muted);background:color-mix(in srgb,var(--pin-text),transparent 96%)}@media(prefers-reduced-motion:reduce){.work{transition:none}}
 main{--pin-text:#171717;--pin-heading:#111;--pin-muted:#737373;--pin-accent:#2563eb;--pin-accent-strong:#1d4ed8;--pin-border:#e5e7eb;--pin-bg:#fff;display:grid;grid-template-columns:230px minmax(0,1fr);height:100vh;overflow:hidden}main.folded{grid-template-columns:minmax(0,1fr)}
 aside{background:#fafafa;border-right:1px solid #ededee;display:flex;flex-direction:column;min-height:0}.search{display:flex;align-items:center;gap:8px;padding:14px 10px}.search input{min-width:0;width:100%;background:transparent}input{font:inherit;border:0;outline:0;color:inherit}input:focus{box-shadow:0 1px #2563eb}
 button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:6px;background:transparent;color:inherit;padding:6px 8px;font:inherit;cursor:pointer;transition:background 140ms,transform 140ms}button:hover{background:#eee}button:active{transform:scale(.97)}button:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}button:disabled{opacity:.5;cursor:wait}.active,.chosen{color:#2563eb!important;background:#eff6ff!important}nav{display:flex;padding:0 8px 10px;gap:5px}nav button{font-size:12px;flex:1}.list{flex:1;overflow:auto;padding:0 7px}.note-row{display:block;width:100%;text-align:left;padding:10px;margin:2px 0}.note-row span{display:flex;align-items:center;justify-content:space-between;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.note-row small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#888;margin-top:3px;font-size:12px}footer{display:flex;padding:8px;gap:5px}footer button{font-size:12px;color:#737373}footer button:last-child{margin-left:auto}.work{display:grid;grid-template-rows:42px auto minmax(0,1fr) 30px;min-width:0;min-height:0}.tabs{display:flex;gap:5px;align-items:center;padding:5px 8px;border-bottom:1px solid #eee;min-width:0}.tab-strip{display:flex;min-width:0;overflow:hidden;flex:1;gap:4px}.tab{display:flex;min-width:110px;max-width:180px;border-radius:6px}.tab button:first-child{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.tab button:last-child{padding:5px}.tabs select{max-width:110px;border:0;background:#f5f5f5;border-radius:5px}.title-row{display:flex;align-items:center;gap:8px;padding:16px 20px;position:relative}.title-row input{flex:1;min-width:0;font-size:17px;font-weight:600}.desktop{font-size:12px;color:#2563eb}.more{border-radius:50%;background:#f5f5f5}.menu{position:absolute;right:12px;top:53px;z-index:10;width:210px;padding:5px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px #0001}.menu button{display:block;text-align:left;width:100%;font-size:12px}.danger{color:#dc2626}.preview{overflow:auto;padding:0 22px 22px}.notice{color:#737373;font-size:12px;background:#fafafa;padding:8px;border-radius:6px}.notice button{color:#2563eb}.empty,.empty-work{color:#888;padding:16px}.empty-work{grid-row:2/4;display:flex;align-items:center;justify-content:center;flex-direction:column}.empty-work button{color:#2563eb}.status{grid-row:4;padding:4px 16px;color:#737373;font-size:11px;overflow:auto;border-top:1px solid #f5f5f5}.status button{font-size:11px;color:#2563eb;padding:0 8px}@media(max-width:700px){main{grid-template-columns:190px minmax(0,1fr)}.title-row{padding:12px}.desktop{font-size:11px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
 .window-tools{display:flex;align-items:center;gap:2px;margin-left:auto;padding-left:6px;border-left:1px solid #eee}.window-tools button{padding:5px;color:#737373}.window-tools button:hover{color:#171717}.window-tools .on{color:#2563eb;background:#eff6ff}
 .notice{display:flex;align-items:center;gap:6px}.notice button{padding:2px 6px;gap:4px}
 /* Narrow (docked panel or small window): single column, list as a drawer. */
 main.narrow{position:relative}main.narrow aside{position:absolute;z-index:30;top:0;bottom:0;left:0;width:min(280px,85%);box-shadow:8px 0 24px #0000001a}.scrim{position:absolute;z-index:29;inset:0;border-radius:0;background:#0000000d;padding:0}.scrim:hover{background:#0000000d}.scrim:active{transform:none}
 main.narrow .title-row{padding:12px 14px}main.narrow .tab{min-width:84px}main.narrow .desktop{padding:6px}
 /* ---- macOS-like chrome: unified title bar, animated sidebar, compact tabs ---- */
 main{grid-template-columns:230px minmax(0,1fr);transition:grid-template-columns 260ms cubic-bezier(.2,.85,.25,1)}
 main.folded{grid-template-columns:0px minmax(0,1fr)}
 .work{grid-column:2;grid-row:1;grid-template-rows:44px auto minmax(0,1fr) 30px}
 aside{grid-column:1;grid-row:1;min-width:0;overflow:hidden;display:block}
 .side-inner{width:230px;height:100%;display:flex;flex-direction:column}
 .titlebar-space{height:36px;flex:0 0 auto}
 main.mac .search{padding-top:4px}
 main.narrow aside{transform:translateX(-100%);transition:transform 280ms cubic-bezier(.2,.85,.25,1),box-shadow 280ms;box-shadow:none}
 main.narrow.drawer aside{transform:none;box-shadow:8px 0 28px #0000001f}
 main.narrow .side-inner{width:100%}
 .scrim{opacity:0;pointer-events:none;transition:opacity 220ms}main.drawer .scrim{opacity:1;pointer-events:auto}
 .tabs{height:44px;padding:0 8px;gap:6px;background:#f7f7f8;border-bottom:1px solid #0000000f;transition:padding-left 260ms cubic-bezier(.2,.85,.25,1)}
 main.mac.folded .tabs{padding-left:84px}
 .list-toggle{padding:5px;color:#737373}
 .tab-strip{align-items:center;gap:2px}
 .tab{position:relative;align-items:center;flex:0 1 auto;min-width:72px;max-width:200px;height:28px;padding:0 3px 0 10px;border-radius:7px;color:#525252;transition:background 160ms,color 160ms,box-shadow 160ms}
 .tab:hover{background:#0000000a}
 .tab.current{background:#fff;color:#171717;box-shadow:0 0 0 .5px #0000001f,0 1px 2px #00000012}
 .tab button{padding:0;background:none;border-radius:5px}.tab button:hover{background:none}.tab button:active{transform:none}
 .tab .tab-title{flex:1;justify-content:flex-start;height:100%;font-size:12.5px;line-height:28px}
 .tab .tab-close{flex:0 0 auto;width:18px;height:18px;margin-left:4px;color:#737373;opacity:0;transition:opacity 140ms,background 140ms}
 .tab:hover .tab-close,.tab.current .tab-close,.tab-close:focus-visible{opacity:1}
 .tab .tab-close:hover{background:#00000012;color:#171717}
 /* Title shares the editor's reading column so heading and body line up. */
 .title-row{width:100%;max-width:866px;margin:0 auto;padding:18px 30px 8px 14px}
 .preview{width:100%}.preview .notice{max-width:820px;margin:0 auto 8px;width:100%}
 @media(prefers-reduced-motion:reduce){main,main.narrow aside,.scrim,.tabs,.tab,.tab .tab-close{transition:none}}
</style>
