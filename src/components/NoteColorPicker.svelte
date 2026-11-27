<script lang="ts">
  import { Palette } from 'lucide-svelte';
  import { noteColors } from '$lib/noteAppearance';
  import type { NoteTheme } from '$lib/settings';
  import { popup, reveal } from '$lib/motion';

  let { theme, customColor, onChange, disabled = false }:
    { theme: NoteTheme; customColor: string; onChange: (theme: NoteTheme, color?: string) => Promise<void>; disabled?: boolean } = $props();
  let open = $state(false);
  let saving = $state(false);
  let error = $state('');
  let trigger = $state<HTMLButtonElement>();

  async function select(next: NoteTheme, color?: string) {
    saving = true;
    error = '';
    try {
      await onChange(next, color);
      open = false;
    } catch (e) {
      error = String(e);
    } finally {
      saving = false;
    }
  }
</script>

<div class="color-control">
  <button bind:this={trigger} class="trigger" aria-label="便签背景颜色" title="便签背景颜色" aria-expanded={open} {disabled} onclick={() => (open = !open)}>
    <Palette size={16} />
  </button>
  {#if open}
    <div class="palette" role="dialog" aria-label="选择便签颜色" tabindex="-1" use:popup={{ close: () => (open = false), trigger }} transition:reveal>
      <span class="label">便签颜色</span>
      <div class="swatches">
        {#each noteColors as color}
          <button title={color.label} aria-label={color.label} aria-pressed={theme === color.theme} disabled={saving}
            style:background={color.swatch} class:dark={color.theme === 'ink'} onclick={() => select(color.theme)}></button>
        {/each}
      </div>
      <label class="custom" class:active={theme === 'custom'}>
        <span>自定义颜色</span>
        <span class="custom-chip" style:background={customColor}>
          <input aria-label="自定义便签颜色" type="color" value={customColor} disabled={saving} onchange={e => select('custom', e.currentTarget.value)} />
        </span>
      </label>
      {#if error}<small role="alert">{error}</small>{/if}
    </div>
  {/if}
</div>

<style>
  .color-control { position: relative; }
  .trigger {
    display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: var(--px-radius);
    background: transparent; color: var(--pin-muted, #737373); cursor: pointer;
    transition: background var(--motion-fast), color var(--motion-fast), transform 260ms var(--ease-spring);
  }
  .trigger:hover, .trigger[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent); }
  .palette {
    position: absolute; right: 0; top: 36px; z-index: 130; width: 244px; padding: 14px;
    background: var(--material); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur);
    color: var(--text); border: 0; border-radius: var(--radius-sm); box-shadow: var(--material-shadow);
    transform-origin: top right;
  }
  .label { font-size: 12px; color: var(--muted); }
  .swatches { display: flex; flex-wrap: wrap; gap: 7px; margin: 11px 0 12px; }
  .swatches button {
    display: grid; place-items: center; width: 25px; height: 25px; padding: 0;
    border: 1px solid var(--border); border-radius: var(--px-radius); cursor: pointer; color: #171717;
    transition: transform var(--motion-fast), box-shadow var(--motion-fast);
  }
  .swatches button:hover { transform: scale(1.1); }
  .swatches button[aria-pressed="true"], .custom.active .custom-chip {
    box-shadow: var(--px-swatch-edge);
  }
  .swatches button[aria-pressed="true"]::before {
    content: ''; width: 14px; height: 14px; background: currentColor;
    -webkit-mask: var(--px-check-mask) center / contain no-repeat;
    mask: var(--px-check-mask) center / contain no-repeat;
  }
  .swatches .dark { color: #ffffff; }
  .custom {
    display: flex; align-items: center; justify-content: space-between; font-size: 12px;
    padding-top: 10px; border-top: 1px solid var(--hairline); cursor: pointer;
  }
  .custom-chip {
    position: relative; display: grid; place-items: center; width: 24px; height: 24px;
    border-radius: var(--px-radius); border: 1px solid var(--border); overflow: hidden; transition: box-shadow var(--motion-fast);
  }
  .custom-chip:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
  .custom input { position: absolute; inset: -4px; width: 32px; height: 32px; opacity: 0; cursor: pointer; border: 0; padding: 0; }
  small { display: block; color: var(--danger); margin-top: 8px; }
  button:active { transform: scale(.92); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { button, .trigger, .swatches button { transition: none; } }
</style>
