<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { disable, enable } from "@tauri-apps/plugin-autostart";
  import { Palette, Rocket, Pin, SlidersHorizontal, Keyboard } from "lucide-svelte";
  import {
    loadSettings,
    saveSettings,
    defaultShortcuts,
    type AppSettings,
    type NoteTheme,
  } from "$lib/settings";

  const themes: Array<{ value: NoteTheme; label: string; color: string }> = [
    { value: "paper", label: "纸张", color: "#d7b87c" },
    { value: "mint", label: "薄荷", color: "#2d9c7c" },
    { value: "rose", label: "玫瑰", color: "#c56b79" },
    { value: "sky", label: "天空", color: "#5f8fcf" },
    { value: "grape", label: "葡萄", color: "#7b65b7" },
    { value: "ink", label: "深色", color: "#30363a" },
  ];

  const inAppShortcuts = [
    { label: "导出 Markdown", key: "Ctrl+S" },
    { label: "切换置顶", key: "Ctrl+T" },
    { label: "切换源码模式", key: "Ctrl+/" },
    { label: "打开设置", key: "Ctrl+," },
    { label: "加粗", key: "Ctrl+B" },
    { label: "斜体", key: "Ctrl+I" },
  ];

  let settings = $state<AppSettings>(loadSettings());
  let activeTab = $state<"appearance" | "behavior" | "shortcuts">("appearance");
  let recordingFor = $state<string | null>(null);

  function patch(next: Partial<AppSettings>) {
    settings = { ...settings, ...next };
    broadcastSettings();
  }

  function patchShortcut(key: string, value: string) {
    settings = {
      ...settings,
      shortcuts: { ...settings.shortcuts, [key]: value },
    };
    broadcastSettings();
  }

  function broadcastSettings() {
    saveSettings(settings);
    emit("settings-changed", settings);
  }

  async function handleAutoStartChange(value: boolean) {
    try {
      if (value) await enable();
      else await disable();
    } catch {
      // Ignore
    }
    patch({ autoStart: value });
  }

  function handleShortcutKeydown(event: KeyboardEvent) {
    if (!recordingFor) return;
    event.preventDefault();
    event.stopPropagation();

    // Ignore lone modifier keys
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Cmd");

    // Need at least one modifier
    if (parts.length === 0) return;

    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    patchShortcut(recordingFor, parts.join("+"));
    recordingFor = null;
  }

  function resetShortcut(key: string) {
    patchShortcut(key, defaultShortcuts[key as keyof typeof defaultShortcuts]);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="settings-window" onkeydown={handleShortcutKeydown}>
  <nav class="tab-bar">
    <button
      class:active={activeTab === "appearance"}
      onclick={() => (activeTab = "appearance")}
    >
      <Palette size={14} /> 外观
    </button>
    <button
      class:active={activeTab === "behavior"}
      onclick={() => (activeTab = "behavior")}
    >
      <Rocket size={14} /> 行为
    </button>
    <button
      class:active={activeTab === "shortcuts"}
      onclick={() => (activeTab = "shortcuts")}
    >
      <Keyboard size={14} /> 快捷键
    </button>
  </nav>

  <div class="tab-content">
    {#if activeTab === "appearance"}
      <div class="section">
        <label class="field">
          <span class="label-with-icon"><SlidersHorizontal size={14} /> 透明度</span>
          <input
            type="range"
            min="0.72"
            max="1"
            step="0.01"
            value={settings.opacity}
            oninput={(e) => patch({ opacity: Number(e.currentTarget.value) })}
          />
        </label>

        <div class="field">
          <span class="label-with-icon"><Palette size={14} /> 背景颜色</span>
          <div class="color-grid">
            {#each themes as theme}
              <button
                class="swatch"
                class:active={settings.theme === theme.value}
                type="button"
                title={theme.label}
                style:--swatch={theme.color}
                onclick={() => patch({ theme: theme.value })}
              ></button>
            {/each}
            <label
              class="swatch custom-swatch"
              class:active={settings.theme === "custom"}
              title="自定义颜色"
              style:--swatch={settings.customColor}
            >
              <input
                type="color"
                value={settings.customColor}
                oninput={(e) =>
                  patch({ theme: "custom", customColor: e.currentTarget.value })}
              />
            </label>
          </div>
        </div>
      </div>

    {:else if activeTab === "behavior"}
      <div class="section">
        <label class="switch-row">
          <span class="label-with-icon"><Rocket size={14} /> 开机自启</span>
          <input
            type="checkbox"
            checked={settings.autoStart}
            onchange={(e) => handleAutoStartChange(e.currentTarget.checked)}
          />
        </label>

        <label class="switch-row">
          <span class="label-with-icon"><Pin size={14} /> 窗口置顶</span>
          <input
            type="checkbox"
            checked={settings.alwaysOnTop}
            onchange={(e) => patch({ alwaysOnTop: e.currentTarget.checked })}
          />
        </label>
      </div>

    {:else if activeTab === "shortcuts"}
      <div class="section">
        <h3>全局快捷键</h3>
        <p class="hint">在任何应用中都可触发，点击可修改</p>
        <div class="shortcut-list">
          <div class="shortcut-row">
            <span>显示/隐藏窗口</span>
            <button
              class="key-badge"
              class:recording={recordingFor === "toggleWindow"}
              onclick={() => (recordingFor = "toggleWindow")}
            >
              {recordingFor === "toggleWindow" ? "按下新快捷键…" : settings.shortcuts.toggleWindow}
            </button>
            <button class="reset-btn" title="恢复默认" onclick={() => resetShortcut("toggleWindow")}>
              重置
            </button>
          </div>
          <div class="shortcut-row">
            <span>新建便签</span>
            <button
              class="key-badge"
              class:recording={recordingFor === "newNote"}
              onclick={() => (recordingFor = "newNote")}
            >
              {recordingFor === "newNote" ? "按下新快捷键…" : settings.shortcuts.newNote}
            </button>
            <button class="reset-btn" title="恢复默认" onclick={() => resetShortcut("newNote")}>
              重置
            </button>
          </div>
        </div>

        <h3>应用内快捷键</h3>
        <p class="hint">仅在 PinNote 窗口聚焦时生效</p>
        <div class="shortcut-list">
          {#each inAppShortcuts as shortcut}
            <div class="shortcut-row">
              <span>{shortcut.label}</span>
              <span class="key-badge readonly">{shortcut.key}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI",
      "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.55;
    background: #f8f7f4;
    color: #20231f;
    -webkit-font-smoothing: antialiased;
  }

  .settings-window {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .tab-bar {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #e0ddd6;
    background: #f0eeea;
    padding: 0 12px;
    flex-shrink: 0;
  }

  .tab-bar button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: #777b72;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: 0.15s ease;
  }

  .tab-bar button:hover {
    color: #20231f;
  }

  .tab-bar button.active {
    color: #2d7d74;
    border-bottom-color: #2d7d74;
  }

  .tab-content {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  h3 {
    margin: 8px 0 0;
    font-size: 13px;
    font-weight: 800;
    color: #171a16;
  }

  h3:first-child {
    margin-top: 0;
  }

  .hint {
    margin: -8px 0 4px;
    font-size: 12px;
    color: #999;
  }

  .field {
    display: grid;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #555;
  }

  .switch-row {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    min-height: 36px;
    font-size: 13px;
    font-weight: 600;
    color: #555;
  }

  .label-with-icon {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }

  input[type="checkbox"] {
    width: 38px;
    height: 22px;
    margin: 0;
    appearance: none;
    border: 1px solid #d0cdc6;
    border-radius: 999px;
    background: #ddd;
    cursor: pointer;
    transition: 0.16s ease;
  }

  input[type="checkbox"]::before {
    content: "";
    display: block;
    width: 16px;
    height: 16px;
    margin: 2px;
    border-radius: 999px;
    background: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    transition: 0.16s ease;
  }

  input[type="checkbox"]:checked {
    border-color: #2d7d74;
    background: #2d7d74;
  }

  input[type="checkbox"]:checked::before {
    transform: translateX(16px);
  }

  input[type="range"] {
    width: 100%;
    height: 24px;
    margin: 0;
    accent-color: #2d7d74;
    cursor: pointer;
  }

  .color-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
  }

  .swatch {
    position: relative;
    display: block;
    width: 30px;
    height: 30px;
    border: 2px solid transparent;
    border-radius: 999px;
    padding: 0;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  .swatch.active {
    border-color: #155951;
  }

  .custom-swatch {
    overflow: hidden;
  }

  .custom-swatch input {
    position: absolute;
    inset: -8px;
    width: 46px;
    height: 46px;
    opacity: 0;
    cursor: pointer;
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 32px;
    font-size: 13px;
  }

  .shortcut-row > span:first-child {
    flex: 1;
    color: #555;
  }

  .key-badge {
    display: inline-block;
    padding: 3px 10px;
    border: 1px solid #d0cdc6;
    border-radius: 5px;
    background: #fff;
    font-size: 12px;
    font-weight: 600;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    color: #333;
    cursor: pointer;
    min-width: 80px;
    text-align: center;
    transition: 0.15s ease;
  }

  .key-badge:hover {
    border-color: #2d7d74;
    color: #2d7d74;
  }

  .key-badge.recording {
    border-color: #2d7d74;
    background: #f0faf8;
    color: #2d7d74;
    animation: pulse 1s ease infinite;
  }

  .key-badge.readonly {
    cursor: default;
    opacity: 0.7;
  }

  .key-badge.readonly:hover {
    border-color: #d0cdc6;
    color: #333;
  }

  .reset-btn {
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font-size: 11px;
    color: #999;
    cursor: pointer;
  }

  .reset-btn:hover {
    border-color: #d0cdc6;
    color: #555;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
</style>
