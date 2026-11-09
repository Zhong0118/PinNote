<script lang="ts">
 import { onMount } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { flushNoteSave, loadNotes, noteOperation, type NotesFile, type PinNote } from '$lib/notesStore';
 import { findNoteWindow } from '$lib/noteWindows';
 import { requestWindowVisibility } from '$lib/windowVisibility';
 type Entry = NonNullable<NotesFile['history']>[number];
 let settings=$state({enabled:false,write:false,scope:'active',connectionFile:'',lastConnectedAt:null as number|null,listening:false});
 let history=$state<Entry[]>([]);let notes=$state<Record<string,PinNote>>({});let status=$state('');let busy=$state(false);
 const opLabel:Record<string,string>={create:'新建',save:'修改',archive:'归档',trash:'移到回收站',restore:'恢复',undo:'恢复前的版本',reminder:'提醒',appearance:'外观'};
 async function refresh(){
   try{
     settings=await invoke('integration_status');
     const file=await loadNotes(); notes=file.notes;
     // Agent changes, plus the version saved right before each restore so that one is visible too.
     history=(file.history??[]).filter(h=>h.source==='agent'||h.op==='undo').reverse();
   }catch(e){status=String(e);}
 }
 // Polls only while this view is shown and the window is visible.
 onMount(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},5000);return()=>clearInterval(timer);});
 async function save(){try{await invoke('integration_configure',{enabled:settings.enabled,write:settings.write,scope:settings.scope});status='设置已保存';await refresh();}catch(e){status=`未保存：${e}`;}}
 /** The newest change to a note that nothing has changed since can simply be undone. */
 function isLatest(item:Entry){
   const current=notes[item.note.id];
   const newest=history.find(h=>h.note.id===item.note.id);
   return item.source==='agent'&&newest===item&&current?.revision===(item.note.revision??0)+1;
 }
 async function restore(item:Entry){
   const id=item.note.id; const current=notes[id];
   if(!isLatest(item)){
     const later=current?Math.max(0,current.revision-(item.note.revision??0)-1):0;
     const message=`恢复「${item.note.title||'未命名便签'}」到 ${new Date(item.at).toLocaleString()} 之前的版本？\n\n`+
       `· 当前内容会被替换${later?`，此后的 ${later} 次修改也会被覆盖`:''}。\n· 替换前的当前版本会先保存为一条“恢复前的版本”记录，可以再恢复回来。\n`+
       (current?.placement==='desktop'?'· 桌面便签会收回中心。':'');
     if(!window.confirm(message))return;
   }
   busy=true;
   try{
     // Save every open draft of this note first; a failed save stops the restore.
     await flushNoteSave(id);
     const win=await findNoteWindow(id); if(win)await requestWindowVisibility(win.label,false);
     const fresh=(await loadNotes()).notes[id]; if(!fresh)throw new Error('便签已不存在');
     await noteOperation(fresh,'undo',{historyId:item.at});
     if(win)await win.destroy().catch(()=>{});
     status=isLatest(item)?'已撤销这次修改，便签位于中心':'已恢复到所选版本；替换前的版本保留在下方列表';
     await refresh();
   }catch(e){status=`未恢复：${e}`;}
   finally{busy=false;}
 }
</script>
<section>
 <label class="row"><span>启用本地 MCP</span><input type="checkbox" role="switch" bind:checked={settings.enabled} onchange={save}/></label>
 <label class="row"><span>允许 agent 修改便签</span><input type="checkbox" role="switch" bind:checked={settings.write} onchange={save}/></label>
 <label class="row"><span>读写范围</span><select bind:value={settings.scope} onchange={save}><option value="active">普通便签</option><option value="all">全部（含归档与回收站）</option></select></label>
 <p class="state" class:on={settings.enabled&&settings.listening}><i></i>{settings.enabled&&settings.listening?'本机连接已就绪':'集成已关闭'}{settings.lastConnectedAt?` · 最近连接 ${new Date(settings.lastConnectedAt).toLocaleString()}`:''}</p>
 <p>应用必须保持运行（可在托盘）。客户端使用 Node.js 启动 scripts/pinnote-mcp.mjs，连接文件：</p><code>{settings.connectionFile}</code>
 <p>新建内容默认留在中心；修改需要当前版本，未保存草稿会阻止 agent 写入。最多保留最近 100 次可恢复操作。</p>
 <h3>agent 修改记录</h3>
 {#each history as item(item.at)}
   {@const latest=isLatest(item)}
   <div class="change"><span>{item.note.title||'未命名便签'}<small>{new Date(item.at).toLocaleString()} · {item.source==='agent'?'agent ':''}{opLabel[item.op]??item.op}</small></span>
     <button disabled={busy} title={latest?'撤销 agent 的这次修改':'用这次修改之前的版本替换当前内容'} onclick={()=>restore(item)}>{latest?'撤销这次修改':'恢复到此前版本'}</button></div>
 {:else}<p>暂无修改</p>{/each}
 <p role="status">{status}</p>
</section>
<style>
 h3{font-size:13px;font-weight:600;margin:24px 0 6px;color:var(--text-strong)}
 .row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--hairline);font-size:13px}
 p,small{font-size:12px;color:var(--muted)}code{font-size:11px;overflow-wrap:anywhere;color:var(--text)}
 .state{display:flex;align-items:center;gap:6px}.state i{width:7px;height:7px;border-radius:50%;background:var(--subtle)}.state.on i{background:#22c55e}
 select{font:inherit;font-size:12px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:4px 6px;background:var(--surface-raised);color:var(--text)}
 button{font:inherit;font-size:12px;border:0;border-radius:var(--radius-sm);padding:5px 9px;background:transparent;color:var(--accent);cursor:pointer;transition:background var(--motion-fast),transform var(--motion-fast);flex:0 0 auto}
 button:hover{background:var(--accent-soft)}button:active{transform:scale(.97)}button:disabled{opacity:.5;cursor:wait}
 .change{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid var(--hairline);font-size:13px}small{display:block}
 input[type="checkbox"][role="switch"]{appearance:none;flex:0 0 auto;width:32px;height:19px;border-radius:999px;background:var(--hover-strong);position:relative;cursor:pointer;transition:background var(--motion-fast);margin:0}
 input[type="checkbox"][role="switch"]::after{content:'';position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px #0000003d;transition:transform var(--motion-fast)}
 input[type="checkbox"][role="switch"]:checked{background:var(--accent)}input[type="checkbox"][role="switch"]:checked::after{transform:translateX(13px)}
</style>
