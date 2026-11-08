<script lang="ts">
  import { onMount } from 'svelte';
  import { emitTo, listen } from '@tauri-apps/api/event';
  import { getCurrentWindow, LogicalPosition, PhysicalPosition } from '@tauri-apps/api/window';
  import { isMacPlatform } from '$lib/settings';
  import { DETACH_PULL } from '$lib/centerLayout';
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

  type Pointer = { x: number; y: number };
  const act = (action: 'expand' | 'new' | 'detach' | 'drag' | 'drop' | 'moved', pointer?: Pointer) =>
    emitTo('main', 'center-dock-action', { action, pointer });
  const mac = isMacPlatform();
  /** Pointer in the frontend's normalized space (global logical on macOS, physical elsewhere). */
  const at = (e: PointerEvent): Pointer => mac ? { x: e.screenX, y: e.screenY } : { x: e.screenX * devicePixelRatio, y: e.screenY * devicePixelRatio };

  // The handle slides along its edge; a clear inward pull turns it back into the window
  // under the pointer; a press without movement is a click.
  let press: { start: Pointer; grabY: number; edgeX: number; moved: boolean; detached: boolean } | null = null;
  let frame = 0;
  let pending: Pointer | undefined;
  let detached = $state(false);
  async function handleDown(e: PointerEvent) {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const start = at(e);
    const grabY = mac ? e.clientY : e.clientY * devicePixelRatio;
    press = { start, grabY, edgeX: start.x - (mac ? e.clientX : e.clientX * devicePixelRatio), moved: false, detached: false };
  }
  function handleMove(e: PointerEvent) {
    if (!press) return;
    const p = at(e);
    const inward = dock?.side === 'left' ? p.x - press.start.x : press.start.x - p.x;
    const scale = mac ? 1 : devicePixelRatio;
    if (!press.detached && inward > DETACH_PULL * scale) {
      press.detached = true; detached = true;
      void act('detach', p);
      return;
    }
    if (press.detached) { pending = p; }
    else if (Math.abs(p.y - press.start.y) > 3 * scale) { press.moved = true; pending = p; }
    else return;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const next = pending; pending = undefined;
      if (!next || !press) return;
      if (press.detached) void act('drag', next);
      // Horizontal jitter never moves it off the edge: x stays fixed.
      else void getCurrentWindow().setPosition(mac ? new LogicalPosition(press.edgeX, next.y - press.grabY) : new PhysicalPosition(press.edgeX, next.y - press.grabY));
    });
  }
  function handleUp(e: PointerEvent) {
    if (!press) return;
    const p = at(e); const done = press; press = null;
    cancelAnimationFrame(frame); frame = 0;
    const centerY = p.y - done.grabY + (window.innerHeight * (mac ? 1 : devicePixelRatio)) / 2;
    if (done.detached) { void act('drop', p); setTimeout(() => detached = false, 300); }
    else if (done.moved) void act('moved', { x: p.x, y: centerY });
    else void act('expand');
  }
  function handleKey(e: KeyboardEvent) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void act('expand'); } }

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
  <div class="handle side-{dock.side}" class:detached role="button" tabindex="0" title="点击恢复便签中心 · 上下拖动调整位置 · 向内拖出" aria-label="恢复便签中心"
    onpointerdown={handleDown} onpointermove={handleMove} onpointerup={handleUp} onpointercancel={() => { if (press?.detached) void act("drop"); press = null; }} onkeydown={handleKey}>
    <i aria-hidden="true"></i>
    <NotebookPen size={13} strokeWidth={1.8} />
    <span>便签</span>
  </div>
{/if}

<style>
  :global(html), :global(body) { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  :global(body) { font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif; color: var(--text); -webkit-font-smoothing: antialiased; }
  @keyframes appear { from { opacity: 0; transform: scale(.96); } }
  .bar:hover { background: var(--surface-raised); border-color: var(--border); }
  .bar { transition: background 160ms, border-color 160ms; }
  .bar { box-sizing: border-box; height: 100%; display: flex; align-items: center; gap: 4px; padding: 0 6px 0 12px; border: 1px solid var(--border); border-radius: 20px; background: var(--surface-raised); cursor: pointer; user-select: none; animation: appear 220ms cubic-bezier(.2,.85,.25,1); }

  .mark { display: grid; place-items: center; color: var(--accent); }
  .label { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; overflow: hidden; white-space: nowrap; }
  .label b { font-weight: 600; }
  .label small { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--muted); font-size: 12px; }
  button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%; color: var(--text); background: transparent; cursor: pointer; transition: background 140ms, color 140ms; }
  button:hover { color: var(--text); background: var(--hover); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .handle { position: relative; box-sizing: border-box; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--border); border-radius: 0 12px 12px 0; border-left: 0; color: var(--accent); background: var(--surface-raised); animation: appear 220ms cubic-bezier(.2,.85,.25,1); transition: background 160ms; }
  .handle.side-right { border-radius: 12px 0 0 12px; border-left: 1px solid var(--border); border-right: 0; }
  .handle:hover { background: var(--accent-soft); }
  .handle { cursor: grab; user-select: none; touch-action: none; transition: background 160ms, opacity 120ms; }
  .handle:active { cursor: grabbing; }
  .handle.detached { opacity: 0; }
  .handle.side-left { box-shadow: inset -3px 0 4px -3px #0000001f; }
  .handle.side-right { box-shadow: inset 3px 0 4px -3px #0000001f; }
  .handle i { background: var(--accent) !important; }
  .handle span { color: var(--text) !important; }
  .handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .handle i { position: absolute; top: 12px; bottom: 12px; left: 0; width: 3px; border-radius: 0 3px 3px 0; background: #2563eb; }
  .handle.side-right i { left: auto; right: 0; border-radius: 3px 0 0 3px; }
  .handle span { writing-mode: vertical-rl; font-size: 11px; font-weight: 600; letter-spacing: 2px; color: var(--text); }
  @media (prefers-reduced-motion: reduce) { .bar, .handle { animation: none; } button { transition: none; } }
</style>
