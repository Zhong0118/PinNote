<script lang="ts">
  import { Check, Palette } from 'lucide-svelte';
  import { noteColors } from '$lib/noteAppearance';
  import type { NoteTheme } from '$lib/settings';
  import { popup, reveal } from '$lib/motion';
  let {theme,customColor,onChange,disabled=false}:{theme:NoteTheme;customColor:string;onChange:(theme:NoteTheme,color?:string)=>Promise<void>;disabled?:boolean}=$props();
  let open=$state(false);let saving=$state(false);let error=$state('');
  async function select(next:NoteTheme,color?:string){saving=true;error='';try{await onChange(next,color);open=false;}catch(e){error=String(e);}finally{saving=false;}}
</script>
<div class="color-control">
  <button class="trigger" aria-label="便签背景颜色" title="便签背景颜色" aria-expanded={open} {disabled} onclick={()=>open=!open}><Palette size={16}/></button>
  {#if open}<div class="palette" role="dialog" aria-label="选择便签颜色" tabindex="-1" use:popup={()=>open=false} transition:reveal>
    <span class="label">便签颜色</span>
    <div class="swatches">{#each noteColors as color}<button title={color.label} aria-label={color.label} aria-pressed={theme===color.theme} disabled={saving} style:background={color.swatch} class:dark={color.theme==='ink'} onclick={()=>select(color.theme)}>{#if theme===color.theme}<Check size={13}/>{/if}</button>{/each}</div>
    <label class="custom"><span>自定义颜色</span><input aria-label="自定义便签颜色" type="color" value={customColor} disabled={saving} onchange={e=>select('custom',e.currentTarget.value)}/></label>
    {#if error}<small role="alert">{error}</small>{/if}
  </div>{/if}
</div>
<style>
.color-control{position:relative}.trigger{display:grid;place-items:center;width:29px;height:29px;border:0;border-radius:50%;background:transparent;color:var(--pin-muted,#737373);cursor:pointer}.trigger:hover,.trigger[aria-expanded=true]{background: var(--accent-soft);color: var(--accent)}.palette{position:absolute;right:0;top:36px;z-index:130;width:224px;padding:14px;background: var(--surface-raised);color: var(--text);border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow: var(--menu-shadow)}.label{font-size:12px;color: var(--muted)}.swatches{display:flex;gap:7px;margin:12px 0}.swatches button{display:grid;place-items:center;width:26px;height:26px;padding:0;border:1px solid #0002;border-radius:50%;cursor:pointer;color: var(--text)}.swatches button[aria-pressed=true]{outline: 2px solid var(--accent);outline-offset:2px}.swatches .dark{color:white}.custom{display:flex;align-items:center;justify-content:space-between;font-size:12px}.custom input{width:28px;height:24px;padding:0;border:0;background:none}small{display:block;color: var(--danger);margin-top:8px}button{transition:background var(--motion-fast),transform var(--motion-fast)}button:active{transform:scale(.94)}button:focus-visible{outline: 2px solid var(--accent);outline-offset:2px}@media(prefers-reduced-motion:reduce){button{transition:none}}
</style>
