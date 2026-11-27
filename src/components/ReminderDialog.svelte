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
  function laterToday(){
    const now=Date.now();
    const evening=new Date();evening.setHours(18,0,0,0);
    if(evening.getTime()-now>15*60000)return{label:'今天傍晚',hint:'18:00',at:evening.getTime()};
    const night=new Date();night.setHours(21,0,0,0);
    if(night.getTime()-now>15*60000)return{label:'今晚',hint:'21:00',at:night.getTime()};
    return null;
  }
  const todaySlot=laterToday();
</script>
<div class="reminder" role="dialog" aria-label="设置提醒" tabindex="-1" use:popup={()=>{if(!busy)onClose();}} transition:reveal>
  <header><span class="bell"><Bell size={16}/></span><div><strong>{currentAt?'调整提醒':'提醒我'}</strong><small>留给稍后的自己</small></div><button class="icon" aria-label="关闭提醒设置" disabled={busy} onclick={onClose}><X size={15}/></button></header>
  <div class="presets">
    <button disabled={busy} onclick={()=>set(Date.now()+30*60000)}><Clock3 size={15}/><span>30 分钟后</span><ArrowRight size={13}/></button>
    <button disabled={busy} onclick={()=>set(Date.now()+3600000)}><Clock3 size={15}/><span>1 小时后</span><ArrowRight size={13}/></button>
    {#if todaySlot}<button disabled={busy} onclick={()=>set(todaySlot.at)}><Clock3 size={15}/><span>{todaySlot.label}</span><small>{todaySlot.hint}</small></button>{/if}
    <button disabled={busy} onclick={()=>set(tomorrow())}><CalendarDays size={15}/><span>明天上午</span><small>09:00</small></button>
  </div>
  <div class="custom-time"><label><span>日期</span><input type="date" aria-label="提醒日期" min={dateValue(new Date())} bind:value={date} disabled={busy}/></label><label><span>时间</span><input type="time" aria-label="提醒时间" bind:value={time} disabled={busy}/></label></div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <footer>{#if currentAt}<button class="cancel" disabled={busy} onclick={()=>set(null)}>移除提醒</button>{:else}<span>一次性提醒</span>{/if}<button class="primary" disabled={busy||!date||!time} onclick={()=>set(new Date(`${date}T${time}`).getTime())}>{busy?'保存中…':currentAt?'保存提醒':'设置提醒'}</button></footer>
  <p class="hint">保持 PinNote 在托盘运行即可接收提醒</p>
</div>
<style>
.reminder{position:fixed;z-index:160;right:14px;top:48px;width:min(306px,calc(100vw - 28px));max-height:calc(100vh - 58px);overflow:auto;box-sizing:border-box;background:var(--material);-webkit-backdrop-filter:var(--material-blur);backdrop-filter:var(--material-blur);color: var(--text);border:0;border-radius:var(--radius-lg);box-shadow: var(--material-shadow);font:13px/1.5 var(--font);transform-origin:top right}header{display:flex;align-items:center;gap:10px;padding:14px 14px 10px}.bell{display:grid;place-items:center;width:32px;height:32px;background: var(--accent-soft);color: var(--accent);border-radius:var(--radius)}.bell :global(svg){transform-origin:50% 3px;animation:bell 900ms var(--ease-out)}@keyframes bell{15%{transform:rotate(16deg)}30%{transform:rotate(-14deg)}45%{transform:rotate(9deg)}60%{transform:rotate(-6deg)}75%{transform:rotate(2deg)}}header strong{font-size:14px;font-weight:600}header small{display:block;color: var(--muted);font-size:11px;margin-top:1px}.icon{margin-left:auto;width:28px;height:28px;display:grid;place-items:center;padding:0!important;border-radius:50%!important;color: var(--muted)!important}.icon:hover{background:var(--hover-strong)!important;color:var(--text)!important}.presets{padding:0 10px 8px}.presets button{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;text-align:left}.presets button>span{flex:1}.presets :global(svg){color: var(--muted)}.presets small{color: var(--muted);font-size:12px}button{border:0;border-radius:var(--radius-sm);background:transparent;font:inherit;color: var(--text);cursor:pointer;transition:background var(--motion-fast),transform var(--motion-fast)}button:hover{background: var(--hover)}button:active{transform:scale(.97)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible{outline: 2px solid var(--accent);outline-offset:2px}.custom-time{display:grid;grid-template-columns:1.4fr 1fr;gap:10px;padding:10px 14px;border-top:1px solid var(--hairline)}label{display:grid;gap:5px;min-width:0}label span{font-size:11px;color: var(--muted)}input{min-width:0;width:100%;box-sizing:border-box;padding:6px 7px;border:1px solid var(--border);border-radius:var(--radius-sm);background:color-mix(in srgb,var(--surface-muted) 80%,transparent);color: var(--text);font:inherit;font-size:12px}footer{display:flex;justify-content:space-between;align-items:center;padding:2px 14px 12px}footer>span{color: var(--muted);font-size:11px}.primary{background:var(--accent);color:var(--on-accent);padding:6px 12px;font-size:12px}.primary:hover{background:var(--accent-strong)}.cancel{color: var(--muted);font-size:12px;padding:5px 0}.hint{margin:0;padding:8px 14px;border-top:1px solid var(--hairline);background:var(--fill);color: var(--muted);font-size:10px}.error{margin:0;padding:0 14px 10px;color: var(--danger);font-size:12px}@media(max-height:280px){.reminder{top:42px;right:8px;width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 48px)}header{padding:8px 12px 6px}.bell{width:26px;height:26px}.presets{padding:0 8px 4px}.presets button{padding:5px 8px;font-size:12px}.custom-time{padding:8px 12px}.hint{display:none}}@media(prefers-reduced-motion:reduce){button{transition:none}.bell :global(svg){animation:none}}
</style>
