<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PanelLeft, Plus, X, MoreHorizontal, Monitor, Archive, Trash2, Settings, Search } from 'lucide-svelte';
  import MilkdownEditor from '../../components/MilkdownEditor.svelte';
  import { createNote, loadNotes, saveNoteNow, scheduleNoteSave, flushNoteSave, noteOperation, hasPendingSave, type PinNote } from '$lib/notesStore';
  import { openNoteWindow, findNoteWindow } from '$lib/noteWindows';
  import { requestWindowVisibility } from '$lib/windowVisibility';
  import { loadSettings } from '$lib/settings';
  import { registerGlobalShortcuts, unregisterGlobalShortcuts } from '$lib/shortcuts';
  import { openSettingsWindow } from '$lib/settingsWindow';
  import { reveal, popup } from '$lib/motion';
  import { createQuitGuard } from '$lib/quitGuard';
  import ReminderDialog from '../../components/ReminderDialog.svelte';
  import { checklistProgress } from '$lib/checklist';
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
  const editable = $derived(draft?.lifecycle === 'active' && draft.placement === 'center');

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
    draft={...draft,...patch}; status='正在保存…';
    scheduleNoteSave(draft,e=>{status=e?String(e):'已保存'; if(!e) void refresh();});
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
    await openNoteWindow(note); await select(note.id);
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
  onMount(()=>{
    const setup=(async()=>{
      await refresh();
      const settings=await loadSettings();
      await registerGlobalShortcuts(settings.shortcuts,{toggleWindow:toggleDesktop,newNote:()=>void run(create)});
      if(!(await invoke<boolean>('startup_hidden'))) await getCurrentWindow().show();
      for(const note of notes.filter(n=>n.lifecycle==='active'&&n.placement==='desktop')) {
        if(!(await invoke<boolean>('startup_hidden'))) await openNoteWindow(note);
      }
      status='已就绪';
    })().catch(e=>{status=String(e); void getCurrentWindow().show();});
    const changes=listen<{id:string;op:string;note:PinNote|null}>('notes-changed',async({payload})=>{
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
    return()=>{[changes,newNote,toggle,settings,settingsChanged,close,quit,cancelled,failed,reminder,reminderError,agentOpen].forEach(p=>p.then(f=>f()));void unregisterGlobalShortcuts();};
  });
</script>

<main class:folded={!sidebar}>
  {#if sidebar}
    <aside transition:reveal>
      <div class="search"><Search size={15}/><input aria-label="搜索标题和正文" placeholder="搜索便签" bind:value={query}/><button aria-label="新建便签" title="新建便签" onclick={()=>run(create)}><Plus size={17}/></button></div>
      <nav><button class:active={filter==='active'} onclick={()=>filter='active'}>全部便签</button><button class:active={filter==='desktop'} onclick={()=>filter='desktop'}>桌面便签</button></nav>
      <div class="list">
        {#each due as item}<div class="due"><button onclick={()=>run(()=>select(item.id))}>提醒 · {item.title}</button><button onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:Date.now()+10*60000});await refresh();})}>10 分钟后</button><button aria-label="关闭提醒" onclick={()=>run(async()=>{const n=(await loadNotes()).notes[item.id];await noteOperation(n,'reminder',{at:null});await refresh();})}><X size={12}/></button></div>{/each}
        {#each visible as note(note.id)}
          <button class="note-row" class:chosen={selected===note.id} onclick={()=>run(()=>select(note.id))} draggable="true" ondragstart={e=>e.dataTransfer?.setData('text/pinnote',note.id)}>
            <span>{note.title||'未命名便签'}{#if note.placement==='desktop'}<Monitor size={12}/>{/if}</span><small>{note.content.replace(/[#*`\[\]]/g,'').slice(0,100)||'空白便签'}</small>
          </button>
        {:else}<p class="empty">{query?'没有匹配的便签':'这里还没有便签'}</p>{/each}
      </div>
      <footer><button class:active={filter==='archived'} onclick={()=>filter='archived'}><Archive size={14}/>归档</button><button class:active={filter==='trash'} onclick={()=>filter='trash'}><Trash2 size={14}/>回收站</button><button aria-label="设置" onclick={()=>openSettingsWindow()}><Settings size={15}/></button></footer>
    </aside>
  {/if}
  <section class="work" inert={busy}>
    <header class="tabs"><button aria-label="折叠列表" title="折叠列表" onclick={()=>sidebar=!sidebar}><PanelLeft size={17}/></button>
      <div class="tab-strip">
        {#each tabs as id(id)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="tab" class:active={selected===id} draggable="true" ondragstart={()=>dragTab=id} ondragover={e=>e.preventDefault()} ondrop={()=>reorder(id)}>
            <button onclick={()=>run(()=>select(id))}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</button><button aria-label="关闭 Tab" onclick={()=>run(()=>closeTab(id))}><X size={13}/></button>
          </div>
        {/each}
      </div>
      {#if tabs.length>4}<select aria-label="更多工作便签" value={selected} onchange={e=>run(()=>select(e.currentTarget.value))}>{#each tabs as id}<option value={id}>{notes.find(n=>n.id===id)?.title||'未命名便签'}</option>{/each}</select>{/if}
    </header>
    {#if draft}
      <div class="title-row">
        <input aria-label="便签标题" value={draft.title} readonly={!editable} oninput={e=>update({title:e.currentTarget.value})}/>
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
        {#key `${selected}:${revision}`}<MilkdownEditor bind:this={editor} value={draft.content} onChange={content=>update({content})} initialPosition={positions.get(selected)}/>{/key}
      {:else}
        <div class="preview" transition:reveal>
          {#if draft.placement==='desktop'&&draft.lifecycle==='active'}<div class="notice">正在独立窗口编辑 <button onclick={()=>run(recall)}>收回中心</button></div>{/if}
          {#if draft.lifecycle!=='active'}<div class="notice">{draft.lifecycle==='trash'?'已在回收站':'已归档'} <button onclick={()=>run(()=>operation('restore'))}>恢复</button></div>{/if}
          {#if progress.total}<small>清单 {progress.done}/{progress.total}</small>{/if}<pre>{draft.content||'空白便签'}</pre>
        </div>
      {/if}
    {:else}<div class="empty-work"><p>选择一张便签，开始书写</p><button onclick={()=>run(create)}><Plus size={15}/>新建便签</button></div>{/if}
    <div class="status" role="status">{status}{#if undo}<button onclick={()=>run(undoLast)}>撤销移除</button>{/if}</div>
  </section>
</main>
{#if reminderOpen&&draft}<ReminderDialog onClose={()=>reminderOpen=false} onSet={async at=>{await persist();const note=(await loadNotes()).notes[draft!.id];await noteOperation(note,'reminder',{at});draft=note;await refresh();}}/>{/if}

<style>
 :global(*){box-sizing:border-box}:global(body){margin:0;font:13px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;color:#171717;background:#fff}
 .time{font-size:11px;color:#2563eb;background:#eff6ff}.due{display:flex;flex-wrap:wrap;font-size:11px;background:#eff6ff;border-radius:6px;margin:4px}.due button{font-size:11px}
 main{--pin-text:#171717;--pin-heading:#111;--pin-muted:#737373;--pin-accent:#2563eb;--pin-accent-strong:#1d4ed8;--pin-border:#e5e7eb;--pin-bg:#fff;display:grid;grid-template-columns:230px minmax(0,1fr);height:100vh;overflow:hidden}main.folded{grid-template-columns:minmax(0,1fr)}
 aside{background:#fafafa;border-right:1px solid #ededee;display:flex;flex-direction:column;min-height:0}.search{display:flex;align-items:center;gap:8px;padding:14px 10px}.search input{min-width:0;width:100%;background:transparent}input{font:inherit;border:0;outline:0;color:inherit}input:focus{box-shadow:0 1px #2563eb}
 button{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:0;border-radius:6px;background:transparent;color:inherit;padding:6px 8px;font:inherit;cursor:pointer;transition:background 140ms,transform 140ms}button:hover{background:#eee}button:active{transform:scale(.97)}button:focus-visible{outline:2px solid #2563eb;outline-offset:-2px}button:disabled{opacity:.5;cursor:wait}.active,.chosen{color:#2563eb!important;background:#eff6ff!important}nav{display:flex;padding:0 8px 10px;gap:5px}nav button{font-size:12px;flex:1}.list{flex:1;overflow:auto;padding:0 7px}.note-row{display:block;width:100%;text-align:left;padding:10px;margin:2px 0}.note-row span{display:flex;align-items:center;justify-content:space-between;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.note-row small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#888;margin-top:3px;font-size:12px}footer{display:flex;padding:8px;gap:5px}footer button{font-size:12px;color:#737373}footer button:last-child{margin-left:auto}.work{display:grid;grid-template-rows:42px auto minmax(0,1fr) 30px;min-width:0;min-height:0}.tabs{display:flex;gap:5px;align-items:center;padding:5px 8px;border-bottom:1px solid #eee;min-width:0}.tab-strip{display:flex;min-width:0;overflow:hidden;flex:1;gap:4px}.tab{display:flex;min-width:110px;max-width:180px;border-radius:6px}.tab button:first-child{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.tab button:last-child{padding:5px}.tabs select{max-width:110px;border:0;background:#f5f5f5;border-radius:5px}.title-row{display:flex;align-items:center;gap:8px;padding:16px 20px;position:relative}.title-row input{flex:1;min-width:0;font-size:17px;font-weight:600}.desktop{font-size:12px;color:#2563eb}.more{border-radius:50%;background:#f5f5f5}.menu{position:absolute;right:12px;top:53px;z-index:10;width:210px;padding:5px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px #0001}.menu button{display:block;text-align:left;width:100%;font-size:12px}.danger{color:#dc2626}.preview{overflow:auto;padding:0 22px 22px}.preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.notice{color:#737373;font-size:12px;background:#fafafa;padding:8px;border-radius:6px}.notice button{color:#2563eb}.empty,.empty-work{color:#888;padding:16px}.empty-work{grid-row:2/4;display:flex;align-items:center;justify-content:center;flex-direction:column}.empty-work button{color:#2563eb}.status{grid-row:4;padding:4px 16px;color:#737373;font-size:11px;overflow:auto;border-top:1px solid #f5f5f5}.status button{font-size:11px;color:#2563eb;padding:0 8px}@media(max-width:700px){main{grid-template-columns:190px minmax(0,1fr)}.title-row{padding:12px}.desktop{font-size:11px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
