<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { popup, reveal } from '$lib/motion';
  let { onSet, onClose }: {onSet:(at:number|null)=>Promise<void>;onClose:()=>void}=$props();
  let value=$state(''); let error=$state(''); let busy=$state(false);
  async function set(at:number|null) {
    if(busy)return; busy=true;
    try { if(at!==null){if(!Number.isFinite(at)||at<=Date.now())throw new Error('请选择未来时间');const permission=await invoke<string>('reminder_permission');if(permission!=='Granted')throw new Error('请在系统设置中允许 PinNote 通知');} await onSet(at); onClose(); }
    catch(e){error=String(e);}finally{busy=false;}
  }
</script>
<div class="reminder" role="dialog" aria-label="设置提醒" tabindex="-1" use:popup={onClose} transition:reveal>
  <strong>提醒我</strong><div class="quick"><button disabled={busy} onclick={()=>set(Date.now()+30*60000)}>30 分钟后</button><button disabled={busy} onclick={()=>set(Date.now()+3600000)}>1 小时后</button><button disabled={busy} onclick={()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);void set(d.getTime());}}>明天 9 点</button></div>
  <label>自定义时间<input type="datetime-local" bind:value/></label>
  <p>应用在托盘运行时提醒。完全退出时不会通知，下次启动补发一次。</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}
  <div class="actions"><button disabled={busy} onclick={()=>set(null)}>取消提醒</button><button onclick={onClose}>关闭</button><button disabled={busy||!value} onclick={()=>set(new Date(value).getTime())}>设置</button></div>
</div>
<style>
.reminder{position:fixed;z-index:160;right:12px;top:48px;width:min(320px,calc(100vw - 24px));box-sizing:border-box;padding:16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;color:#171717;box-shadow:0 8px 28px #0002;font:13px/1.5 -apple-system,sans-serif}.quick{display:flex;gap:5px;margin:12px 0}button{border:0;border-radius:6px;padding:6px 8px;background:#f5f5f5;font:inherit;cursor:pointer;transition:transform 140ms,background 140ms}button:hover{background:#eff6ff;color:#2563eb}button:active{transform:scale(.97)}button:disabled{opacity:.5}label{display:grid;gap:5px}input{font:inherit;padding:7px;border:1px solid #ddd;border-radius:6px}p{font-size:11px;color:#737373}.error{color:#dc2626}.actions{display:flex;justify-content:flex-end;gap:6px}.actions button:last-child{color:#2563eb;background:#eff6ff}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
