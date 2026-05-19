<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { disable, enable } from "@tauri-apps/plugin-autostart";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import MilkdownEditor from "../components/MilkdownEditor.svelte";
  import SourceEditor from "../components/SourceEditor.svelte";
  import WindowChrome from "../components/WindowChrome.svelte";
  import { defaultContent, defaultTitle } from "$lib/defaultNote";
  import { defaultMarkdownFilename } from "$lib/filename";
  import { loadSettings, saveSettings, type AppSettings } from "$lib/settings";

  let title = $state(defaultTitle);
  let content = $state(defaultContent);
  let sourceMode = $state(false);
  let settingsOpen = $state(false);
  let settings = $state<AppSettings>(loadSettings());
  let status = $state("临时便签，不会自动保存正文");

  $effect(() => {
    void setPin(settings.alwaysOnTop);
    saveSettings(settings);
  });

  function updateTitle(value: string) {
    title = value;
    status = "标题仅用于导出文件名";
  }

  function updateContent(value: string) {
    content = value;
    status = "未保存";
  }

  function updateSettings(next: AppSettings) {
    if (next.autoStart !== settings.autoStart) {
      void syncAutoStart(next.autoStart);
    }

    settings = next;
    status = "设置已保存";
  }

  async function syncAutoStart(value: boolean) {
    try {
      if (value) {
        await enable();
      } else {
        await disable();
      }
    } catch {
      status = "开机自启需要安装 autostart 插件";
    }
  }

  async function setPin(value: boolean) {
    try {
      await getCurrentWindow().setAlwaysOnTop(value);
    } catch {
      // Browser preview cannot control a native window.
    }
  }

  function togglePin() {
    updateSettings({ ...settings, alwaysOnTop: !settings.alwaysOnTop });
  }

  async function exportMarkdown() {
    const defaultPath = defaultMarkdownFilename(title);

    try {
      const path = await save({
        title: "导出 Markdown",
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });

      if (!path) {
        status = "已取消导出";
        return;
      }

      const target = path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
      await invoke("write_markdown_file", {
        path: target,
        content,
      });
      status = `已导出 ${target.split(/[\\/]/).at(-1)}`;
    } catch {
      status = "导出失败，请确认 dialog 插件已安装";
    }
  }

  async function quitApp() {
    try {
      await invoke("quit_app");
    } catch {
      window.close();
    }
  }

  async function startDrag(event: PointerEvent) {
    if (event.button !== 0 || isInteractiveElement(event.target)) return;

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Browser preview cannot drag a native window.
    }
  }

  async function startResize(event: PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    try {
      await getCurrentWindow().startResizeDragging("SouthEast" as never);
    } catch {
      status = "浏览器预览模式不能调整原生窗口大小";
    }
  }

  function isInteractiveElement(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("button, input, textarea, a"));
  }
</script>

<svelte:head>
  <meta name="description" content="PinNote Markdown sticky note" />
</svelte:head>

<WindowChrome
  {title}
  {status}
  {sourceMode}
  {settings}
  {settingsOpen}
  onTitleChange={updateTitle}
  onTogglePin={togglePin}
  onToggleSource={() => (sourceMode = !sourceMode)}
  onExport={exportMarkdown}
  onToggleSettings={() => (settingsOpen = !settingsOpen)}
  onSettingsChange={updateSettings}
  onQuit={quitApp}
  onStartDrag={startDrag}
  onStartResize={startResize}
>
  {#if sourceMode}
    <SourceEditor value={content} onChange={updateContent} />
  {:else}
    <MilkdownEditor value={content} onChange={updateContent} />
  {/if}
</WindowChrome>
