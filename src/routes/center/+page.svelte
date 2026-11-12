<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, emit, emitTo } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PanelLeft, Plus, X, MoreHorizontal, Monitor, Archive, Trash2, Settings, Search, Pin, Minimize2, ChevronsLeft, ChevronsRight, PenLine, ChevronDown, ClockArrowDown } from 'lucide-svelte';
  import { answerRelease } from '$lib/editorHandoff';
  import { fitBounds } from '$lib/windowGeometry';
  import { validWindow } from '$lib/centerLayout';
  import { CenterForm } from '$lib/centerForm.svelte';
  import MilkdownEditor from '../../components/MilkdownEditor.svelte';
  import { createNote, loadNotes, notesSnapshot, applyNoteChange, saveNoteNow, scheduleNoteSave, flushNoteSave, noteOperation, hasLocalEdits, discardPendingSave, markEdited, markSettled, classifyChange, noteConflict, onNoteConflict, keepLocalVersion, takeRemoteVersion, NoteConflictError, type PinNote, type NoteChange } from '$lib/notesStore';
  import DraftBanner from '../../components/DraftBanner.svelte';
  import { openNoteWindow, findNoteWindow } from '$lib/noteWindows';
  import { requestWindowVisibility } from '$lib/windowVisibility';
  import { loadSettings, isMacPlatform } from '$lib/settings';
  import { registerGlobalShortcuts, unregisterGlobalShortcuts } from '$lib/shortcuts';
  import CenterSettings from '../../components/CenterSettings.svelte';
  import { onAppearance } from '$lib/theme';
  import { defaultSettings, type AppSettings } from '$lib/settings';
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { defaultMarkdownFilename } from '$lib/filename';
  import { reveal, popup, shift } from '$lib/motion';
  import { createQuitGuard } from '$lib/quitGuard';
  import ReminderDialog from '../../components/ReminderDialog.svelte';
  import { checklistProgress } from '$lib/checklist';
  import NoteColorPicker from '../../components/NoteColorPicker.svelte';
  import {noteBackground,noteTint,noteDot} from '$lib/noteAppearance';
  import { plainExcerpt, shortTime, listTime } from '$lib/excerpt';
  import { sortable, moveAmong, arrange, type SortDrag } from '$lib/sortable';
  import { LIST_WIDTH, clampListWidth } from '$lib/centerLayout';
  import type {NoteTheme} from '$lib/settings';
  let reminderOpen=$state(false);
  let due=$state<PinNote[]>([]);
  const quitGuard = createQuitGuard();

  // Raw: rows keep their object identity, so an event re-renders only the changed note.
  let notes = $state.raw<PinNote[]>([]);
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
  // Draft safety for the open note: a version conflict, or the last failed save.
  let conflict = $state(false);
  let saveError = $state('');
  const errorText = (e:unknown) => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/,'');
  let undo = $state<{id:string;at:number}|null>(null);
  // Manual list arrangement and list width live in the center session (see restoreSession).
  let order = $state<string[]>([]);
  let listWidth = $state(LIST_WIDTH.default);
  let resizing = $state(false);
  let rowDrag = $state<SortDrag|null>(null);
  // Re-renders list times once a minute so "14:20" becomes "昨天" after midnight.
  let clock = $state(Date.now());
  const editedAt = (n:PinNote) => n.editedAt ?? n.updatedAt;
  const positions = new Map<string,{from:number;to:number;scroll:number}>();
  // List summaries (excerpt, to-do counts, search text) are derived once per note version.
  const summaries=new Map<string,{note:PinNote;excerpt:string;tasks:{done:number;total:number};search:string}>();
  function summary(n:PinNote){
    let s=summaries.get(n.id);
    if(!s||s.note.content!==n.content||s.note.title!==n.title){
      s={note:n,excerpt:plainExcerpt(n.content,100,{title:n.title}).replace(/\s*\n+\s*/g,' '),tasks:checklistProgress(n.content),search:`${n.title}\n${n.content}`.toLowerCase()};
      summaries.set(n.id,s);
    }
    return s;
  }
  const arranged = $derived(arrange(notes, order));
  const visible = $derived.by(()=>{const q=query.toLowerCase();return arranged.filter(n => (filter === 'desktop' ? n.lifecycle === 'active' && n.placement === 'desktop' : n.lifecycle === filter) && (!q||summary(n).search.includes(q)));});
  // One writer per note: the center edits center notes and desktop notes that are only a
  // capsule/edge tab. An expanded desktop window owns its note until editing is handed back.
  let handoff = $state('');
  let handoffTimer: ReturnType<typeof setTimeout>;
  const editable = $derived(draft?.lifecycle === 'active' && (draft.placement === 'center' || (Boolean(draft.window?.collapsed) && handoff !== draft.id)));
  const desktopEditing = $derived(draft?.lifecycle === 'active' && draft.placement === 'desktop' && !draft.window?.collapsed);

  async function refresh() {
    const all=(await notesSnapshot()).notes;
    notes = Object.values(all).sort((a,b)=>editedAt(b)-editedAt(a));
    for(const id of summaries.keys()) if(!all[id]) summaries.delete(id);
    due=notes.filter(n=>n.lifecycle==='active'&&n.reminder?.state==='delivered');
  }
  async function run(action:()=>Promise<void>) {
    if(busy) return; busy=true;
    try { await action(); } catch(e) { status=String(e); } finally { busy=false; }
  }
  /** Save the open draft now (switch, handoff, window change, quit). A failure keeps the draft and throws. */
  async function persist() {
    editor?.flush();
    if(draft && editable) {
      const pos=editor?.capture(); if(pos) positions.set(draft.id,pos);
      try { await flushNoteSave(draft.id); saveError=''; }
      catch(e) { if(!(e instanceof NoteConflictError)) saveError=errorText(e); throw e; }
    }
  }
  /** Leaving the open note needs its draft saved; otherwise stay on it and say why. */
  async function leaveDraft() {
    try { await persist(); return true; }
    catch(e) { status=e instanceof NoteConflictError?'先处理这张便签的版本冲突，再切换':'草稿未保存，仍停留在这张便签'; return false; }
  }
  async function select(id:string, force=false) {
    // Re-selecting the open note keeps its editor, selection and undo history.
    if(id===selected && draft && !force) { menu=false; return; }
    if(!await leaveDraft()) return;
    const note=(await notesSnapshot()).notes[id]; if(!note) return;
    selected=id; draft=structuredClone($state.snapshot(note));
    conflict=Boolean(noteConflict(id)); saveError='';
    if(!tabs.includes(id)) tabs=[...tabs,id];
    revision++; menu=false;
  }
  function update(patch:Partial<PinNote>) {
    if(!draft || !editable) return;
    // No per-keystroke status churn or extra list reloads: notes-changed refreshes the list.
    draft={...draft,...patch};
    const id=draft.id;
    scheduleNoteSave(draft,e=>{
      if(draft?.id!==id) return;
      if(!e){saveError='';status='已保存';}
      else if(!(e instanceof NoteConflictError)) saveError=errorText(e);
    },'body');
  }
  /** Conflict: overwrite the other version with this draft. */
  async function keepMine() {
    if(!draft) return; editor?.flush();
    await keepLocalVersion(draft.id);
    conflict=false; saveError=''; status='已保留你的修改并保存';
    await refresh();
  }
  /** Conflict: load the other version; a differing draft is kept as a new note. */
  async function takeTheirs(reason='已载入新版本') {
    if(!draft) return;
    const id=draft.id; let last={title:draft.title,content:draft.content};
    // Re-read on every pass: typing continues while the copy is written.
    const {remote,copy}=await takeRemoteVersion(id,()=>{ if(draft?.id===id){ editor?.flush(); last={title:draft.title,content:draft.content}; } return last; });
    if(!remote||draft?.id!==id) return;
    conflict=false; saveError=''; draft=structuredClone(remote); revision++;
    await refresh();
    if(copy&&!tabs.includes(copy.id)) tabs=[...tabs,copy.id];
    status=copy?`${reason} · 你的草稿另存为「${copy.title}」`:reason;
  }
  async function retrySave() {
    if(!draft) return; editor?.flush();
    await flushNoteSave(draft.id); saveError=''; status='已保存';
    await refresh();
  }
  async function create() {
    await persist();
    // New notes take the configured defaults; existing notes keep their own colours.
    const d=appSettings.defaultNote;
    const note=createNote({title:'未命名便签',content:'',placement:'center',theme:d.theme,customColor:d.customColor,opacity:d.opacity,alwaysOnTop:d.alwaysOnTop});
    await saveNoteNow(note); await select(note.id);
    await getCurrentWindow().show(); await getCurrentWindow().setFocus();
  }
  async function closeTab(id:string) {
    if(id===selected && !await leaveDraft()) return;
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
    await select(id,true); status='已收回中心 · 编辑历史从此处重新开始';
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
    if(op==='purge') await closeTab(id); else await select(id,true);
    status=op==='trash'?'已移到回收站':op==='archive'?'已归档':'已恢复到中心';
  }
  async function undoLast() {
    if(!undo) return; await persist();
    const note=(await loadNotes()).notes[undo.id]; await noteOperation(note,'undo',{historyId:undo.at});
    await select(note.id,true); undo=null; status='已撤销';
  }
  /** Settings open inside the center; a collapsed center is restored first. */
  async function openSettings() {
    menu=false; windowMenu=false;
    // Settings can restore history versions: save what is typed first. A failed
    // save is shown in the editor and stays protected; settings still open.
    await persist().catch(()=>undefined);
    if(form.mode!=='window') await form.expand();
    else { await getCurrentWindow().show(); await getCurrentWindow().setFocus(); }
    settingsOpen=true;
  }
  async function exportCurrent() {
    if(!draft) return;
    await persist();
    try {
      const path=await saveDialog({title:'导出 Markdown',defaultPath:defaultMarkdownFilename(draft.title),filters:[{name:'Markdown',extensions:['md']}]});
      if(!path){status='已取消导出';return;}
      const target=path.toLowerCase().endsWith('.md')?path:`${path}.md`;
      await invoke('write_markdown_file',{path:target,content:draft.content});
      status=`已导出 ${target.split(/[\\/]/).at(-1)}`;
    } catch(error) { status=`导出失败：${error}`; }
  }
  /** A list row was released: reorder, or drop on 放到桌面 / the tab strip. */
  function dropRow(id:string, index:number|null, target:Element|null) {
    if(index!==null){ order=moveAmong(arranged.map(n=>n.id), visible.map(n=>n.id), id, index); return; }
    if(target?.closest('[data-drop-desktop]')) void run(async()=>{ await select(id); await desktop(); });
    else if(target?.closest('.tabs')) void run(()=>select(id));
  }
  function dropTab(id:string, index:number|null) { if(index!==null) tabs=moveAmong(tabs, tabs, id, index); }
  /** Drag the list's right edge; double-click resets it. */
  function resizeList(event:PointerEvent) {
    if(event.button!==0) return;
    event.preventDefault();
    const handle=event.currentTarget as HTMLElement; handle.setPointerCapture(event.pointerId);
    const start=event.clientX, from=shownListWidth; resizing=true;
    const move=(e:PointerEvent)=>{ listWidth=clampListWidth(from+e.clientX-start); };
    const end=()=>{ resizing=false; handle.removeEventListener('pointermove',move); handle.removeEventListener('pointerup',end); handle.removeEventListener('pointercancel',end); };
    handle.addEventListener('pointermove',move); handle.addEventListener('pointerup',end); handle.addEventListener('pointercancel',end);
  }
  function resizeKey(event:KeyboardEvent) {
    const step=event.shiftKey?40:10;
    if(event.key==='ArrowLeft'){ event.preventDefault(); listWidth=clampListWidth(shownListWidth-step); }
    else if(event.key==='ArrowRight'){ event.preventDefault(); listWidth=clampListWidth(shownListWidth+step); }
  }
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
  // ---- Center window form: normal window ⇄ edge handle (strip only from the window menu). ----
  const mac=isMacPlatform();
  let width=$state(960);
  let windowMenu=$state(false);
  let appSettings:AppSettings=structuredClone(defaultSettings);
  let settingsOpen=$state(false);
  let shortcutStatus=$state('');
  const edgeSnap=()=>appSettings.behavior.edgeSnap;
  const form=new CenterForm({
    persist,
    notes:()=>notes,
    title:()=>draft?.title||(notes.length?'':'还没有便签'),
    status:text=>status=text,
    edgeSnap,
  });
  const narrow=$derived(width<640);
  // The editor keeps at least 380px; the saved width comes back when the window grows again.
  const shownListWidth=$derived(Math.max(LIST_WIDTH.min, Math.min(listWidth, width-380)));
  let restored=false;
  function restoreSession() {
    const session=form.restore();
    if(!appSettings.behavior.restoreSession){ session.tabs=[]; session.selected=''; }
    // Reopen the last working tabs and note.
    tabs=session.tabs.filter(id=>notes.some(n=>n.id===id));
    order=session.order; listWidth=session.listWidth;
    const last=notes.find(n=>n.id===session.selected);
    if(last){ selected=last.id; draft=structuredClone($state.snapshot(last)); if(!tabs.includes(last.id)) tabs=[...tabs,last.id]; revision++; }
    restored=true;
    return session;
  }
  $effect(()=>{
    form.tabs=[...tabs]; form.selected=selected; form.order=[...order];
    // A width drag saves once, on release.
    if(!resizing) form.listWidth=listWidth;
    if(restored&&!resizing) form.save();
  });
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
      appSettings=await loadSettings();
      const registered=await registerGlobalShortcuts(appSettings.shortcuts,{toggleWindow:toggleDesktop,newNote:()=>void run(create)});
      shortcutStatus=registered.ok||registered.cancelled?'':`全局快捷键注册失败：${registered.message}`;
      const hidden=await invoke<boolean>('startup_hidden');
      const session=restoreSession();
      // A valid remembered frame wins over the configured startup default.
      const all=await form.displays();
      if(validWindow(session.window,all)) await form.applyOuter(fitBounds(session.window,all));
      if(form.pinned) await getCurrentWindow().setAlwaysOnTop(true);
      const collapsed=form.mode; form.mode='window';
      if(!hidden){
        if(collapsed==='handle') await form.collapse(form.dock.side,undefined,form.normal);
        else if(collapsed==='bar') await form.collapseToBar();
        else await getCurrentWindow().show();
      }
      for(const note of notes.filter(n=>n.lifecycle==='active'&&n.placement==='desktop')) {
        if(!(await invoke<boolean>('startup_hidden'))) await openNoteWindow(note);
      }
      status='已就绪';
      const {perfConfig}=await import('$lib/perf');
      const perf=await perfConfig();
      if(perf.scenario) void import('$lib/perfScenario').then(m=>m.runScenario({select:id=>run(()=>select(id))}));
      if(perf.check) void import('$lib/perfScenario').then(m=>m.runWindowCheck(form));
      if(perf.tour) void import('$lib/perfScenario').then(m=>m.runTour({openSettings,closeSettings:()=>settingsOpen=false,form,select:id=>run(()=>select(id)),reminder:open=>reminderOpen=open}));
    })().catch(e=>{status=String(e); void getCurrentWindow().show();});
    const changes=listen<NoteChange>('notes-changed',async({payload})=>{
      // Apply just this note's change; no full reload and no unrelated editor flush.
      await applyNoteChange(payload); await refresh();
      if(payload.layout) void form.relayoutHandle();
      if(payload.op==='trash'||payload.op==='archive') {const h=(await loadNotes()).history?.filter(h=>h.note.id===payload.id).at(-1);if(h)undo={id:payload.id,at:h.at};}
      const n=payload.note;
      if(!draft||payload.id!==draft.id||!n||payload.op==='focus') return;
      if(payload.op==='window'){
        // Collapsing or expanding a desktop window moves the editor between it and here.
        draft={...draft,window:n.window}; if(handoff===payload.id) handoff=''; void form.syncDock(); return;
      }
      if(payload.op==='appearance'){draft={...draft,theme:n.theme,customColor:n.customColor,opacity:n.opacity,alwaysOnTop:n.alwaysOnTop};return;}
      // Delivery only marks the reminder; it keeps the revision.
      if(payload.op==='reminder') draft={...draft,reminder:n.reminder};
      // Unsaved input (even not yet serialized) is never replaced by a change from elsewhere.
      const verdict=classifyChange(payload,{label:'main',revision:draft.revision,title:draft.title,content:draft.content,lifecycle:draft.lifecycle,placement:draft.placement});
      if(verdict==='conflict'){
        // Archived, trashed or moved elsewhere: this note can no longer take the draft,
        // so the unsaved input is kept as a new note before the change is shown.
        if(n.lifecycle!==draft.lifecycle||n.placement!==draft.placement){void takeTheirs('这张便签已在别处变更').catch(e=>{conflict=true;status=`草稿另存失败：${errorText(e)}`;});return;}
        conflict=true;status='这张便签刚在别处被修改，你的草稿已保留';return;
      }
      if(verdict==='apply'){
        // Same text (an echo, or only placement/lifecycle changed) keeps the editor as is.
        const changed=draft.content!==n.content || draft.placement!==n.placement || draft.lifecycle!==n.lifecycle;
        draft=structuredClone(n); if(changed) revision++;
      }
    });
    const stopConflict=onNoteConflict(id=>{if(draft?.id===id)conflict=true;});
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
    const dockHello=listen('center-dock-hello',()=>void form.syncDock());
    const dockAction=listen<Parameters<CenterForm['dockAction']>[0]>('center-dock-action',({payload})=>{
      if(payload.action==='new') void run(async()=>{ await form.expand(); await create(); });
      else void form.dockAction(payload);
    });
    const focus=getCurrentWindow().onFocusChanged(({payload})=>{
      // Shown from the tray or a second launch while collapsed: it is already the normal window.
      if(payload) void form.adoptShown();
    });
    // The only display poller: note windows and the handle follow its broadcast.
    let displaySignature='';
    const clockTimer=setInterval(()=>clock=Date.now(),60000);
    // A button hovered when the window collapsed would stay grey when it comes back; the
    // hover shows again on the next real pointer move.
    const staleHover=()=>{ document.documentElement.dataset.staleHover=''; };
    const freshHover=()=>{ delete document.documentElement.dataset.staleHover; };
    window.addEventListener('blur',staleHover); window.addEventListener('pointermove',freshHover,{passive:true});
    const displayTimer=setInterval(()=>void form.displays().then(all=>{
      const signature=JSON.stringify(all);
      if(displaySignature&&signature!==displaySignature){ void emit('displays-changed'); void form.relayoutHandle(); }
      displaySignature=signature;
    }).catch(()=>undefined),5000);
    const moved=getCurrentWindow().onMoved(()=>form.windowChanged('moved'));
    const resized=getCurrentWindow().onResized(()=>form.windowChanged('resized'));
    const agentOpen=listen<{id:string}>('agent-open-note',e=>void run(async()=>{await persist();const n=(await loadNotes()).notes[e.payload.id];await openNoteWindow(n);if(draft?.id===n.id)await select(n.id,true);}));
    const toggle=listen('toggle-notes-visibility-requested',toggleDesktop);
    const settings=listen('open-settings-requested',()=>void openSettings());
    const settingsChanged=listen<AppSettings>('settings-changed',async({payload})=>{
      const before=JSON.stringify(appSettings.shortcuts); appSettings=payload;
      if(JSON.stringify(payload.shortcuts)===before) return;
      const registered=await registerGlobalShortcuts(payload.shortcuts,{toggleWindow:toggleDesktop,newNote:()=>void run(create)});
      shortcutStatus=registered.ok||registered.cancelled?'':`全局快捷键注册失败（可能被其他应用占用）：${registered.message}`;
    });
    // Center shadow: "standard" is the native window shadow, "light" keeps only a hairline.
    const stopAppearance=onAppearance(a=>{void getCurrentWindow().setShadow(a.centerShadow==='standard').catch(()=>undefined);});
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
    return()=>{[changes,newNote,toggle,settings,settingsChanged,close,quit,cancelled,failed,reminder,reminderError,agentOpen,release,dockHello,dockAction,focus,moved,resized].forEach(p=>p.then(f=>f()));void unregisterGlobalShortcuts();clearTimeout(handoffTimer);clearInterval(displayTimer);clearInterval(clockTimer);window.removeEventListener('blur',staleHover);window.removeEventListener('pointermove',freshHover);stopAppearance();stopConflict();};
  });
</script>

<svelte:window bind:innerWidth={width} onkeydown={e=>{if((e.metaKey||e.ctrlKey)&&e.key===','&&!e.isComposing){e.preventDefault();void openSettings();}}}/>
{#if form.snapHint}<div class="snap-hint side-{form.snapHint}" role="status"><span>松手收起到{form.snapHint==='left'?'左':'右'}侧边缘</span></div>{/if}
<main class:folded={!sidebar||narrow} class:narrow class:drawer={narrow&&sidebar} class:mac class:settings-open={settingsOpen} class:resizing style:--list-w="{shownListWidth}px">
  {#if settingsOpen}<CenterSettings onClose={()=>settingsOpen=false} {shortcutStatus} onExportCurrent={draft?()=>void exportCurrent():undefined}/>{/if}
  {#if narrow}<button class="scrim" tabindex="-1" aria-label="关闭列表" onclick={()=>sidebar=false}></button>{/if}
  <aside inert={!sidebar||settingsOpen} aria-hidden={!sidebar||settingsOpen}>
    <div class="side-inner">
      {#if mac}<div class="titlebar-space" data-tauri-drag-region></div>{/if}
      <div class="search"><Search size={15}/><input aria-label="搜索标题和正文" placeholder="搜索便签" bind:value={query}/><button aria-label="新建便签" title="新建便签" onclick={()=>run(create)}><Plus size={16}/></button></div>
      <nav><button class:active={filter==='active'} onclick={()=>filter='active'}>全部便签</button><button class:active={filter==='desktop'} onclick={()=>filter='desktop'}>桌面便签</button>{#if order.length}<button class="sort-reset" aria-label="恢复按编辑时间排序" title="恢复按编辑时间排序" onclick={()=>order=[]}><ClockArrowDown size={14}/></button>{/if}</nav>
      <div class="list" use:sortable={{axis:'y',onDrag:d=>rowDrag=d,onDrop:dropRow}}>
        {#each due as item}<div class="due"><button onclick={()=>run(()=>select(item.id))}>提醒 · {item.title}</button><button onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:Date.now()+10*60000});await refresh();})}>10 分钟后</button><button aria-label="关闭提醒" onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:null});await refresh();})}><X size={13}/></button></div>{/each}
        {#each visible as note,i(note.id)}
          {@const info=summary(note)}{@const tasks=info.tasks}
          <button animate:shift class="note-row" data-sort-id={note.id} class:chosen={selected===note.id} onclick={()=>run(async()=>{await select(note.id);if(narrow)sidebar=false;})}>
             <span class="row-heading"><i class="note-dot" style:background={noteDot(note.theme,note.customColor)}></i><b>{note.title||'未命名便签'}</b>{#if note.placement==='desktop'}<Monitor size={13}/>{/if}<time datetime={new Date(editedAt(note)).toISOString()} title="编辑于 {shortTime(editedAt(note),clock)}">{listTime(editedAt(note),clock)}</time></span><small>{info.excerpt||(note.content.trim() ? '打开查看内容' : '暂无正文')}</small>
             {#if tasks.total}<small class="list-progress">{tasks.total-tasks.done ? `${tasks.total-tasks.done} 项待办`:'待办已完成'}</small>{/if}
          </button>
        {:else}<p class="empty">{query?'没有匹配的便签':'这里还没有便签'}</p>{/each}
      </div>
      <footer><button class:active={filter==='archived'} onclick={()=>filter='archived'}><Archive size={13}/>归档</button><button class:active={filter==='trash'} onclick={()=>filter='trash'}><Trash2 size={13}/>回收站</button><button aria-label="设置" title="设置（{mac?'⌘':'Ctrl+'},）" onclick={()=>void openSettings()}><Settings size={15}/></button></footer>
    </div>
  </aside>
  {#if !narrow}<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="list-resizer" role="separator" aria-orientation="vertical" aria-label="调整列表宽度" aria-valuemin={LIST_WIDTH.min} aria-valuemax={LIST_WIDTH.max} aria-valuenow={shownListWidth} tabindex={sidebar?0:-1} title="拖动调整列表宽度 · 双击恢复默认" hidden={!sidebar||settingsOpen} onpointerdown={resizeList} onkeydown={resizeKey} ondblclick={()=>listWidth=LIST_WIDTH.default}></div>{/if}
  <section class="work" class:ink={draft?.theme==='ink'} style:--pin-bg={draft?noteBackground(draft.theme,draft.customColor):'var(--surface)'} style:--note-tint={draft?noteTint(draft.theme,draft.customColor):undefined} inert={busy||settingsOpen}>
    <header class="tabs" data-tauri-drag-region><button class="list-toggle" aria-label={sidebar?'隐藏列表':'显示列表'} title={sidebar?'隐藏列表':'显示列表'} onclick={()=>sidebar=!sidebar}><PanelLeft size={16}/></button>
      <div class="tab-strip" bind:this={tabStrip} data-tauri-drag-region use:sortable={{axis:'x',onDrop:dropTab}}>
        {#each tabs as id,i(id)}
          <div class="tab" data-sort-id={id} class:current={selected===id} animate:shift>
            <button class="tab-title" title={notes.find(n=>n.id===id)?.title||'未命名便签'} onclick={()=>run(()=>select(id))}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</button><button class="tab-close" aria-label="关闭 Tab" onclick={()=>run(()=>closeTab(id))}><X size={13}/></button>
          </div>
        {/each}
      </div>
      {#if tabsOverflow}<select aria-label="更多工作便签" value={selected} onchange={e=>run(()=>select(e.currentTarget.value))}>{#each tabs as id}<option value={id}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</option>{/each}</select>{/if}
      <div class="window-tools">
        <button class="pin" class:on={form.pinned} aria-pressed={form.pinned} aria-label={form.pinned?'取消置顶便签中心':'置顶便签中心'} title={form.pinned?'取消置顶便签中心':'置顶便签中心'} onclick={()=>form.setPinned(!form.pinned)}><Pin size={16}/></button>
        <button aria-label="收起到边缘" title="收起到边缘 · 也可以把窗口拖到屏幕左右边缘" onclick={()=>form.collapse()}>{#if form.dock.side==='left'}<ChevronsLeft size={16}/>{:else}<ChevronsRight size={16}/>{/if}</button>
        <button class="window-more" class:on={windowMenu} aria-label="窗口选项" title="窗口选项" aria-expanded={windowMenu} onclick={()=>windowMenu=!windowMenu}><ChevronDown size={16}/></button>
        {#if windowMenu}<div class="menu window-menu" use:popup={()=>windowMenu=false} transition:reveal role="menu" tabindex="-1">
          <button role="menuitem" onclick={()=>{windowMenu=false;void form.collapse('left');}}><ChevronsLeft size={15}/>收起到左侧边缘</button>
          <button role="menuitem" onclick={()=>{windowMenu=false;void form.collapse('right');}}><ChevronsRight size={15}/>收起到右侧边缘</button>
          <button role="menuitem" onclick={()=>{windowMenu=false;void form.collapseToBar();}}><Minimize2 size={15}/>收起为小条</button>
        </div>{/if}
      </div>
    </header>
    {#if draft}
      <div class="title-row">
        <input aria-label="便签标题" value={draft.title} readonly={!editable} oninput={e=>update({title:e.currentTarget.value})}/>
        {#if draft.lifecycle==='active'}<NoteColorPicker theme={draft.theme} customColor={draft.customColor} onChange={changeColor}/>{/if}
        {#if draft.reminder}<button class="time" onclick={()=>reminderOpen=true}>{shortTime(draft.reminder.at)}</button>{/if}
        {#if draft.lifecycle==='active'}
          <button class="desktop" data-drop-desktop class:drop-target={rowDrag&&rowDrag.index===null} disabled={busy} onclick={()=>run(desktop)}><Monitor size={15}/>{draft.placement==='desktop'?'定位窗口':'放到桌面'}</button>
        {/if}
        <button class="more" aria-label="更多操作" title="更多操作" aria-expanded={menu} onclick={()=>menu=!menu}><MoreHorizontal size={16}/></button>
        {#if menu}<div class="menu" use:popup={()=>menu=false} transition:reveal role="dialog" tabindex="-1">
          {#if draft.lifecycle==='active'}
            <button onclick={()=>{menu=false;reminderOpen=true;}}>设置提醒</button>
            {#if editable && progress.done}<button onclick={()=>{editor?.clearCompleted();menu=false;}}>移除已完成项（可撤销）</button>{/if}
            {#if draft.placement==='desktop'}<button onclick={()=>run(recall)}>收回中心</button>{/if}
            <button onclick={()=>run(()=>operation('archive'))}>归档</button><button onclick={()=>run(()=>operation('trash'))}>移到回收站</button>
          {:else}<button onclick={()=>run(()=>operation('restore'))}>恢复到中心</button>{#if draft.lifecycle==='trash'}<button class="danger" onclick={()=>run(()=>operation('purge'))}>永久删除</button>{/if}{/if}
          <button onclick={()=>run(async()=>{if(!draft)return;const copy=createNote({title:`${draft.title}（草稿副本）`,content:draft.content});await saveNoteNow(copy);await select(copy.id);})}>保留草稿为新便签</button>
          <button onclick={()=>run(async()=>{if(!draft)return;editor?.flush();const fresh=(await loadNotes()).notes[draft.id];if(hasLocalEdits(draft.id)&&!window.confirm('放弃本地草稿并载入已保存版本？'))return;discardPendingSave(draft.id);conflict=false;saveError='';draft=fresh;revision++;})}>重新载入已保存版本</button>
        </div>{/if}
      </div>
      {#if editable}
        <div class="editor-area">
          <DraftBanner {conflict} error={saveError} busy={busy} onKeepMine={()=>run(keepMine)} onTakeTheirs={()=>run(()=>takeTheirs())} onRetry={()=>run(retrySave)}/>
          {#key `${selected}:${revision}`}<MilkdownEditor bind:this={editor} value={draft.content} onChange={content=>update({content})} onEdit={()=>markEdited(selected)} onSettled={()=>markSettled(selected)} initialPosition={positions.get(selected)} onReminder={()=>reminderOpen=true}/>{/key}
        </div>
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
 :global(*){box-sizing:border-box}
 :global(body){margin:0;font:13px/1.55 var(--font);color:var(--text);background:var(--surface);-webkit-font-smoothing:antialiased}
 /* Layout: list | work area. The list folds with a short, continuous slide. */
 main{position:relative;--pin-text:var(--text);--pin-heading:var(--text-strong);--pin-muted:var(--muted);--pin-accent:var(--accent);--pin-accent-strong:var(--accent-strong);--pin-border:var(--border);--pin-active:var(--accent-soft);--pin-bg:var(--surface);
   display:grid;grid-template-columns:var(--list-w,230px) minmax(0,1fr);height:100vh;overflow:hidden;transition:grid-template-columns var(--motion) var(--ease-out)}
 main.folded{grid-template-columns:0px minmax(0,1fr)}
 main.resizing{transition:none;cursor:col-resize;user-select:none}
 /* The list's right edge: a wide hit area with a hairline that turns accent on hover or drag. */
 .list-resizer{position:absolute;z-index:5;top:0;bottom:0;left:calc(var(--list-w,230px) - 4px);width:8px;cursor:col-resize;touch-action:none}
 .list-resizer::after{content:'';position:absolute;top:0;bottom:0;left:3px;width:2px;background:transparent;transition:background var(--motion-fast)}
 .list-resizer:hover::after,main.resizing .list-resizer::after,.list-resizer:focus-visible::after{background:var(--accent)}
 .list-resizer:focus-visible{outline:none}
 :global([data-center-shadow="light"]) main{box-shadow:inset 0 0 0 1px var(--border)}
 aside{grid-column:1;grid-row:1;min-width:0;min-height:0;overflow:hidden;display:block;background:var(--surface-muted);border-right:1px solid var(--hairline)}
 .side-inner{width:var(--list-w,230px);height:100%;display:flex;flex-direction:column}
 .titlebar-space{height:36px;flex:0 0 auto}
 .search{display:flex;align-items:center;gap:8px;padding:14px 10px;color:var(--muted)}main.mac .search{padding-top:4px}
 .search input{min-width:0;width:100%;background:transparent;color:var(--text)}
 input{font:inherit;border:0;outline:0;color:inherit}input:focus{box-shadow:0 1px var(--accent)}
 button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:var(--radius-sm);background:transparent;color:inherit;padding:6px 8px;font:inherit;cursor:pointer;transition:background var(--motion-fast),color var(--motion-fast),transform var(--motion-fast)}
 button:hover{background:var(--hover)}button:active{transform:scale(.97)}button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}button:disabled{opacity:.5;cursor:wait}
 .active,.chosen{color:var(--accent)!important;background:var(--accent-soft)!important}
 nav{display:flex;padding:0 8px 10px;gap:5px}nav button{font-size:12px;flex:1}
 /* Shown once the list has a manual order: one click returns to newest edit first. */
 nav .sort-reset{flex:0 0 28px;padding:0;color:var(--muted)}nav .sort-reset:hover{color:var(--text);background:var(--hover-strong)}
 .list{flex:1;overflow:auto;padding:0 7px}
 .note-row{display:block;width:100%;text-align:left;padding:10px;margin:2px 0}
 .note-row span{display:flex;align-items:center;justify-content:space-between;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
 .note-row .row-heading{justify-content:flex-start}.row-heading b{flex:1;overflow:hidden;text-overflow:ellipsis;font-weight:500}
 .note-row small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--muted);margin-top:3px;font-size:12px}
 .note-row .list-progress{color:var(--accent);font-size:10px}
 .row-heading time{flex:0 0 auto;margin-left:auto;color:var(--subtle);font-size:11px;font-variant-numeric:tabular-nums}
 .note-row.chosen time{color:color-mix(in srgb,var(--accent) 70%,transparent)}
 /* Drag to reorder: the lifted item dims and an accent line marks where it will land. */
 .note-row,.tab{position:relative}
 /* The lifted copy (see sortable.ts) floats above everything and follows the pointer. */
 /* !important: the copy keeps the item's own classes, whose component rules are more specific. */
 :global(.sort-ghost){border-radius:var(--radius)!important;box-shadow:none!important;opacity:.97;transition:scale var(--motion-fast) var(--ease-out),box-shadow var(--motion-fast) var(--ease-out)!important}
 :global(.sort-ghost.lifted){scale:1.03;box-shadow:var(--menu-shadow)!important}
 :global(.sort-ghost.settling){transition:transform var(--motion) var(--ease-out),scale var(--motion) var(--ease-out),box-shadow var(--motion) var(--ease-out)!important}
 :global(:root[data-sorting]),:global(:root[data-sorting] *){cursor:grabbing!important;user-select:none!important}
 .desktop.drop-target{background:var(--accent-soft);box-shadow:inset 0 0 0 1px var(--accent)}
 .note-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;box-shadow:inset 0 0 0 .5px var(--hairline)}
 .due{display:flex;flex-wrap:wrap;font-size:11px;background:var(--accent-soft);border-radius:var(--radius-sm);margin:4px}.due button{font-size:11px}
 footer{display:flex;padding:8px;gap:5px}footer button{font-size:12px;color:var(--muted)}footer button:last-child{margin-left:auto}
 .empty,.empty-work{color:var(--muted);padding:16px}
 /* Work area: tabs, title, editor, status. */
 .work{grid-column:2;grid-row:1;display:grid;grid-template-rows:44px auto minmax(0,1fr) 30px;min-width:0;min-height:0;background:var(--pin-bg);color:var(--pin-text);transition:background var(--motion-fast),color var(--motion-fast)}
 .work.ink{--pin-text:#f5f5f5;--pin-heading:#fff;--pin-muted:#aaa;--pin-border:#ffffff20;--pin-accent:#93b4ff;--pin-accent-strong:#b6cdff;--pin-active:#343434}
 /* Dark theme: the note's own colour tints the surface; the note itself is unchanged. */
 :global([data-theme="dark"]) .work[style*="--note-tint"]{--pin-bg:color-mix(in srgb,var(--note-tint) 10%,var(--surface))!important}
 .tabs{display:flex;align-items:center;gap:6px;height:44px;padding:0 8px;min-width:0;background:var(--surface-sunken);color:var(--text);border-bottom:1px solid var(--hairline);transition:padding-left var(--motion) var(--ease-out)}
 main.mac.folded .tabs{padding-left:84px}
 /* Icon buttons share one size, shape and set of states. */
 .list-toggle,.window-tools button,.more,.search button{width:28px;height:28px;padding:0;border-radius:50%;color:var(--muted)}
 /* On the sunken tab bar the ordinary 4% hover is nearly invisible: the bar's controls use the stronger step. */
 .list-toggle:hover,.window-tools button:hover,.more:hover,.search button:hover{color:var(--text);background:var(--hover-strong)}
 /* A lit control (pinned, menu open) stays lit on hover and only deepens. */
 .window-tools button.on,.more[aria-expanded="true"]{color:var(--accent);background:var(--accent-soft)}
 .window-tools button.on:hover,.more[aria-expanded="true"]:hover{color:var(--accent);background:var(--accent-soft-strong)}
 :global(:root[data-stale-hover]) .window-tools button:not(.on):hover,:global(:root[data-stale-hover]) .list-toggle:hover{background:transparent;color:var(--muted)}
 .window-tools .pin.on :global(svg){fill:currentColor;fill-opacity:.22}
 .tab-strip{display:flex;align-items:center;min-width:0;overflow:hidden;flex:1;gap:2px}
 .tab{position:relative;display:flex;align-items:center;flex:0 1 auto;min-width:72px;max-width:200px;height:28px;padding:0 3px 0 10px;border-radius:var(--radius);color:var(--muted);transition:background var(--motion-fast),color var(--motion-fast),box-shadow var(--motion-fast)}
 .tab:hover{background:var(--hover)}
 .tab.current{background:var(--tab-current);color:var(--text);box-shadow:var(--tab-current-shadow)}
 .tab button{padding:0;background:none;border-radius:var(--radius-sm)}.tab button:hover{background:none}.tab button:active{transform:none}
 .tab .tab-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;justify-content:flex-start;height:100%;font-size:12.5px;line-height:28px}
 .tab .tab-close{flex:0 0 auto;width:18px;height:18px;margin-left:4px;color:var(--muted);opacity:0;transition:opacity var(--motion-fast),background var(--motion-fast)}
 .tab:hover .tab-close,.tab.current .tab-close,.tab-close:focus-visible{opacity:1}
 .tab .tab-close:hover{background:var(--hover-strong);color:var(--text)}
 .tabs select{max-width:110px;border:0;background:var(--hover);color:var(--text);border-radius:var(--radius-sm)}
 .window-tools{position:relative;display:flex;align-items:center;gap:2px;margin-left:auto;padding-left:6px;border-left:1px solid var(--hairline)}
 .menu{position:absolute;right:12px;top:53px;z-index:10;width:210px;padding:5px;background:var(--surface-raised);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--menu-shadow)}
 .menu button{display:block;text-align:left;width:100%;font-size:12px}
 .window-menu{top:38px;right:0;width:180px}
 /* Menu items sit inside .window-tools but must not inherit its round icon-button shape. */
 .window-menu button{display:flex;gap:8px;justify-content:flex-start;width:100%;height:auto;padding:6px 8px;border-radius:var(--radius-sm);color:var(--text)}
 .window-menu button:hover{background:var(--hover);color:var(--text)}
 .danger{color:var(--danger)}
 /* Title shares the editor's reading column so heading and body line up. */
 .title-row{position:relative;display:flex;align-items:center;gap:8px;width:100%;max-width:866px;margin:0 auto;padding:18px 30px 8px 14px}
 .title-row input{flex:1;min-width:0;font-size:17px;font-weight:600;background:transparent;color:var(--pin-heading)}
 .time{font-size:11px;color:var(--accent);background:var(--accent-soft)}
 .desktop{font-size:12px;color:var(--pin-accent)}
 .editor-area{display:flex;flex-direction:column;min-height:0;--banner-inset:max(14px,calc((100% - 852px) / 2))}
 .editor-area > :global(.banner){margin-top:2px;margin-bottom:6px}
 .editor-area > :global(.editor-layout){flex:1 1 0;min-height:0;height:auto}
 .preview{display:flex;flex-direction:column;min-height:0;overflow:auto;width:100%;padding:0 22px 22px}
 .preview :global(.editor-layout){flex:1;min-height:0}.preview :global(pre){white-space:pre-wrap;overflow-wrap:anywhere}
 .notice{display:flex;align-items:center;gap:6px;color:var(--pin-muted);font-size:12px;background:color-mix(in srgb,var(--pin-text),transparent 95%);padding:8px;border-radius:var(--radius-sm)}
 .preview .notice{max-width:820px;margin:0 auto 8px;width:100%}
 .notice button{padding:2px 6px;gap:4px;color:var(--pin-accent)}
 .empty-work{grid-row:2/4;display:flex;align-items:center;justify-content:center;flex-direction:column}.empty-work button{color:var(--accent)}
 .status{grid-row:4;padding:4px 16px;color:var(--pin-muted);font-size:11px;overflow:auto;border-top:1px solid var(--hairline)}
 .status button{font-size:11px;color:var(--accent);padding:0 8px}
 /* Edge snap hint while dragging the window to a screen edge. */
 .snap-hint{position:fixed;z-index:200;top:0;bottom:0;width:60px;pointer-events:none;display:flex;align-items:center;justify-content:center;animation:snap-in var(--motion-fast) ease-out}
 .snap-hint.side-left{left:0;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 18%,transparent),transparent)}
 .snap-hint.side-right{right:0;background:linear-gradient(270deg,color-mix(in srgb,var(--accent) 18%,transparent),transparent)}
 .snap-hint span{writing-mode:vertical-rl;font-size:12px;color:var(--accent-strong);letter-spacing:2px;background:var(--surface-raised);border-radius:var(--radius);padding:10px 4px;box-shadow:var(--menu-shadow)}
 @keyframes snap-in{from{opacity:0}}
 /* Narrow window: single column, list as a drawer. */
 .scrim{position:absolute;z-index:29;inset:0;border-radius:0;background:var(--overlay);padding:0;opacity:0;pointer-events:none;transition:opacity var(--motion)}
 .scrim:hover{background:var(--overlay)}.scrim:active{transform:none}main.drawer .scrim{opacity:1;pointer-events:auto}
 main.narrow aside{position:absolute;z-index:30;top:0;bottom:0;left:0;width:min(280px,85%);transform:translateX(-100%);transition:transform var(--motion) var(--ease-out),box-shadow var(--motion);box-shadow:none}
 main.narrow.drawer aside{transform:none;box-shadow:8px 0 28px #0000002a}
 main.narrow .side-inner{width:100%}
 main.narrow .title-row{padding:12px 14px}main.narrow .tab{min-width:84px}main.narrow .desktop{padding:6px}
 @media(max-width:700px){.title-row{padding:12px}.desktop{font-size:11px}}
 @media(prefers-reduced-motion:reduce){main,main.narrow aside,.scrim,.tabs,.tab,.tab .tab-close,button,.work,.snap-hint,.list-resizer::after{transition:none;animation:none}}
</style>
