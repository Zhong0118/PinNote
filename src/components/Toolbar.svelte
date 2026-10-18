<script lang="ts">
  import { Code2, Download, EyeOff, LayoutTemplate, List, MoreHorizontal, Pin, Plus, Settings, Trash2 } from "lucide-svelte";
  import { popup, reveal } from "$lib/motion";

  type Props = {
    alwaysOnTop: boolean;
    sourceMode: boolean;
    onTogglePin: () => void;
    onToggleSource: () => void;
    onOpenNotes: () => void;
    onOpenTemplates: () => void;
    onExport: () => void;
    onOpenSettings: () => void;
    onDelete: () => void;
    onQuit: () => void;
    onNewNote?: () => void;
  };

  let { alwaysOnTop, sourceMode, onTogglePin, onToggleSource, onOpenNotes,
    onOpenTemplates, onExport, onOpenSettings, onDelete, onQuit, onNewNote }: Props = $props();
  let open = $state(false);
  let trigger: HTMLButtonElement;
  const actions = $derived([
    ...(onNewNote ? [{ label: "新建便签", icon: Plus, run: onNewNote }] : []),
    { label: alwaysOnTop ? "取消置顶" : "置顶", icon: Pin, run: onTogglePin, active: alwaysOnTop },
    { label: "所有便签", icon: List, run: onOpenNotes },
    { label: "模板", icon: LayoutTemplate, run: onOpenTemplates },
    { label: sourceMode ? "返回编辑" : "Markdown 源码", icon: Code2, run: onToggleSource, active: sourceMode },
    { label: "导出 Markdown", icon: Download, run: onExport },
    { label: "设置", icon: Settings, run: onOpenSettings },
    { label: "隐藏便签", icon: EyeOff, run: onQuit },
    { label: "删除便签", icon: Trash2, run: onDelete, danger: true },
  ]);

  function select(action: () => void) {
    trigger.focus();
    open = false;
    action();
  }
</script>

<div class="toolbar">
  <button bind:this={trigger} data-menu-trigger class="menu-trigger" type="button" aria-label="便签菜单"
    title="便签菜单" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}
    onkeydown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); open = true; } }}>
    <MoreHorizontal size={18} strokeWidth={1.8} />
  </button>
  {#if open}
    <div class="menu" role="menu" aria-label="便签操作" tabindex="-1" use:popup={() => (open = false)} transition:reveal>
      {#each actions as action}
        <button type="button" role="menuitem" class:active={action.active} class:danger={action.danger}
          onclick={() => select(action.run)}>
          <action.icon size={15} strokeWidth={1.7} />
          <span>{action.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .toolbar { display: flex; align-items: center; cursor: default; }
  button { border: 0; font: inherit; cursor: pointer; transition: background 140ms, color 140ms, transform 140ms; }
  button:hover { background: var(--pin-hover, #f3f4f6); }
  button:active { transform: scale(0.96); }
  button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
  .menu-trigger { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border-radius: 50%; color: var(--pin-text, #171717); background: var(--pin-hover, #f3f4f6); }
  .menu-trigger:hover, .menu-trigger[aria-expanded="true"] { color: var(--pin-accent, #2563eb); background: var(--pin-active, #eff6ff); transform: scale(1.04); }
  .menu { position: fixed; z-index: 120; right: 8px; top: 43px; width: min(206px, calc(100vw - 16px)); max-height: calc(100vh - 51px); overflow: auto; padding: 5px; border: 1px solid var(--pin-border, #e5e7eb); border-radius: 12px; color: var(--pin-text, #171717); background: var(--pin-bg, #fff); box-shadow: 0 8px 28px #00000014; transform-origin: top right; }
  .menu button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 31px; padding: 6px 9px; border-radius: 7px; text-align: left; font-size: 12px; color: inherit; background: transparent; }
  .menu button:hover { background: var(--pin-hover, #f3f4f6); }
  .menu button.active { color: var(--pin-accent, #2563eb); }
  .menu button.danger { color: #dc2626; }
  .menu button.danger:hover { background: #dc262610; }
  @media (prefers-reduced-motion: reduce) { button { transition: none; } }
</style>
