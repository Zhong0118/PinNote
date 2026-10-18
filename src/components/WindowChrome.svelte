<script lang="ts">
  import { CircleAlert, Maximize2, Minimize2 } from "lucide-svelte";
  import type { Window } from "@tauri-apps/api/window";
  type ResizeDirection = Parameters<Window["startResizeDragging"]>[0];
  import Toolbar from "./Toolbar.svelte";
  import type { NoteTheme } from "$lib/settings";
  import { reveal } from "$lib/motion";

  type NoteViewSettings = { alwaysOnTop: boolean; opacity: number; theme: NoteTheme; customColor: string };
  type Props = {
    disabled?: boolean;
    collapsed?: boolean;
    transitioning?: boolean;
    title: string;
    status: string;
    sourceMode: boolean;
    settings: NoteViewSettings;
    onTitleChange: (title: string) => void;
    onTogglePin: () => void;
    onToggleSource: () => void;
    onOpenNotes: () => void;
    onOpenTemplates: () => void;
    onExport: () => void;
    onOpenSettings: () => void;
    onDelete: () => void;
    onQuit: () => void;
    onToggleCollapsed?: () => void;
    onNewNote?: () => void;
    onStartDrag: (event: PointerEvent) => void;
    onStartResize: (event: PointerEvent, direction: ResizeDirection) => void;
    children: import("svelte").Snippet;
  };
  let { disabled = false, collapsed = false, transitioning = false, title, status, sourceMode, settings,
    onTitleChange, onTogglePin, onToggleSource, onOpenNotes, onOpenTemplates, onExport, onOpenSettings,
    onDelete, onQuit, onToggleCollapsed = () => {}, onNewNote, onStartDrag, onStartResize, children }: Props = $props();
  let visibleStatus = $state(false);
  const statusIsError = $derived(/失败|错误|无法|不能/.test(status));
  $effect(() => {
    visibleStatus = Boolean(status) && !/正在|已就绪|快捷键已就绪/.test(status);
    if (!statusIsError) {
      const timer = setTimeout(() => (visibleStatus = false), 1600);
      return () => clearTimeout(timer);
    }
  });

  let capsule = $state<HTMLDivElement>();
  let collapseButton = $state<HTMLButtonElement>();
  let focusAfterTransition = false;
  $effect(() => {
    if (disabled) { focusAfterTransition = false; return; }
    if (transitioning) { focusAfterTransition = true; return; }
    if (!focusAfterTransition) return;
    focusAfterTransition = false;
    const target = collapsed ? capsule : collapseButton;
    const frame = requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });

  const directions: ResizeDirection[] = ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"];
  let origin: { x: number; y: number; event: PointerEvent } | null = null;
  let dragged = false;
  function capsuleDown(event: PointerEvent) {
    if (event.button !== 0 || transitioning) return;
    origin = { x: event.clientX, y: event.clientY, event };
    dragged = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function capsuleMove(event: PointerEvent) {
    if (!origin || origin.event.pointerId !== event.pointerId || dragged || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
    dragged = true;
    const downEvent = origin.event;
    origin = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    onStartDrag(downEvent);
  }
  function capsuleEnd(event: PointerEvent) {
    if (origin?.event.pointerId !== event.pointerId) return;
    origin = null;
    if (event.type === "pointercancel") dragged = true;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  }
  function expandCapsule() {
    if (!dragged && !transitioning) onToggleCollapsed();
    origin = null;
  }
</script>

<main inert={disabled} class="window-shell theme-{settings.theme}" class:collapsed class:transitioning
  style:--pin-opacity={settings.opacity} style:--pin-custom={settings.customColor}>
  <section class="note-window" aria-label="PinNote 便签">
    {#if collapsed}
      <div bind:this={capsule} class="capsule" data-capsule-drag role="button" tabindex="0" aria-label={`展开便签 ${title || "未命名便签"}`}
        title={statusIsError ? status : title || "未命名便签"} aria-describedby={statusIsError ? "capsule-error" : undefined}
        onpointerdown={capsuleDown} onpointermove={capsuleMove} onpointerup={capsuleEnd}
        onpointercancel={capsuleEnd} onlostpointercapture={() => (origin = null)} onclick={expandCapsule}
        onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!transitioning) onToggleCollapsed(); } }}
        >
        <span>{title || "未命名便签"}</span>
        {#if statusIsError}
          <CircleAlert class="capsule-error-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
        {:else}
          <Maximize2 size={13} strokeWidth={1.7} />
        {/if}
      </div>
      {#if statusIsError}
        <span id="capsule-error" class="visually-hidden" role="alert">{status}</span>
      {/if}
    {/if}
    <header class="dragbar" inert={collapsed || transitioning} aria-hidden={collapsed} role="presentation" onpointerdown={onStartDrag}>
      <input class="title-input" aria-label="便签标题" placeholder="未命名便签" value={title}
        oninput={(event) => onTitleChange(event.currentTarget.value)} />
      <div class="header-actions">
        <button bind:this={collapseButton} class="collapse-button" type="button" title="收起便签" aria-label="收起便签" onclick={onToggleCollapsed}>
          <Minimize2 size={15} strokeWidth={1.8} />
        </button>
        {#if !collapsed}
          <Toolbar alwaysOnTop={settings.alwaysOnTop} {sourceMode} {onTogglePin} {onToggleSource} {onOpenNotes}
            {onOpenTemplates} {onExport} {onOpenSettings} {onDelete} {onQuit} {onNewNote} />
        {/if}
      </div>
    </header>
    <div class="editor-frame" inert={collapsed || transitioning} aria-hidden={collapsed}>
      {@render children()}
    </div>
    {#if visibleStatus && !collapsed}
      <div class="status-toast" class:error={statusIsError} role={statusIsError ? "alert" : "status"} transition:reveal>{status}</div>
    {/if}
    {#if !collapsed && !transitioning}
      {#each directions as direction}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="resize-zone resize-{direction}" aria-hidden="true" onpointerdown={(event) => onStartResize(event, direction)}></div>
      {/each}
    {/if}
  </section>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) { width: 100%; height: 100%; margin: 0; }
  :global(body) { overflow: hidden; color: #171717; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px; line-height: 1.55; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
  .window-shell { --pin-page: #f5f5f5; --pin-bg: #fff; --pin-header: #fff; --pin-text: #171717; --pin-heading: #111; --pin-muted: #737373; --pin-border: #00000012; --pin-accent: #2563eb; --pin-accent-strong: #1d4ed8; --pin-hover: #f4f4f5; --pin-active: #eff6ff; width: 100vw; height: 100vh; background: transparent; }
  .theme-mint { --pin-page: #e8f1ec; --pin-bg: #f5fbf8; --pin-header: #f5fbf8; }
  .theme-rose { --pin-page: #f3e8e8; --pin-bg: #fff8f7; --pin-header: #fff8f7; }
  .theme-sky { --pin-page: #e4edf7; --pin-bg: #f6fbff; --pin-header: #f6fbff; }
  .theme-grape { --pin-page: #eee7f5; --pin-bg: #fbf8ff; --pin-header: #fbf8ff; }
  .theme-ink { --pin-page: #202020; --pin-bg: #272727; --pin-header: #272727; --pin-text: #f5f5f5; --pin-heading: #fff; --pin-muted: #a3a3a3; --pin-border: #ffffff20; --pin-accent: #93b4ff; --pin-accent-strong: #b6cdff; --pin-hover: #343434; --pin-active: #263653; }
  .theme-custom { --pin-page: color-mix(in srgb, var(--pin-custom), white 74%); --pin-bg: color-mix(in srgb, var(--pin-custom), white 94%); --pin-header: var(--pin-bg); }
  .note-window { position: relative; display: grid; grid-template-rows: 40px minmax(0, 1fr); width: 100%; height: 100%; border: 1px solid var(--pin-border); border-radius: 16px; overflow: hidden; color: var(--pin-text); background: color-mix(in srgb, var(--pin-bg) calc(var(--pin-opacity) * 100%), transparent); transition: border-radius 180ms, background 180ms; }
  .dragbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 4px 10px 4px 16px; box-shadow: inset 0 -1px 0 var(--pin-border); cursor: grab; user-select: none; transition: opacity 100ms ease; }
  .dragbar:active { cursor: grabbing; }
  .title-input { min-width: 0; flex: 1; width: 0; border: 0; border-radius: 6px; padding: 2px 4px; margin-left: -4px; outline: 0; font: inherit; font-size: 14px; line-height: 20px; font-weight: 600; text-overflow: ellipsis; color: var(--pin-heading); background: transparent; cursor: text; }
  .title-input:focus-visible { box-shadow: 0 1px 0 var(--pin-accent); }
  .header-actions { display: flex; align-items: center; gap: 5px; }
  .collapse-button { display: grid; place-items: center; flex: 0 0 auto; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 50%; color: var(--pin-muted); background: transparent; cursor: pointer; transition: color 140ms, background 140ms, transform 140ms; }
  .collapse-button:hover { color: var(--pin-text); background: var(--pin-hover); transform: scale(1.06); }
  .collapse-button:active { transform: scale(0.93); }
  .collapse-button:focus-visible, .capsule:focus-visible { outline: 2px solid var(--pin-accent); outline-offset: -3px; }
  .editor-frame { min-height: 0; overflow: hidden; transition: opacity 100ms ease; }
  .status-toast { position: absolute; z-index: 80; right: 12px; bottom: 10px; max-width: calc(100% - 24px); padding: 5px 9px; border: 1px solid var(--pin-border); border-radius: 8px; color: var(--pin-muted); background: var(--pin-bg); font-size: 11px; box-shadow: 0 2px 8px #00000006; }
  .status-toast.error { color: #dc2626; overflow-wrap: anywhere; max-height: 50%; overflow: auto; }
  .collapsed .note-window { border-radius: 20px; grid-template-rows: 1fr; }
  .collapsed .dragbar, .collapsed .editor-frame { display: none; }
  .transitioning .editor-frame, .transitioning .header-actions { opacity: 0; }
  .header-actions { transition: opacity 100ms ease; }
  .capsule { position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 14px; border-radius: inherit; user-select: none; touch-action: none; cursor: grab; transition: background 140ms; }
  .capsule:hover { background: var(--pin-hover); }
  .capsule:active { cursor: grabbing; }
  .capsule span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
  .capsule :global(svg) { flex: 0 0 auto; color: var(--pin-muted); }
  .capsule :global(.capsule-error-icon) { color: #dc2626; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .resize-zone { position: absolute; z-index: 90; background: transparent; touch-action: none; }
  .resize-North, .resize-South { height: 4px; left: 12px; right: 12px; cursor: ns-resize; }
  .resize-North { top: 0; } .resize-South { bottom: 0; }
  .resize-East, .resize-West { width: 4px; top: 12px; bottom: 12px; cursor: ew-resize; }
  .resize-East { right: 0; } .resize-West { left: 0; }
  .resize-NorthEast, .resize-NorthWest, .resize-SouthEast, .resize-SouthWest { width: 12px; height: 12px; }
  .resize-NorthEast { top: 0; right: 0; cursor: nesw-resize; } .resize-SouthWest { bottom: 0; left: 0; cursor: nesw-resize; }
  .resize-NorthWest { top: 0; left: 0; cursor: nwse-resize; } .resize-SouthEast { bottom: 0; right: 0; cursor: nwse-resize; }
  :global(::-webkit-scrollbar) { width: 7px; height: 7px; }
  :global(::-webkit-scrollbar-track) { background: transparent; }
  :global(::-webkit-scrollbar-thumb) { border: 2px solid transparent; border-radius: 999px; background-clip: content-box; background-color: #8885; }
  :global(::-webkit-scrollbar-thumb:hover) { background-color: #8888; }
  @media (prefers-reduced-motion: reduce) { .note-window, .dragbar, .editor-frame, .header-actions, .collapse-button, .capsule { transition: none; } }
</style>
