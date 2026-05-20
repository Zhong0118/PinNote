<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { disable, enable } from "@tauri-apps/plugin-autostart";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import MilkdownEditor from "../components/MilkdownEditor.svelte";
  import SourceEditor from "../components/SourceEditor.svelte";
  import WindowChrome from "../components/WindowChrome.svelte";
  import { defaultContent, defaultTitle } from "$lib/defaultNote";
  import { defaultMarkdownFilename } from "$lib/filename";
  import { loadNote, saveNote } from "$lib/noteStore";
  import { loadSettings, saveSettings, type AppSettings } from "$lib/settings";
  import { registerGlobalShortcuts, unregisterGlobalShortcuts, toggleWindowVisibility } from "$lib/shortcuts";
  import { openSettingsWindow } from "$lib/settingsWindow";

  let title = $state(defaultTitle);
  let content = $state(defaultContent);
  let sourceMode = $state(false);
  let settings = $state<AppSettings>(loadSettings());
  let status = $state("正在加载…");
  let ready = $state(false);

  onMount(() => {
    loadNote().then((note) => {
      title = note.title;
      content = note.content;
      status = "已就绪";
      ready = true;
    });

    // Register global shortcuts
    registerGlobalShortcuts(settings.shortcuts, {
      toggleWindow: () => toggleWindowVisibility(),
      newNote: () => resetNote(),
    });

    // Listen for settings changes from the settings window
    const unlistenPromise = listen<AppSettings>("settings-changed", (event) => {
      const next = event.payload;
      if (next.autoStart !== settings.autoStart) {
        void syncAutoStart(next.autoStart);
      }
      settings = next;
      // Re-register global shortcuts with new bindings
      registerGlobalShortcuts(settings.shortcuts, {
        toggleWindow: () => toggleWindowVisibility(),
        newNote: () => resetNote(),
      });
      status = "设置已同步";
    });

    return () => {
      unregisterGlobalShortcuts();
      unlistenPromise.then((fn) => fn());
    };
  });

  $effect(() => {
    void setPin(settings.alwaysOnTop);
    saveSettings(settings);
  });

  function resetNote() {
    title = defaultTitle;
    content = defaultContent;
    saveNote({ title, content });
    status = "已新建便签";
  }

  function updateTitle(value: string) {
    title = value;
    saveNote({ title, content });
    status = "已自动保存";
  }

  function updateContent(value: string) {
    content = value;
    saveNote({ title, content });
    status = "已自动保存";
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
    settings = { ...settings, alwaysOnTop: !settings.alwaysOnTop };
    status = settings.alwaysOnTop ? "已置顶" : "已取消置顶";
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

  function handleKeydown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key === "s") {
      event.preventDefault();
      exportMarkdown();
    } else if (mod && event.key === "t") {
      event.preventDefault();
      togglePin();
    } else if (mod && event.key === ",") {
      event.preventDefault();
      openSettingsWindow();
    } else if (event.ctrlKey && event.key === "/") {
      event.preventDefault();
      sourceMode = !sourceMode;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <meta name="description" content="PinNote Markdown sticky note" />
</svelte:head>

<WindowChrome
  {title}
  {status}
  {sourceMode}
  {settings}
  onTitleChange={updateTitle}
  onTogglePin={togglePin}
  onToggleSource={() => (sourceMode = !sourceMode)}
  onExport={exportMarkdown}
  onOpenSettings={openSettingsWindow}
  onQuit={quitApp}
  onStartDrag={startDrag}
  onStartResize={startResize}
>
  {#if ready}
    {#if sourceMode}
      <SourceEditor value={content} onChange={updateContent} />
    {:else}
      <MilkdownEditor value={content} onChange={updateContent} />
    {/if}
  {/if}
</WindowChrome>
