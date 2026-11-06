<script lang="ts">
 import { onMount } from 'svelte';
 import { invoke } from '@tauri-apps/api/core';
 import { loadNotes, noteOperation, type NotesFile } from '$lib/notesStore';
 import { findNoteWindow } from '$lib/noteWindows';
 import { requestWindowVisibility } from '$lib/windowVisibility';
 let settings=$state({enabled:false,write:false,scope:'active',connectionFile:'',lastConnectedAt:null as number|null,listening:false});
 let history=$state<NonNullable<NotesFile['history']>>([]);let status=$state('');
 async function refresh(){try{settings=await invoke('integration_status');history=((await loadNotes()).history??[]).filter(h=>h.source==='agent').reverse();}catch(e){status=String(e);}}
 onMount(()=>{void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);});
 async function save(){try{await invoke('integration_configure',{enabled:settings.enabled,write:settings.write,scope:settings.scope});status='设置已保存';await refresh();}catch(e){status=String(e);}}
 async function undo(id:string,at:number){try{const win=await findNoteWindow(id);if(win)await requestWindowVisibility(win.label,false);const current=(await loadNotes()).notes[id];await noteOperation(current,'undo',{historyId:at});if(win)await win.destroy().catch(()=>{});status='已恢复修改前版本，便签位于中心';await refresh();}catch(e){status=String(e);}}
</script>
<section>
 <h3>集成与自动化</h3>
 <label><span>启用本地 MCP</span><input type="checkbox" bind:checked={settings.enabled} onchange={save}/></label>
 <label><span>允许 agent 修改便签</span><input type="checkbox" bind:checked={settings.write} onchange={save}/></label>
 <label><span>读写范围</span><select bind:value={settings.scope} onchange={save}><option value="active">普通便签</option><option value="all">全部（含归档与回收站）</option></select></label>
 <p>{settings.enabled&&settings.listening?'本机连接已就绪':'集成已关闭'}{settings.lastConnectedAt?` · 最近连接 ${new Date(settings.lastConnectedAt).toLocaleString()}`:''}</p>
 <p>应用必须保持运行（可在托盘）。客户端使用 Node.js 启动 scripts/pinnote-mcp.mjs，连接文件路径：</p><code>{settings.connectionFile}</code>
 <p>新建内容默认留在中心；修改需要当前版本，未保存草稿会阻止 agent 写入。最近保留最多 100 次可恢复操作。</p>
 <h3>最近 agent 修改</h3>
 {#each history as item(item.at)}<div class="change"><span>{item.note.title||'未命名便签'}<small>{new Date(item.at).toLocaleString()} · {item.op}</small></span><button onclick={()=>undo(item.note.id,item.at)}>撤销</button></div>{:else}<p>暂无修改</p>{/each}
 <p role="status">{status}</p>
</section>
<style>h3{font-size:14px;font-weight:600;margin:0 0 14px}h3:not(:first-child){margin-top:24px}label{display:flex;align-items:center;justify-content:space-between;margin:14px 0;font-size:13px}p,small{font-size:12px;color:#737373}code{font-size:11px;overflow-wrap:anywhere}select,button{font:inherit;border:1px solid #e5e7eb;border-radius:6px;padding:5px;background:#fff}button{cursor:pointer;transition:background 140ms,transform 140ms}button:hover{background:#eff6ff;color:#2563eb}button:active{transform:scale(.97)}.change{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f3f3f3}small{display:block}@media(prefers-reduced-motion:reduce){button{transition:none}}</style>
