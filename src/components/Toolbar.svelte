<script lang="ts">
  import { Archive, ArrowDownToLine, Bell, CheckCheck, Code2, Copy, CornerDownRight, Download, EyeOff, Ghost, LayoutTemplate, List, MoreHorizontal, PanelLeftClose, PanelRightClose, Plus, Trash2, Undo2 } from "lucide-svelte";
  import { popup, reveal } from "$lib/motion";

  type Props = {
    sourceMode: boolean;
    opacity?: number;
    onOpacityChange?: (value: number, commit: boolean) => void;
    onToggleSource: () => void;
    onOpenNotes: () => void;
    onOpenTemplates: () => void;
    onCopy?: () => void;
    onExport: () => void;
    onDelete: () => void;
    onQuit: () => void;
    onNewNote?: () => void;
    onArchive?: () => void;
    onReturn?: () => void;
    onReminder?: () => void;
    onMoveCompletedBottom?: () => void;
    onRolloverTasks?: () => void;
    onClearCompleted?: () => void;
    onDock?: (side:'left'|'right') => void;
    onGhost?: () => void;
  };

  let { sourceMode, opacity, onOpacityChange, onToggleSource, onOpenNotes,
    onOpenTemplates, onCopy, onExport, onDelete, onQuit, onNewNote, onArchive, onReturn, onReminder, onMoveCompletedBottom, onRolloverTasks, onClearCompleted, onDock, onGhost }: Props = $props();
  let open = $state(false);
  let trigger = $state<HTMLButtonElement>();
  // Everyday actions first; window placement and lifecycle after a divider.
  const actions = $derived([
    ...(onNewNote ? [{ label: "新建便签", icon: Plus, run: onNewNote }] : []),
    ...(onReminder ? [{label:"设置提醒",icon:Bell,run:onReminder}] : []),
    { label: "模板", icon: LayoutTemplate, run: onOpenTemplates },
    ...(onMoveCompletedBottom ? [{label:"已完成项沉底",icon:ArrowDownToLine,run:onMoveCompletedBottom}] : []),
    ...(onRolloverTasks ? [{label:"未完成项转到新便签",icon:CornerDownRight,run:onRolloverTasks}] : []),
    ...(onClearCompleted ? [{label:"移除已完成项（可撤销）",icon:CheckCheck,run:onClearCompleted}] : []),
    { label: sourceMode ? "返回编辑" : "Markdown 源码", icon: Code2, run: onToggleSource, active: sourceMode },
    ...(onCopy ? [{ label: "复制正文", icon: Copy, run: onCopy }] : []),
    { label: "导出 Markdown", icon: Download, run: onExport },
    { divider: true, label: "在便签中心查看", icon: List, run: onOpenNotes },
    ...(onReturn ? [{label:"收回中心", icon:Undo2, run:onReturn}] : []),
    ...(onGhost ? [{label:"穿透参考模式", icon:Ghost, run:onGhost}] : []),
    ...(onDock ? [{label:'收纳到左侧',icon:PanelLeftClose,run:()=>onDock('left')},{label:'收纳到右侧',icon:PanelRightClose,run:()=>onDock('right')}] : []),
    { label: "隐藏便签", icon: EyeOff, run: onQuit },
    ...(onArchive ? [{label:"归档", icon:Archive, run:onArchive}] : []),
    { label: "删除便签", icon: Trash2, run: onDelete, danger: true },
  ] as Array<{label:string;icon:typeof Plus;run:()=>void;active?:boolean;danger?:boolean;divider?:boolean}>);

  function select(action: () => void) {
    trigger?.focus();
    open = false;
    action();
  }
</script>

<div class="toolbar">
  <button bind:this={trigger} data-menu-trigger class="menu-trigger" type="button" aria-label="便签菜单"
    title="便签菜单" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}
    onkeydown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); open = true; } }}>
    <MoreHorizontal size={16} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="便签操作" tabindex="-1" use:popup={{ close: () => (open = false), trigger }} transition:reveal>
      {#if opacity !== undefined && onOpacityChange}
        <label class="opacity-row" title="也可以按住 Alt/Option 在标题栏滚动调节">
          <span>不透明度</span>
          <input type="range" min="0.6" max="1" step="0.02" value={opacity} aria-label="这张便签的不透明度"
            oninput={e => onOpacityChange(Number(e.currentTarget.value), false)}
            onchange={e => onOpacityChange(Number(e.currentTarget.value), true)} />
          <small>{Math.round(opacity * 100)}%</small>
        </label>
        <hr aria-hidden="true" />
      {/if}
      {#each actions as action}
        {#if action.divider}<hr aria-hidden="true" />{/if}
        <button type="button" role="menuitem" class:active={action.active} class:danger={action.danger}
          onclick={() => select(action.run)}>
          <action.icon size={15} />
          <span>{action.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .toolbar { display: flex; align-items: center; cursor: default; }
  button { border: 0; font: inherit; cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast); }
  button:hover { background: var(--pin-hover, var(--hover)); }
  button:active { transform: scale(0.96); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .menu-trigger { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; color: var(--pin-muted, var(--muted)); background: transparent; }
  .menu-trigger:hover { color: var(--pin-text, var(--text)); background: var(--pin-hover, var(--hover)); }
  .menu-trigger[aria-expanded="true"] { color: var(--pin-accent, var(--accent)); background: var(--pin-active, var(--accent-soft)); }
  .menu { position: fixed; z-index: 120; right: 8px; top: 43px; width: min(214px, calc(100vw - 16px)); max-height: calc(100vh - 51px); overflow: auto; padding: 5px; border: 0; border-radius: var(--radius-lg); color: var(--pin-text, var(--text)); background: color-mix(in srgb, var(--pin-bg, var(--surface-raised)) 80%, transparent); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur); box-shadow: var(--material-shadow); transform-origin: top right; }
  .menu button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 30px; padding: 5px 9px; border-radius: var(--radius-sm); text-align: left; font-size: 12px; color: inherit; background: transparent; }
  .menu button:hover { background: var(--pin-hover, var(--hover)); }
  .menu button.active { color: var(--pin-accent, var(--accent)); }
  .menu button.danger { color: var(--danger); }
  .menu hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--pin-border, var(--border)); }
  .menu button.danger:hover { background: var(--danger-soft); }
  .opacity-row { display: flex; align-items: center; gap: 7px; padding: 5px 9px; font-size: 11.5px; color: var(--pin-muted, var(--muted)); }
  .opacity-row span { flex: 0 0 auto; }
  .opacity-row input { flex: 1; min-width: 0; accent-color: var(--pin-accent, var(--accent)); cursor: pointer; }
  .opacity-row small { flex: 0 0 30px; text-align: right; font-size: 11px; font-variant-numeric: tabular-nums; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
