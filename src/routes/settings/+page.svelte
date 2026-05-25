<script lang="ts">
  import { emit } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { Palette, Rocket, Pin, SlidersHorizontal, Keyboard } from "lucide-svelte";
  import {
    defaultSettings,
    loadSettings,
    saveSettings,
    isMacPlatform,
    normalizeShortcut,
    platformDefaultShortcuts,
    shortcutIdentity,
    type AppSettings,
    type NoteTheme,
  } from "$lib/settings";
  import { createNote, loadNoteById, patchNoteNow, type PinNote } from "$lib/notesStore";

  const themes: Array<{ value: NoteTheme; label: string; color: string }> = [
    { value: "paper", label: "纸张", color: "#d7b87c" },
    { value: "mint", label: "薄荷", color: "#2d9c7c" },
    { value: "rose", label: "玫瑰", color: "#c56b79" },
    { value: "sky", label: "天空", color: "#5f8fcf" },
    { value: "grape", label: "葡萄", color: "#7b65b7" },
    { value: "ink", label: "深色", color: "#30363a" },
  ];

  const modKey = isMacPlatform() ? "Cmd" : "Ctrl";
  const inAppShortcuts = [
    { label: "导出 Markdown", key: `${modKey}+S` },
    { label: "切换置顶", key: `${modKey}+T` },
    { label: "切换源码模式", key: `${modKey}+/` },
    { label: "打开设置", key: `${modKey}+,` },
    { label: "加粗", key: `${modKey}+B` },
    { label: "斜体", key: `${modKey}+I` },
  ];

  let settings = $state<AppSettings>({ ...defaultSettings });
  let note = $state<PinNote>(createNote());
  let noteId = $state<string | undefined>();
  let noteReady = $state(false);
  let activeTab = $state<"appearance" | "behavior" | "shortcuts">("appearance");
  let recordingFor = $state<string | null>(null);
  let shortcutError = $state("");
  let autoStartStatus = $state("");
  let dataPath = $state("");
  let dataPathStatus = $state("");

  onMount(() => {
    noteId = new URLSearchParams(window.location.search).get("noteId") ?? undefined;
    loadSettings().then((next) => {
      settings = next;
      void refreshAutoStartState();
    });
    if (noteId) {
      loadNoteById(noteId).then(({ note: loaded }) => {
        if (loaded.id !== noteId) return;
        note = loaded;
        noteReady = true;
      });
    } else {
      noteReady = false;
      activeTab = "shortcuts";
    }
    void loadDataPath();
  });

  function patch(next: Partial<AppSettings>) {
    settings = { ...settings, ...next };
    broadcastSettings();
  }

  function patchNote(next: Partial<PinNote>) {
    if (!noteReady) return;
    const draft = { ...note, ...next, updatedAt: Date.now() };
    note = draft;
    void patchNoteNow(note.id, next).then((saved) => {
      note = saved;
      void emit("note-settings-changed", saved);
    });
  }

  function patchShortcut(key: string, value: string) {
    const normalized = normalizeShortcut(value);
    const identity = shortcutIdentity(normalized);
    if (
      Object.entries(settings.shortcuts).some(
        ([name, shortcut]) => name !== key && shortcutIdentity(shortcut) === identity,
      )
    ) {
      shortcutError = "这个快捷键已经被使用";
      return;
    }

    shortcutError = "";
    settings = {
      ...settings,
      shortcuts: { ...settings.shortcuts, [key]: normalized },
    };
    broadcastSettings();
  }

  function broadcastSettings() {
    void saveSettings(settings);
    void emit("settings-changed", settings);
  }

  async function handleAutoStartChange(value: boolean) {
    try {
      if (value) await enable();
      else await disable();
      const enabled = await isEnabled();
      patch({ autoStart: enabled });
      autoStartStatus = enabled === value ? "开机自启设置已更新" : "系统启动项状态与设置不一致";
    } catch {
      const enabled = await readAutoStartState(settings.autoStart);
      settings = { ...settings, autoStart: enabled };
      autoStartStatus = "开机自启设置失败，请使用安装版运行后重试";
      void saveSettings(settings);
      return;
    }
  }

  async function refreshAutoStartState() {
    const enabled = await readAutoStartState(settings.autoStart);
    if (enabled !== settings.autoStart) {
      settings = { ...settings, autoStart: enabled };
      void saveSettings(settings);
    }
  }

  async function readAutoStartState(fallback: boolean) {
    try {
      return await isEnabled();
    } catch {
      return fallback;
    }
  }

  async function openDataDirectory() {
    try {
      const path = await ensureDataPath();
      const notesPath = await invoke<string>("app_data_file_path", { name: "notes.json" });

      try {
        await revealItemInDir(notesPath);
        dataPathStatus = "已在文件管理器中定位 notes.json";
        return;
      } catch {
        await openPath(path);
        dataPathStatus = "已打开数据目录";
      }
    } catch {
      dataPathStatus = "无法打开数据目录，已显示路径";
    }
  }

  async function copyDataPath() {
    try {
      const path = await ensureDataPath();
      await navigator.clipboard.writeText(path);
      dataPathStatus = "已复制数据目录路径";
    } catch {
      dataPathStatus = "无法复制路径，请手动选择复制";
    }
  }

  async function loadDataPath() {
    try {
      dataPath = await invoke<string>("app_data_path");
    } catch {
      dataPath = "";
    }
  }

  async function ensureDataPath() {
    if (dataPath) return dataPath;
    dataPath = await invoke<string>("app_data_path");
    return dataPath;
  }

  function handleShortcutKeydown(event: KeyboardEvent) {
    if (!recordingFor) return;
    event.preventDefault();
    event.stopPropagation();

    // Ignore lone modifier keys
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;

    const parts: string[] = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push(isMacPlatform() ? "Option" : "Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Cmd");

    // Need at least one modifier
    if (parts.length === 0) {
      shortcutError = isMacPlatform() ? "请至少包含 Ctrl、Option、Shift 或 Cmd" : "请至少包含 Ctrl、Alt 或 Shift";
      return;
    }

    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
    patchShortcut(recordingFor, parts.join("+"));
    recordingFor = null;
  }

  function resetShortcut(key: string) {
    patchShortcut(key, platformDefaultShortcuts()[key as keyof ReturnType<typeof platformDefaultShortcuts>]);
  }
</script>

<svelte:window onkeydown={handleShortcutKeydown} />

<div class="settings-window">
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
        {#if !noteReady}
          <p class="hint">请从某张便签窗口打开设置来修改外观</p>
        {/if}
        <label class="field">
          <span class="label-with-icon"><SlidersHorizontal size={14} /> 透明度</span>
          <input
            type="range"
            min="0.72"
            max="1"
            step="0.01"
            value={note.opacity}
            disabled={!noteReady}
            oninput={(e) => patchNote({ opacity: Number(e.currentTarget.value) })}
          />
        </label>

        <div class="field">
          <span class="label-with-icon"><Palette size={14} /> 背景颜色</span>
          <div class="color-grid">
            {#each themes as theme}
              <button
                class="swatch"
                class:active={note.theme === theme.value}
                type="button"
                title={theme.label}
                style:--swatch={theme.color}
                disabled={!noteReady}
                onclick={() => patchNote({ theme: theme.value })}
              ></button>
            {/each}
            <label
              class="swatch custom-swatch"
              class:active={note.theme === "custom"}
              title="自定义颜色"
              style:--swatch={note.customColor}
            >
              <input
                type="color"
                value={note.customColor}
                disabled={!noteReady}
                oninput={(e) =>
                  patchNote({ theme: "custom", customColor: e.currentTarget.value })}
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
        {#if autoStartStatus}
          <p class="hint">{autoStartStatus}</p>
        {/if}

        <label class="switch-row">
          <span class="label-with-icon"><Pin size={14} /> 窗口置顶</span>
          <input
            type="checkbox"
            checked={note.alwaysOnTop}
            disabled={!noteReady}
            onchange={(e) => patchNote({ alwaysOnTop: e.currentTarget.checked })}
          />
        </label>

        <div class="action-row">
          <span>
            <strong>用户数据</strong>
            <small>notes.json / settings.json / templates.json</small>
          </span>
          <div class="action-buttons">
            <button type="button" onclick={openDataDirectory}>打开目录</button>
            <button type="button" onclick={copyDataPath}>复制路径</button>
          </div>
        </div>
        {#if dataPath}
          <p class="path-line" title={dataPath}>{dataPath}</p>
        {/if}
        {#if dataPathStatus}
          <p class="hint">{dataPathStatus}</p>
        {/if}
      </div>

    {:else if activeTab === "shortcuts"}
      <div class="section">
        <h3>全局快捷键</h3>
        <p class="hint">在任何应用中都可触发，点击可修改</p>
        {#if shortcutError}
          <p class="error">{shortcutError}</p>
        {/if}
        <div class="shortcut-list">
          <div class="shortcut-row">
            <span>显示/隐藏全部便签</span>
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

  .error {
    margin: -6px 0 2px;
    color: #a84332;
    font-size: 12px;
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

  .action-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 38px;
    color: #555;
    font-size: 13px;
  }

  .action-row span {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .action-row strong {
    color: #555;
    font-size: 13px;
  }

  .action-row small {
    overflow: hidden;
    color: #999;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .action-buttons button {
    border: 1px solid #d0cdc6;
    border-radius: 5px;
    padding: 5px 10px;
    color: #333;
    background: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .action-buttons button:hover {
    border-color: #2d7d74;
    color: #2d7d74;
  }

  .path-line {
    overflow: hidden;
    margin: -10px 0 0;
    border: 1px solid #e3dfd7;
    border-radius: 5px;
    padding: 6px 8px;
    color: #666;
    background: #fff;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
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
