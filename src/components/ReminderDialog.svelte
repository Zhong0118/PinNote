<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Bell, Clock3, CalendarDays, X, ArrowRight } from 'lucide-svelte';
  import { popup, reveal } from '$lib/motion';
  import { onMount } from 'svelte';
  let {onSet,onClose,currentAt}:{onSet:(at:number|null)=>Promise<void>;onClose:()=>void;currentAt?:number}=$props();
  let date=$state('');let time=$state('09:00');let error=$state('');let busy=$state(false);
  function dateValue(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  onMount(()=>{const d=new Date(currentAt??Date.now()+3600000);date=dateValue(d);time=`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;});
  async function set(at:number|null){
    if(busy)return;busy=true;error='';
    try{
      if(at!==null){
        if(!Number.isFinite(at)||at<=Date.now())throw new Error('请选择未来的时间');
        const permission=await invoke<string>('reminder_permission');
        if(permission!=='Granted')throw new Error('请在系统设置中允许 PinNote 通知');
      }
      await onSet(at);onClose();
    }catch(e){error=String(e).replace(/^Error: /,'');}finally{busy=false;}
  }
  function tomorrow(){const d=new Date();d.setDate(d.getDate()+1);d.setHours(9,0,0,0);return d.getTime();}
</script>
<div class="reminder" role="dialog" aria-label="设置提醒" tabindex="-1" use:popup={()=>{if(!busy)onClose();}} transition:reveal>
  <header><span class="bell"><Bell size={17}/></span><div><strong>{currentAt?'调整提醒':'提醒我'}</strong><small>留给稍后的自己</small></div><button class="icon" aria-label="关闭提醒设置" disabled={busy} onclick={onClose}><X size={16}/></button></header>
  <div class="presets">
    <button disabled={busy} onclick={()=>set(Date.now()+30*60000)}><Clock3 size={15}/><span>30 分钟后</span><ArrowRight size={13}/></button>
    <button disabled={busy} onclick={()=>set(Date.now()+3600000)}><Clock3 size={15}/><span>1 小时后</span><ArrowRight size={13}/></button>
    <button disabled={busy} onclick={()=>set(tomorrow())}><CalendarDays size={15}/><span>明天上午</span><small>09:00</small></button>
  </div>
  <div class="custom-time"><label><span>日期</span><input type="date" aria-label="提醒日期" min={dateValue(new Date())} bind:value={date} disabled={busy}/></label><label><span>时间</span><input type="time" aria-label="提醒时间" bind:value={time} disabled={busy}/></label></div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <footer>{#if currentAt}<button class="cancel" disabled={busy} onclick={()=>set(null)}>移除提醒</button>{:else}<span>一次性提醒</span>{/if}<button class="primary" disabled={busy||!date||!time} onclick={()=>set(new Date(`${date}T${time}`).getTime())}>{busy?'保存中…':currentAt?'保存提醒':'设置提醒'}</button></footer>
  <p class="hint">保持 PinNote 在托盘运行即可接收提醒</p>
</div>
<style>
.reminder{position:fixed;z-index:160;right:14px;top:48px;width:min(306px,calc(100vw - 28px));max-height:calc(100vh - 62px);overflow:auto;box-sizing:border-box;background: var(--surface-raised);color: var(--text);border:1px solid var(--border);border-radius:14px;box-shadow: var(--menu-shadow);font:13px/1.5 var(--font)}header{display:flex;align-items:center;gap:10px;padding:16px 16px 12px}.bell{display:grid;place-items:center;width:32px;height:32px;background: var(--accent-soft);color: var(--accent);border-radius:10px}header strong{font-size:14px;font-weight:600}header small{display:block;color: var(--muted);font-size:11px;margin-top:1px}.icon{margin-left:auto;padding:4px!important;color: var(--muted)!important}.presets{padding:0 10px 10px}.presets button{display:flex;align-items:center;gap:10px;width:100%;padding:9px 10px;text-align:left}.presets button>span{flex:1}.presets :global(svg){color: var(--muted)}.presets small{color: var(--muted);font-size:12px}button{border:0;border-radius:7px;background:transparent;font:inherit;color: var(--text);cursor:pointer;transition:background 140ms,transform 140ms}button:hover{background: var(--hover)}button:active{transform:scale(.98)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline: 2px solid var(--accent);outline-offset:2px}.custom-time{display:grid;grid-template-columns:1.4fr 1fr;gap:10px;padding:12px 16px;border-top:1px solid var(--border)}label{display:grid;gap:5px;min-width:0}label span{font-size:11px;color: var(--muted)}input{min-width:0;width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--border);border-radius:7px;background:var(--surface-muted);color: var(--text);font:inherit;font-size:12px}footer{display:flex;justify-content:space-between;align-items:center;padding:2px 16px 12px}footer>span{color: var(--muted);font-size:11px}.primary{background:var(--accent);color:var(--on-accent);padding:7px 12px;font-size:12px}.primary:hover{background:var(--accent-strong)}.cancel{color: var(--muted);font-size:12px;padding:5px 0}.hint{margin:0;padding:9px 16px;border-top:1px solid var(--border);background:var(--surface-muted);color: var(--muted);font-size:10px}.error{margin:0;padding:0 16px 10px;color: var(--danger);font-size:12px}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
