<script lang="ts">
  import { Code2, Download, Pin, PinOff, Power, Settings } from "lucide-svelte";

  type Props = {
    alwaysOnTop: boolean;
    sourceMode: boolean;
    onTogglePin: () => void;
    onToggleSource: () => void;
    onExport: () => void;
    onOpenSettings: () => void;
    onQuit: () => void;
  };

  let {
    alwaysOnTop,
    sourceMode,
    onTogglePin,
    onToggleSource,
    onExport,
    onOpenSettings,
    onQuit,
  }: Props = $props();
</script>

<nav class="tool-strip" aria-label="便签工具">
  <button
    class:active={alwaysOnTop}
    type="button"
    title={alwaysOnTop ? "取消置顶" : "置顶"}
    aria-label={alwaysOnTop ? "取消置顶" : "置顶"}
    onclick={onTogglePin}
  >
    {#if alwaysOnTop}
      <Pin size={16} strokeWidth={2.1} />
    {:else}
      <PinOff size={16} strokeWidth={2.1} />
    {/if}
  </button>
  <button
    class:active={sourceMode}
    type="button"
    title="Markdown 源码"
    aria-label="Markdown 源码"
    onclick={onToggleSource}
  >
    <Code2 size={16} strokeWidth={2.1} />
  </button>
  <button type="button" title="导出 Markdown" aria-label="导出 Markdown" onclick={onExport}>
    <Download size={16} strokeWidth={2.1} />
  </button>
  <button
    type="button"
    title="设置 (Ctrl+,)"
    aria-label="设置"
    onclick={onOpenSettings}
  >
    <Settings size={16} strokeWidth={2.1} />
  </button>
  <button class="danger" type="button" title="退出应用" aria-label="退出应用" onclick={onQuit}>
    <Power size={16} strokeWidth={2.1} />
  </button>
</nav>

<style>
  .tool-strip {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  button {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 0;
    color: color-mix(in srgb, var(--pin-text), transparent 28%);
    background: transparent;
    cursor: pointer;
  }

  button:hover,
  button.active {
    border-color: color-mix(in srgb, var(--pin-accent), transparent 72%);
    color: var(--pin-accent-strong);
    background: color-mix(in srgb, var(--pin-accent), transparent 88%);
  }

  button.danger:hover {
    border-color: rgba(168, 67, 50, 0.26);
    color: #933626;
    background: rgba(168, 67, 50, 0.08);
  }
</style>
