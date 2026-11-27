<script lang="ts">
  import { CircleAlert, Maximize2, Minimize2, GripVertical } from "lucide-svelte";
  import type { Window } from "@tauri-apps/api/window";
  type ResizeDirection = Parameters<Window["startResizeDragging"]>[0];
  import Toolbar from "./Toolbar.svelte";
  import PixelMark from "./PixelMark.svelte";
  import { isMacPlatform, type NoteTheme } from "$lib/settings";
  import { reveal } from "$lib/motion";

  type NoteViewSettings = { alwaysOnTop: boolean; opacity: number; theme: NoteTheme; customColor: string };
  type Props = {
    disabled?: boolean;
    /** True once the native window has been shown, so the pop-in animation is never wasted while hidden. */
    revealed?: boolean;
    /** True when macOS frosted vibrancy is active behind this window. */
    glass?: boolean;
    /** Softly dim an unfocused, unhovered desktop note when fadeOnBlur is enabled. */
    faded?: boolean;
    /** Click-through reference mode: mouse events pass straight to apps underneath. */
    ghost?: boolean;
    collapsed?: boolean;
    /** Set while the note is docked to a screen edge; collapsed it renders as a tab. */
    dockedSide?: 'left' | 'right';
    /** Expanded content size held fixed while the native frame animates around it. */
    freeze?: { width: number; height: number };
    /** The frame is growing open: fade the editor in alongside it. */
    opening?: boolean;
    transitioning?: boolean;
    title: string;
    displayHeading?: string;
    status: string;
    sourceMode: boolean;
    settings: NoteViewSettings;
    onTitleChange: (title: string) => void;
    onOpacityChange?: (value: number, commit: boolean) => void;
    onTogglePin: () => void;
    onToggleSource: () => void;
    onOpenNotes: () => void;
    onOpenTemplates: () => void;
    onCopy?: () => void;
    onExport: () => void;
    /** Opens the native color menu (never clipped by the small window). */
    onPickColor: () => void;
    onDelete: () => void;
    onQuit: () => void;
    onToggleCollapsed?: () => void;
    onNewNote?: () => void;
    onArchive?: () => void;
    onReturn?: () => void;
    /** `pressed`: a mouse button is down (something is being dragged across); no preview then. */
    onHover?: (inside: boolean, pressed?: boolean) => void;
    edgeHint?: string;
    edgeOverflow?: number;
    taskProgress?: { total: number; done: number };
    reminderDue?: boolean;
    onReminder?: () => void;
    onMoveCompletedBottom?: () => void;
    onRolloverTasks?: () => void;
    onClearCompleted?: () => void;
    onDock?: (side:'left'|'right')=>void;
    onGhost?: () => void;
    locating?: boolean;
    onStartDrag: (event: PointerEvent) => void;
    onStartResize: (event: PointerEvent, direction: ResizeDirection) => void;
    children: import("svelte").Snippet;
  };
  let { disabled = false, revealed = false, glass = false, faded = false, ghost = false, collapsed = false, dockedSide, freeze, opening = false, transitioning = false, title, displayHeading, status, sourceMode, settings,
    onTitleChange, onOpacityChange, onTogglePin, onToggleSource, onOpenNotes, onOpenTemplates, onCopy, onExport, onPickColor,
    onDelete, onQuit, onToggleCollapsed = () => {}, onNewNote, onArchive, onReturn, onHover, onReminder, onMoveCompletedBottom, onRolloverTasks, onClearCompleted, onDock, onGhost, locating=false, edgeHint = '', edgeOverflow = 0, taskProgress, reminderDue = false, onStartDrag, onStartResize, children }: Props = $props();
  let visibleStatus = $state(false);
  const statusIsError = $derived(/失败|错误|无法|不能/.test(status));
  const tab = $derived(collapsed && Boolean(dockedSide));
  const shownTitle = $derived((displayHeading || title || '未命名便签').trim() || '未命名便签');
  // The tab shows a short vertical label: the first few characters of the title.
  const tabLabel = $derived(Array.from(shownTitle).slice(0, 3).join(''));
  $effect(() => {
    visibleStatus = Boolean(status) && !/正在|已就绪|快捷键已就绪/.test(status);
    if (!statusIsError) {
      const timer = setTimeout(() => (visibleStatus = false), 1600);
      return () => clearTimeout(timer);
    }
  });

  // Tooltips name the next action; the shortcut follows the platform.
  const pinShortcut = isMacPlatform() ? '⌘T' : 'Ctrl+T';
  let capsule = $state<HTMLDivElement>();
  let collapseButton = $state<HTMLButtonElement>();
  let focusAfterTransition = false;
  let keyboardIntent = false;
  $effect(() => {
    const key = () => { keyboardIntent = true; }, pointer = () => { keyboardIntent = false; };
    window.addEventListener('keydown', key, true); window.addEventListener('pointerdown', pointer, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('pointerdown', pointer, true); };
  });
  $effect(() => {
    if (disabled) { focusAfterTransition = false; return; }
    if (transitioning) { focusAfterTransition = true; return; }
    if (!focusAfterTransition) return;
    focusAfterTransition = false;
    if (!keyboardIntent) return;
    const target = collapsed ? capsule : collapseButton;
    const frame = requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  });

  const directions: ResizeDirection[] = ["North", "NorthEast", "East", "SouthEast", "South", "SouthWest", "West", "NorthWest"];
  let origin: { x: number; y: number; event: PointerEvent } | null = null;
  let dragged = false;
  function capsuleDown(event: PointerEvent) {
    if (event.button !== 0 || transitioning || (event.target instanceof Element && event.target.closest('button'))) return;
    origin = { x: event.clientX, y: event.clientY, event };
    dragged = false;
    onHover?.(false); // a press is a click or a drag, never a hover
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

  function dragbarDoubleClick(event: MouseEvent) {
    if (transitioning || (event.target instanceof Element && event.target.closest('button, input'))) return;
    onToggleCollapsed();
  }
  let wheelTimer: ReturnType<typeof setTimeout>;
  function dragbarWheel(event: WheelEvent) {
    if (!event.altKey || !onOpacityChange) return;
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.04 : -0.04;
    const next = Math.round(Math.min(1, Math.max(0.6, settings.opacity + delta)) * 100) / 100;
    if (next === settings.opacity) return;
    onOpacityChange(next, false);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => onOpacityChange(next, true), 260);
  }

  // Only pop once after the window has actually been shown.
  let born = $state(false);
  let popped = false;
  $effect(() => {
    if (!revealed || popped) return;
    popped = true;
    born = true;
    const t = setTimeout(() => (born = false), 380);
    return () => clearTimeout(t);
  });
</script>

<main inert={disabled} class="window-shell theme-{settings.theme} dock-{dockedSide ?? 'none'}" class:glass class:faded class:ghost class:collapsed class:tab class:transitioning class:born
  class:frozen={Boolean(freeze)} class:opening style:--freeze-w={freeze ? `${freeze.width}px` : undefined} style:--freeze-h={freeze ? `${freeze.height}px` : undefined}
  style:--pin-opacity={settings.opacity} style:--pin-custom={settings.customColor}>
  <section class="note-window" class:locating class:edge-ready={!!edgeHint} aria-label="驻墨便签">
    {#if ghost && !collapsed}<div class="ghost-indicator" role="status">穿透参考中 · 托盘或中心可恢复</div>{/if}
    {#if edgeHint && !collapsed}<div class="edge-indicator" role="status">{edgeHint}</div>{/if}
    {#if locating}<div class="locate-indicator" role="status">已定位到这张便签</div>{/if}
    {#if tab}
      {@const tabTooltip = statusIsError
        ? status
        : `${shownTitle}${taskProgress?.total ? ` · 待办 ${taskProgress.done}/${taskProgress.total}` : ''}${reminderDue ? ' · 提醒已到期' : ''} · 悬停预览，点击展开，向内拖出可解除停靠`}
      <div bind:this={capsule} class="edge-tab" data-capsule-drag role="button" tabindex="0" aria-label={`展开便签 ${shownTitle}`}
        title={tabTooltip}
        aria-describedby={statusIsError ? "capsule-error" : undefined}
        onpointerdown={capsuleDown} onpointermove={capsuleMove} onpointerup={capsuleEnd}
        onpointercancel={capsuleEnd} onlostpointercapture={() => (origin = null)} onclick={expandCapsule}
        onpointerenter={e => onHover?.(true, e.buttons !== 0)} onpointerleave={() => onHover?.(false)}
        onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!transitioning) onToggleCollapsed(); } }}
        >
        <i class="tab-accent" class:has-tasks={Boolean(taskProgress?.total)} aria-hidden="true">
          {#if taskProgress?.total}<b class="tab-progress" style:height="{Math.round((taskProgress.done / taskProgress.total) * 100)}%"></b>{/if}
        </i>
        {#if reminderDue}<i class="tab-due" aria-label="提醒到期"></i>{/if}
        <span class="tab-label">{tabLabel}</span>
        {#if statusIsError}<i class="tab-error" aria-hidden="true"></i>{/if}
        {#if edgeOverflow}<button class="tab-overflow" title={`还有 ${edgeOverflow} 张停靠便签，在便签中心查看`} onclick={e=>{e.stopPropagation();onOpenNotes();}}>+{edgeOverflow}</button>{/if}
      </div>
      {#if statusIsError}
        <span id="capsule-error" class="visually-hidden" role="alert">{status}</span>
      {/if}
    {:else if collapsed}
      <div bind:this={capsule} class="capsule" data-capsule-drag role="button" tabindex="0" aria-label={`展开便签 ${shownTitle}`}
        title={statusIsError ? status : shownTitle} aria-describedby={statusIsError ? "capsule-error" : undefined}
        onpointerdown={capsuleDown} onpointermove={capsuleMove} onpointerup={capsuleEnd}
        onpointercancel={capsuleEnd} onlostpointercapture={() => (origin = null)} onclick={expandCapsule}
        onpointerenter={e => onHover?.(true, e.buttons !== 0)} onpointerleave={() => onHover?.(false)}
        onkeydown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!transitioning) onToggleCollapsed(); } }}
        >
        <button class="dot-button" type="button" title="便签颜色" aria-label="便签颜色" onclick={e=>{e.stopPropagation();onPickColor();}}><i class="color-dot" aria-hidden="true"></i></button>
        <span class="capsule-title">{edgeHint || shownTitle}</span>
        {#if edgeOverflow}<button class="overflow" title="查看溢出的桌面便签" onclick={e=>{e.stopPropagation();onOpenNotes();}}>+{edgeOverflow}</button>{/if}
        {#if statusIsError}
          <CircleAlert class="capsule-error-icon" size={13} aria-hidden="true" />
        {:else}
          <button class="mini-button" class:on={settings.alwaysOnTop} type="button" aria-pressed={settings.alwaysOnTop}
            title={settings.alwaysOnTop ? '取消置顶' : '置顶'} aria-label={settings.alwaysOnTop?'取消置顶':'置顶'} onclick={e=>{e.stopPropagation();onTogglePin();}}><PixelMark variant="pin" size={14} filled={settings.alwaysOnTop} /></button>
          <button class="mini-button" type="button" title="展开" aria-label="展开便签" onclick={e=>{e.stopPropagation();if(!transitioning)onToggleCollapsed();}}><Maximize2 size={13} /></button>
        {/if}
      </div>
      {#if statusIsError}
        <span id="capsule-error" class="visually-hidden" role="alert">{status}</span>
      {/if}
    {/if}
    <header class="dragbar" inert={collapsed || transitioning} aria-hidden={collapsed} role="presentation"
      onpointerdown={onStartDrag} ondblclick={dragbarDoubleClick} onwheel={dragbarWheel}>
      <span class="drag-grip" title="拖动便签 · 双击收起为胶囊 · 靠近左右边缘可收纳"><GripVertical size={13}/></span>
      <button class="dot-button" type="button" title="便签颜色" aria-label="便签颜色" onclick={onPickColor}><i class="color-dot" aria-hidden="true"></i></button>
      <input class="title-input" aria-label="便签标题" placeholder={shownTitle} value={title}
        oninput={(event) => onTitleChange(event.currentTarget.value)} />
      <div class="header-actions">
        <button class="pin-button" class:on={settings.alwaysOnTop} type="button" aria-pressed={settings.alwaysOnTop}
          title={`${settings.alwaysOnTop ? '取消置顶' : '置顶'}（${pinShortcut}）`} aria-label={settings.alwaysOnTop?'取消置顶':'置顶'} onclick={onTogglePin}>
          <PixelMark variant="pin" size={16} filled={settings.alwaysOnTop} />
        </button>
        <button bind:this={collapseButton} class="collapse-button" type="button" title="收起便签 · 也可双击标题栏" aria-label="收起便签" onclick={onToggleCollapsed}>
          <Minimize2 size={16} />
        </button>
        {#if !collapsed}
          <Toolbar {sourceMode} opacity={settings.opacity} {onOpacityChange} {onToggleSource} {onOpenNotes}
            {onOpenTemplates} {onCopy} {onExport} {onDelete} {onQuit} {onNewNote} {onArchive} {onReturn} {onReminder} {onMoveCompletedBottom} {onRolloverTasks} {onClearCompleted} {onDock} {onGhost} />
        {/if}
      </div>
    </header>
    <div class="editor-frame" inert={collapsed || transitioning} aria-hidden={collapsed}>
      {@render children()}
    </div>
    {#if !collapsed && !transitioning}
      <span class="note-fold" aria-hidden="true"><PixelMark variant="fold" size={18} /></span>
    {/if}
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
  /* ---- Base ---- */
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) { width: 100%; height: 100%; margin: 0; }
  :global(body) { overflow: hidden; color: var(--text); background: transparent; font-family: var(--font); font-size: 14px; line-height: 1.55; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }

  /* ---- Note palette: the note's own colour (a note property) plus shared UI tokens ---- */
  .window-shell.born.dock-none:not(.collapsed) { animation: note-in 320ms var(--ease-spring); }
  @keyframes note-in { from { opacity: 0; transform: scale(.96); } }
  @media (prefers-reduced-motion: reduce) { .window-shell.born { animation: none; } }
  .window-shell {
    --pin-dot: #a1a1aa; --pin-bg: #ffffff; --pin-header: color-mix(in srgb, var(--pin-text) 2.5%, var(--pin-bg));
    --pin-text: #171717; --pin-heading: #111111; --pin-muted: #737373;
    --pin-border: #00000014; --pin-accent: var(--accent); --pin-accent-strong: var(--accent-strong);
    --pin-on-accent: var(--on-accent); --pin-hover: #0000000a; --pin-active: var(--accent-soft);
    width: 100vw; height: 100vh; background: transparent;
  }
  .theme-cream { --pin-dot: #d8ab4c; --pin-bg: #fffcf0; --pin-accent: #b47816; --pin-accent-strong: #925f0c; --pin-active: #b478161a; }
  .theme-mint { --pin-dot: #5fb494; --pin-bg: #f2faf6; --pin-accent: #1d8360; --pin-accent-strong: #15674b; --pin-active: #1d83601a; }
  .theme-rose { --pin-dot: #dc8d89; --pin-bg: #fff5f4; --pin-accent: #c25158; --pin-accent-strong: #9f3e44; --pin-active: #c251581a; }
  .theme-sky { --pin-dot: #6aa4df; --pin-bg: #f2f8ff; }
  .theme-grape { --pin-dot: #aa8ad1; --pin-bg: #f8f4ff; --pin-accent: #7c4fd6; --pin-accent-strong: #6239b5; --pin-active: #7c4fd61a; }
  .theme-custom { --pin-dot: var(--pin-custom); --pin-bg: color-mix(in srgb, var(--pin-custom), white 92%); --pin-accent: var(--pin-custom); --pin-accent-strong: color-mix(in srgb, var(--pin-custom) 82%, black); --pin-active: color-mix(in srgb, var(--pin-custom) 14%, transparent); }
  .theme-ink {
    --pin-dot: #8a8a8a; --pin-bg: #252527; --pin-text: #f5f5f5; --pin-heading: #ffffff; --pin-muted: #a3a3a3;
    --pin-border: #ffffff20; --pin-accent: #93b4ff; --pin-accent-strong: #b6cdff; --pin-on-accent: #0b1530;
    --pin-hover: #ffffff12; --pin-active: #3b82f62e;
  }
  /* Dark app theme: the note colour becomes a tint on a dark surface; the stored colour is untouched. */
  :global([data-theme="dark"]) .window-shell {
    --pin-bg: color-mix(in srgb, var(--pin-dot) 13%, #1f1f21); --pin-text: var(--text); --pin-heading: var(--text-strong);
    --pin-muted: var(--muted); --pin-border: color-mix(in srgb, var(--pin-dot) 28%, #ffffff1f);
    --pin-accent: var(--accent); --pin-accent-strong: var(--accent-strong); --pin-on-accent: #0b1530;
    --pin-hover: var(--hover-strong); --pin-active: var(--accent-soft-strong);
  }
  :global([data-theme="dark"]) .window-shell.theme-paper { --pin-bg: #1f1f21; --pin-border: #ffffff1f; }
  :global([data-theme="dark"]) .window-shell.theme-cream { --pin-accent: #f0c36d; --pin-accent-strong: #f6d591; --pin-active: #f0c36d24; }
  :global([data-theme="dark"]) .window-shell.theme-mint { --pin-accent: #68cfa9; --pin-accent-strong: #92dfc2; --pin-active: #68cfa924; }
  :global([data-theme="dark"]) .window-shell.theme-rose { --pin-accent: #f1989a; --pin-accent-strong: #f6b6b8; --pin-active: #f1989a24; }
  :global([data-theme="dark"]) .window-shell.theme-grape { --pin-accent: #c3a4f5; --pin-accent-strong: #d7c3f8; --pin-active: #c3a4f524; }
  :global([data-theme="dark"]) .window-shell.theme-custom { --pin-accent: color-mix(in srgb, var(--pin-custom) 78%, white); --pin-active: color-mix(in srgb, var(--pin-custom) 24%, transparent); }

  /* ---- Frame and shadow levels ---- */
  .note-window {
    position: relative; display: grid; grid-template-rows: 40px minmax(0, 1fr); width: 100%; height: 100%;
    border: 1px solid var(--pin-border); border-radius: var(--radius-lg); overflow: hidden;
    color: var(--pin-text);
    background: color-mix(in srgb, var(--pin-bg) calc(var(--pin-opacity) * 100%), transparent);
    transition: border-radius var(--motion) var(--ease-out), background var(--motion), opacity var(--motion) var(--ease-out);
  }
  .window-shell.faded:not(.collapsed) .note-window { opacity: .62; }
  .window-shell.ghost:not(.collapsed) .note-window { opacity: .56; border: 1px dashed color-mix(in srgb, var(--pin-accent) 48%, transparent); }
  .window-shell.ghost .header-actions { opacity: .2; }
  .ghost-indicator {
    position: absolute; z-index: 130; bottom: 8px; right: 10px; padding: 2px 8px;
    border-radius: 999px; font-size: 10px; white-space: nowrap; pointer-events: none;
    color: var(--pin-accent); background: var(--pin-active);
  }
  /* When macOS frosted vibrancy runs behind the note, let blurred wallpaper shine through cleanly with glass bevels. */
  .window-shell.glass:not(.tab) .note-window {
    background: var(--glass-sheen), color-mix(in srgb, var(--pin-bg) calc(var(--pin-opacity) * var(--glass-note, 64%)), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset 1px 0 0 var(--glass-rim), inset 0 0 0 .5px var(--glass-rim);
  }
  :global([data-note-shadow="light"]) .note-window { border-color: color-mix(in srgb, var(--pin-text) 22%, transparent); }
  :global([data-note-shadow="off"]) .note-window { border-color: color-mix(in srgb, var(--pin-border), transparent 45%); }
  .note-window.locating, .note-window.edge-ready { box-shadow: inset 0 0 0 2px var(--pin-accent); }
  .note-window.locating { animation: locate-glow 600ms ease-in-out 3; }
  @keyframes locate-glow { 50% { box-shadow: inset 0 0 0 4px color-mix(in srgb, var(--pin-accent) 45%, transparent); } }
  .edge-indicator, .locate-indicator {
    position: absolute; z-index: 130; top: 46px; left: 50%; transform: translateX(-50%); padding: 4px 10px;
    border-radius: var(--radius); font-size: 11px; white-space: nowrap; pointer-events: none;
    color: var(--on-accent); background: var(--accent); box-shadow: 0 4px 12px #0000001f;
  }
  .collapsed .locate-indicator { display: none; }

  /* ---- Title bar: colour · title · pin · collapse · more ---- */
  .dragbar {
    position: relative; display: flex; align-items: center; gap: 4px; min-width: 0; padding: 4px 6px 5px 12px;
    background: color-mix(in srgb, var(--pin-text) 3.5%, transparent);
    cursor: grab; user-select: none; transition: opacity var(--motion-fast);
  }
  .dragbar::after {
    content: ""; position: absolute; left: 10px; right: 10px; bottom: 0; height: 1.5px; pointer-events: none;
    background: repeating-linear-gradient(90deg, var(--pin-border) 0 4px, transparent 4px 8px);
  }
  .note-fold {
    position: absolute; z-index: 60; right: 1px; bottom: 1px; display: grid; place-items: center;
    pointer-events: none; opacity: .88;
  }
  .dragbar:active { cursor: grabbing; }
  .drag-grip { display: grid; place-items: center; flex: 0 0 12px; margin: 0 -4px 0 -8px; color: var(--pin-muted); opacity: 0; transition: opacity var(--motion-fast); cursor: grab; }
  .dragbar:hover .drag-grip { opacity: .6; }
  .title-input {
    min-width: 0; flex: 1; width: 0; border: 0; border-radius: var(--radius-sm); padding: 2px 4px; margin-left: 2px;
    outline: 0; font: inherit; font-size: 14px; line-height: 20px; font-weight: 600;
    text-overflow: ellipsis; color: var(--pin-heading); background: transparent; cursor: text;
  }
  .title-input::placeholder { color: var(--pin-muted); font-weight: 500; }
  .title-input:focus-visible { box-shadow: 0 1px 0 var(--pin-accent); }
  .header-actions { display: flex; align-items: center; gap: 2px; transition: opacity var(--motion-fast); }

  .pin-button, .collapse-button, .mini-button, .dot-button {
    display: grid; place-items: center; flex: 0 0 auto; padding: 0; border: 0; border-radius: 50%;
    color: var(--pin-muted); background: transparent; cursor: pointer;
    transition: color var(--motion-fast), background var(--motion-fast), transform 240ms var(--ease-spring);
  }
  .pin-button, .collapse-button { width: 28px; height: 28px; }
  .mini-button, .dot-button { width: 22px; height: 22px; }
  .pin-button:hover, .collapse-button:hover, .mini-button:hover, .dot-button:hover { color: var(--pin-text); background: var(--pin-hover); }
  .pin-button:active, .collapse-button:active, .mini-button:active { transform: scale(.91); }
  .pin-button:focus-visible, .collapse-button:focus-visible, .mini-button:focus-visible, .dot-button:focus-visible { outline: 2px solid var(--pin-accent); outline-offset: -2px; }
  .pin-button.on, .mini-button.on { color: var(--pin-accent); background: var(--pin-active); }
  .pin-button.on :global(svg), .mini-button.on :global(svg) { fill: currentColor; fill-opacity: .22; }
  .color-dot { width: 12px; height: 12px; clip-path: var(--px-cut); background: var(--pin-dot); box-shadow: inset 0 0 0 1px var(--hairline); transition: transform var(--motion-fast); }
  .dot-button:hover .color-dot { transform: scale(1.16); }

  .editor-frame { display: flex; flex-direction: column; min-height: 0; overflow: hidden; transition: opacity 120ms ease; --banner-inset: 10px; }
  .editor-frame > :global(*) { flex: 0 0 auto; }
  .editor-frame > :global(:last-child) { flex: 1 1 0; min-height: 0; height: auto; }
  .editor-frame > :global(.banner) { margin-top: 8px; margin-bottom: 2px; }
  .status-toast {
    position: absolute; z-index: 80; right: 12px; bottom: 10px; max-width: calc(100% - 24px); padding: 5px 10px;
    border: 0; border-radius: var(--radius); color: var(--pin-text); background: var(--material);
    -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur);
    font-size: 11px; box-shadow: var(--material-shadow);
  }
  .status-toast.error { color: var(--danger); overflow-wrap: anywhere; max-height: 50%; overflow: auto; }

  /* ---- Capsule: colour · title · pin · expand ---- */
  @keyframes pin-appear { from { opacity: 0; } }
  .collapsed .note-window { border-radius: 999px; grid-template-rows: 1fr; }
  .collapsed .dragbar, .collapsed .editor-frame { display: none; }
  .capsule { position: absolute; inset: 0; display: flex; align-items: center; gap: 2px; padding: 0 5px 0 7px; border-radius: inherit; user-select: none; touch-action: none; cursor: grab; animation: pin-appear var(--motion-fast) ease-out; transition: background var(--motion-fast); }
  .capsule:hover { background: var(--pin-hover); }
  .capsule:active { cursor: grabbing; }
  .capsule:focus-visible { outline: 2px solid var(--pin-accent); outline-offset: -3px; }
  .capsule .capsule-title { flex: 1; min-width: 0; margin-left: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--pin-heading); }
  .capsule :global(svg) { flex: 0 0 auto; }
  .capsule .mini-button:not(.on) { opacity: 0; }
  .capsule:hover .mini-button, .capsule:focus-within .mini-button { opacity: 1; }
  .overflow, .tab-overflow { border: 0; border-radius: 999px; padding: 1px 6px; font: inherit; font-size: 10px; font-weight: 600; line-height: 16px; color: var(--pin-accent); background: var(--pin-active); cursor: pointer; }
  .capsule :global(.capsule-error-icon) { color: var(--danger); }

  /* ---- Edge tab: flat against the screen edge, rounded toward the desktop, no buttons ---- */
  .tab .note-window { grid-template-rows: 1fr; border-radius: 0 var(--radius-lg) var(--radius-lg) 0; border-left-width: 0; background: color-mix(in srgb, var(--pin-bg) 95%, transparent); box-shadow: inset -3px 0 4px -3px #0000001a, inset 0 1px 0 var(--glass-edge); }
  .tab.dock-right .note-window { border-radius: var(--radius-lg) 0 0 var(--radius-lg); border-left-width: 1px; border-right-width: 0; box-shadow: inset 3px 0 4px -3px #0000001a, inset 0 1px 0 var(--glass-edge); }
  .tab .dragbar, .tab .editor-frame { display: none; }
  .edge-tab { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; user-select: none; touch-action: none; cursor: pointer; animation: pin-appear var(--motion-fast) ease-out; transition: background var(--motion-fast), padding var(--motion-fast) var(--ease-out); }
  .edge-tab:hover { background: var(--pin-hover); padding-left: 2px; }
  .dock-right .edge-tab:hover { padding-left: 0; padding-right: 2px; }
  .edge-tab:focus-visible { outline: 2px solid var(--pin-accent); outline-offset: -3px; }
  .tab-accent { position: absolute; top: 10px; bottom: 10px; left: 0; width: 3px; background: var(--pin-dot); overflow: hidden; transition: width var(--motion-fast) var(--ease-out); }
  .tab-accent.has-tasks { background: color-mix(in srgb, var(--pin-dot) 26%, transparent); }
  .tab-progress { position: absolute; left: 0; right: 0; top: 0; display: block; background: repeating-linear-gradient(var(--pin-accent) 0 5px, transparent 5px 7px); transition: height 260ms var(--ease-out); }
  .dock-right .tab-accent { left: auto; right: 0; }
  .edge-tab:hover .tab-accent { width: 5px; }
  .tab-due { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; background: var(--danger); box-shadow: 0 0 0 0 color-mix(in srgb, var(--danger) 55%, transparent); animation: tab-due-pulse 2s ease-out infinite; }
  .dock-right .tab-due { right: auto; left: 5px; }
  @keyframes tab-due-pulse { 70% { box-shadow: 0 0 0 5px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
  .tab-label { writing-mode: vertical-rl; max-height: 100%; overflow: hidden; font-size: 12px; font-weight: 600; letter-spacing: 1px; line-height: 1; color: var(--pin-heading); }
  .tab-error { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--danger); }
  .tab-overflow { position: absolute; bottom: 3px; left: 50%; transform: translateX(-50%); padding: 0 4px; font-size: 9px; line-height: 14px; }

  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

  /* ---- Resize zones ---- */
  .resize-zone { position: absolute; z-index: 90; background: transparent; touch-action: none; }
  .resize-North, .resize-South { height: 4px; left: 12px; right: 12px; cursor: ns-resize; }
  .resize-North { top: 0; } .resize-South { bottom: 0; }
  .resize-East, .resize-West { width: 4px; top: 12px; bottom: 12px; cursor: ew-resize; }
  .resize-East { right: 0; } .resize-West { left: 0; }
  .resize-NorthEast, .resize-NorthWest, .resize-SouthEast, .resize-SouthWest { width: 12px; height: 12px; }
  .resize-NorthEast { top: 0; right: 0; cursor: nesw-resize; } .resize-SouthWest { bottom: 0; left: 0; cursor: nesw-resize; }
  .resize-NorthWest { top: 0; left: 0; cursor: nwse-resize; } .resize-SouthEast { bottom: 0; right: 0; cursor: nwse-resize; }

  /* ---- Morph: content keeps its expanded layout, anchored where the window folds to ---- */
  .transitioning .editor-frame, .transitioning .header-actions { opacity: 0; }
  .frozen .dragbar, .frozen .editor-frame { width: var(--freeze-w); justify-self: end; }
  .frozen.dock-left .dragbar, .frozen.dock-left .editor-frame { justify-self: start; }
  .frozen .editor-frame { height: calc(var(--freeze-h) - 40px); align-self: start; }
  .transitioning .editor-frame { transition: opacity var(--motion-fast) ease-in; }
  .transitioning.opening .editor-frame, .transitioning.opening .header-actions { opacity: 1; transition: opacity var(--motion) var(--ease-out) 40ms; }
  @starting-style { .transitioning.opening .editor-frame, .transitioning.opening .header-actions { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .note-window, .dragbar, .editor-frame, .header-actions, .pin-button, .collapse-button, .mini-button, .capsule, .edge-tab, .tab-accent, .tab-progress, .tab-due { transition: none; animation: none; } }
</style>
