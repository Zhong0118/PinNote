<script lang="ts">
  // Shown above an editor whose unsaved input is at risk: a version conflict with a
  // change made elsewhere, or a save that failed. The draft itself stays in the editor.
  import { TriangleAlert, RefreshCw } from 'lucide-svelte';
  import { reveal } from '$lib/motion';
  type Props = {
    conflict: boolean;
    error: string;
    busy?: boolean;
    compact?: boolean;
    onKeepMine: () => void;
    onTakeTheirs: () => void;
    onRetry: () => void;
  };
  let { conflict, error, busy = false, compact = false, onKeepMine, onTakeTheirs, onRetry }: Props = $props();
</script>

{#if conflict || error}
  <div class="banner" class:compact role="alert" transition:reveal>
    <TriangleAlert size={13} />
    {#if conflict}
      <p><b>这张便签刚在别处被修改。</b>你的输入仍在这里，没有被覆盖。</p>
      <span class="actions">
        <button class="primary" disabled={busy} title="用你的版本覆盖别处的修改" onclick={onKeepMine}>保留我的修改</button>
        <button disabled={busy} title="载入别处的版本；你的草稿会另存为一张新便签" onclick={onTakeTheirs}>使用新版本</button>
      </span>
    {:else}
      <p><b>未保存。</b>{error}</p>
      <span class="actions"><button class="primary" disabled={busy} onclick={onRetry}><RefreshCw size={13} />重试</button></span>
    {/if}
  </div>
{/if}

<style>
  .banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 var(--banner-inset, 0) 10px; padding: 8px 10px; border-radius: var(--radius); font-size: 12px; line-height: 1.45; color: var(--warning-text); background: var(--warning-soft); }
  .banner :global(svg) { flex: 0 0 auto; }
  p { flex: 1 1 220px; margin: 0; min-width: 0; }
  b { font-weight: 600; }
  .actions { display: inline-flex; gap: 4px; margin-left: auto; }
  button { display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: var(--radius-sm); padding: 4px 9px; font: inherit; font-size: 12px; color: inherit; background: transparent; cursor: pointer; transition: background var(--motion-fast); }
  button:hover { background: var(--warning-hover); }
  button.primary { font-weight: 600; }
  button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
  button:disabled { opacity: .55; cursor: wait; }
  .compact { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 4px 8px; }
  .compact > :global(svg) { margin-top: 2px; }
  .compact .actions { grid-column: 2; margin-left: -9px; }
</style>
