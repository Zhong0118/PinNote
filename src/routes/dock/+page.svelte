<script lang="ts">
  import { onMount } from 'svelte';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { Maximize2, Plus, NotebookPen } from 'lucide-svelte';

  /** Collapsed forms of the note center: a free strip or a docked edge handle. */
  type DockState = { kind: 'bar' | 'handle'; side: 'left' | 'right'; title: string; count: number };
  let dock = $state<DockState>();

  onMount(() => {
    const stop = listen<DockState>('center-dock-state', ({ payload }) => { dock = payload; });
    // The center may have sent its state before this page finished loading.
    void stop.then(() => emitTo('main', 'center-dock-hello'));
    return () => { void stop.then(f => f()); };
  });

  const act = (action: 'expand' | 'new') => emitTo('main', 'center-dock-action', { action });

  // A click anywhere on the strip opens the center; a drag moves the strip.
  let downAt: { x: number; y: number } | null = null;
  function down(event: PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    downAt = { x: event.clientX, y: event.clientY };
  }
  function move(event: PointerEvent) {
    if (!downAt || dock?.kind !== 'bar' || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) < 4) return;
    downAt = null;
    void getCurrentWindow().startDragging();
  }
  function up() { if (downAt) void act('expand'); downAt = null; }
</script>

{#if dock?.kind === 'bar'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <main class="bar" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={() => (downAt = null)}>
    <span class="mark"><NotebookPen size={14} strokeWidth={1.8} /></span>
    <span class="label"><b>便签中心</b>{#if dock.title}<small>{dock.title}</small>{/if}</span>
    <button title="新建便签" aria-label="新建便签" onclick={() => act('new')}><Plus size={15} /></button>
    <button title="展开便签中心" aria-label="展开便签中心" onclick={() => act('expand')}><Maximize2 size={14} /></button>
  </main>
{:else if dock?.kind === 'handle'}
  <button class="handle side-{dock.side}" title="展开便签中心" aria-label="展开便签中心" onclick={() => act('expand')}>
    <i aria-hidden="true"></i>
    <NotebookPen size={13} strokeWidth={1.8} />
    <span>便签</span>
  </button>
{/if}

<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  :global(body) { font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; color: #171717; -webkit-font-smoothing: antialiased; }
  @keyframes appear { from { opacity: 0; transform: scale(.96); } }
  .bar:hover { background: #fffffffa; border-color: #00000024; }
  .bar { transition: background 160ms, border-color 160ms; }
  .bar { box-sizing: border-box; height: 100%; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 12px; border: 1px solid #0000001a; border-radius: 20px; background: #fffffff2; cursor: pointer; user-select: none; animation: appear 220ms cubic-bezier(.2,.85,.25,1); }

  .mark { display: grid; place-items: center; color: #2563eb; }
  .label { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; white-space: nowrap; }
  .label b { font-weight: 600; }
  .label small { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #737373; font-size: 12px; }
  button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; color: #525252; background: transparent; cursor: pointer; transition: background 140ms, color 140ms; }
  button:hover { color: #171717; background: #f4f4f5; }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  .handle { position: relative; box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px solid #0000001a; border-radius: 0 12px 12px 0; border-left: 0; color: #2563eb; background: #fffffff2; animation: appear 220ms cubic-bezier(.2,.85,.25,1); transition: background 160ms; }
  .handle.side-right { border-radius: 12px 0 0 12px; border-left: 1px solid #0000001a; border-right: 0; }
  .handle:hover { background: #eff6ff; }
  .handle i { position: absolute; top: 12px; bottom: 12px; left: 0; width: 3px; border-radius: 0 3px 3px 0; background: #2563eb; }
  .handle.side-right i { left: auto; right: 0; border-radius: 3px 0 0 3px; }
  .handle span { writing-mode: vertical-rl; font-size: 11px; font-weight: 600; letter-spacing: 2px; color: #404040; }
  @media (prefers-reduced-motion: reduce) { .bar, .handle { animation: none; } button { transition: none; } }
</style>
