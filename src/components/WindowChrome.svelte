<script lang="ts">
  import SettingsPanel from "./SettingsPanel.svelte";
  import Toolbar from "./Toolbar.svelte";
  import type { AppSettings } from "$lib/settings";

  type Props = {
    title: string;
    status: string;
    sourceMode: boolean;
    settings: AppSettings;
    settingsOpen: boolean;
    onTitleChange: (title: string) => void;
    onTogglePin: () => void;
    onToggleSource: () => void;
    onExport: () => void;
    onToggleSettings: () => void;
    onSettingsChange: (settings: AppSettings) => void;
    onQuit: () => void;
    onStartDrag: (event: PointerEvent) => void;
    onStartResize: (event: PointerEvent) => void;
    children: import("svelte").Snippet;
  };

  let {
    title,
    status,
    sourceMode,
    settings,
    settingsOpen,
    onTitleChange,
    onTogglePin,
    onToggleSource,
    onExport,
    onToggleSettings,
    onSettingsChange,
    onQuit,
    onStartDrag,
    onStartResize,
    children,
  }: Props = $props();
</script>

<main
  class="window-shell theme-{settings.theme}"
  style:--pin-opacity={settings.opacity}
  style:--pin-custom={settings.customColor}
>
  <section class="note-window" aria-label="PinNote Markdown 便签">
    <header class="dragbar" role="presentation" data-tauri-drag-region onpointerdown={onStartDrag}>
      <div class="title-cluster" data-tauri-drag-region>
        <span class="brand-mark"></span>
        <input
          class="title-input"
          aria-label="便签标题"
          value={title}
          oninput={(event) => onTitleChange(event.currentTarget.value)}
        />
      </div>

      <Toolbar
        alwaysOnTop={settings.alwaysOnTop}
        {sourceMode}
        {settingsOpen}
        onTogglePin={onTogglePin}
        onToggleSource={onToggleSource}
        onExport={onExport}
        onToggleSettings={onToggleSettings}
        onQuit={onQuit}
      />
    </header>

    <div class="status-line" data-tauri-drag-region>
      <span>{sourceMode ? "Markdown source" : "Milkdown"}</span>
      <span>{status}</span>
    </div>

    {#if settingsOpen}
      <SettingsPanel {settings} onChange={onSettingsChange} />
    {/if}

    <div class="editor-frame">
      {@render children()}
    </div>

    <button
      class="resize-grip"
      type="button"
      aria-label="调整窗口大小"
      onpointerdown={onStartResize}
    ></button>
  </section>
</main>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    width: 100%;
    height: 100%;
    margin: 0;
  }

  :global(body) {
    overflow: hidden;
    color: var(--pin-text);
    background: transparent;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.55;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
  }

  button,
  input {
    font: inherit;
  }

  :global([data-tauri-drag-region]) {
    cursor: grab;
  }

  :global([data-tauri-drag-region]:active) {
    cursor: grabbing;
  }

  :global([data-tauri-drag-region] *) {
    cursor: inherit;
  }

  :global(button),
  :global(input),
  :global(textarea),
  :global(a) {
    cursor: auto;
  }

  .window-shell {
    --pin-opacity: 0.96;
    --pin-page: #e7e3d8;
    --pin-bg: #fbfaf4;
    --pin-header: #fffdf6;
    --pin-text: #20231f;
    --pin-heading: #171a16;
    --pin-muted: #777b72;
    --pin-border: rgba(49, 43, 35, 0.16);
    --pin-accent: #2d7d74;
    --pin-accent-strong: #155951;

    width: 100vw;
    height: 100vh;
    padding: 8px;
    background: transparent;
  }

  .theme-mint {
    --pin-page: #dfe9e4;
    --pin-bg: #f5fbf8;
    --pin-header: #f8fffb;
    --pin-border: rgba(31, 87, 72, 0.16);
    --pin-accent: #1f8a6d;
    --pin-accent-strong: #12604c;
  }

  .theme-rose {
    --pin-page: #eadfe0;
    --pin-bg: #fff8f7;
    --pin-header: #fffafa;
    --pin-border: rgba(120, 53, 62, 0.16);
    --pin-accent: #b05b68;
    --pin-accent-strong: #853945;
  }

  .theme-ink {
    --pin-page: #252a2d;
    --pin-bg: #30363a;
    --pin-header: #363d41;
    --pin-text: #eef2ee;
    --pin-heading: #ffffff;
    --pin-muted: #b8c0b9;
    --pin-border: rgba(255, 255, 255, 0.14);
    --pin-accent: #8bc9bd;
    --pin-accent-strong: #b8eee5;
  }

  .theme-sky {
    --pin-page: #dde6ef;
    --pin-bg: #f6fbff;
    --pin-header: #fbfdff;
    --pin-border: rgba(46, 80, 120, 0.16);
    --pin-accent: #5f8fcf;
    --pin-accent-strong: #2f5f9f;
  }

  .theme-grape {
    --pin-page: #e6e0ed;
    --pin-bg: #fbf8ff;
    --pin-header: #fdfaff;
    --pin-border: rgba(85, 65, 130, 0.16);
    --pin-accent: #7b65b7;
    --pin-accent-strong: #58408e;
  }

  .theme-custom {
    --pin-page: color-mix(in srgb, var(--pin-custom), white 74%);
    --pin-bg: color-mix(in srgb, var(--pin-custom), white 92%);
    --pin-header: color-mix(in srgb, var(--pin-custom), white 96%);
    --pin-border: color-mix(in srgb, var(--pin-custom), transparent 76%);
    --pin-accent: var(--pin-custom);
    --pin-accent-strong: color-mix(in srgb, var(--pin-custom), #111 28%);
  }

  .note-window {
    position: relative;
    display: grid;
    grid-template-rows: 44px 24px minmax(0, 1fr);
    width: 100%;
    height: 100%;
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid var(--pin-border);
    background: color-mix(in srgb, var(--pin-bg) calc(var(--pin-opacity) * 100%), transparent);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.56),
      0 16px 42px rgba(16, 18, 15, 0.16);
  }

  .dragbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 7px 10px 6px 14px;
    border-bottom: 1px solid color-mix(in srgb, var(--pin-border), transparent 24%);
    background: color-mix(in srgb, var(--pin-header) calc(var(--pin-opacity) * 100%), transparent);
    user-select: none;
    cursor: grab;
    -webkit-app-region: drag;
  }

  .dragbar:active {
    cursor: grabbing;
  }

  .title-cluster {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 9px;
  }

  .brand-mark {
    width: 8px;
    height: 22px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: linear-gradient(180deg, var(--pin-accent), color-mix(in srgb, var(--pin-accent), #111 22%));
  }

  .title-input {
    min-width: 0;
    width: 100%;
    border: 0;
    outline: 0;
    color: var(--pin-heading);
    background: transparent;
    font-size: 15px;
    font-weight: 800;
    cursor: text;
    -webkit-app-region: no-drag;
  }

  .status-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    color: var(--pin-muted);
    background: color-mix(in srgb, var(--pin-bg), var(--pin-page) 18%);
    font-size: 11px;
    line-height: 24px;
    user-select: none;
    cursor: grab;
    -webkit-app-region: drag;
  }

  .status-line:active {
    cursor: grabbing;
  }

  .editor-frame {
    min-height: 0;
    overflow: hidden;
  }

  .resize-grip {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 10;
    width: 42px;
    height: 42px;
    border: 0;
    border-bottom-right-radius: 20px;
    background:
      linear-gradient(135deg, transparent 0 58%, color-mix(in srgb, var(--pin-text), transparent 72%) 59% 63%, transparent 64%),
      linear-gradient(135deg, transparent 0 72%, color-mix(in srgb, var(--pin-text), transparent 62%) 73% 77%, transparent 78%);
    cursor: nwse-resize;
    -webkit-app-region: no-drag;
  }

  :global(::-webkit-scrollbar) {
    width: 9px;
    height: 9px;
  }

  :global(::-webkit-scrollbar-track) {
    background: transparent;
  }

  :global(::-webkit-scrollbar-thumb) {
    border: 2px solid transparent;
    border-radius: 999px;
    background-clip: content-box;
    background-color: color-mix(in srgb, var(--pin-text), transparent 78%);
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background-color: color-mix(in srgb, var(--pin-text), transparent 64%);
  }
</style>
