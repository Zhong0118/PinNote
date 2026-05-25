<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { listen } from "@tauri-apps/api/event";
  import { onMount } from "svelte";
  import MilkdownEditor from "../components/MilkdownEditor.svelte";
  import SourceEditor from "../components/SourceEditor.svelte";
  import TemplateDialog from "../components/TemplateDialog.svelte";
  import WindowChrome from "../components/WindowChrome.svelte";
  import { defaultMarkdownFilename } from "$lib/filename";
  import {
    defaultSettings,
    loadSettings,
    normalizeShortcut,
    saveSettings,
    type AppSettings,
  } from "$lib/settings";
  import { registerGlobalShortcuts, unregisterGlobalShortcuts } from "$lib/shortcuts";
  import { openSettingsWindow } from "$lib/settingsWindow";
  import type { NoteTemplate } from "$lib/templates";
  import {
    createNote,
    deleteNoteNow,
    flushNoteSave,
    getRecentNote,
    loadNoteById,
    markNoteActive,
    markNoteClosed,
    saveNoteNow,
    scheduleNoteSave,
    type PinNote,
  } from "$lib/notesStore";
  import { noteWindowLabel, openNoteWindow } from "$lib/noteWindows";

  let note = $state<PinNote>(createNote());
  let sourceMode = $state(false);
  let globalSettings = $state<AppSettings>({ ...defaultSettings });
  let status = $state("正在加载…");
  let ready = $state(false);
  let settingsReady = $state(false);
  let editorRevision = $state(0);
  let registeredShortcuts = $state("");
  let templatesOpen = $state(false);
  let isMainWindow = false;

  const noteSettings = $derived({
    alwaysOnTop: note.alwaysOnTop,
    opacity: note.opacity,
    theme: note.theme,
    customColor: note.customColor,
  });

  onMount(() => {
    const win = getCurrentWindow();
    isMainWindow = win.label === "main";
    const requestedNoteId = new URLSearchParams(window.location.search).get("noteId") ?? undefined;

    loadNoteById(requestedNoteId).then(async ({ note: loaded }) => {
      note = loaded;
      status = "已就绪";
      ready = true;
      await applyNativeWindowState();
      void markNoteActive(note);
    });

    loadSettings().then((next) => {
      globalSettings = next;
      settingsReady = true;
      if (isMainWindow) void registerShortcuts();
    });

    const settingsPromise = listen<AppSettings>("settings-changed", (event) => {
      const next = event.payload;
      if (next.autoStart !== globalSettings.autoStart) {
        void syncAutoStart(next.autoStart);
      }
      const shortcutsChanged =
        shortcutSignature(next.shortcuts) !== shortcutSignature(globalSettings.shortcuts);
      globalSettings = next;
      if (isMainWindow && shortcutsChanged) {
        void registerShortcuts();
      }
      status = "设置已同步";
    });

    const noteSettingsPromise = listen<PinNote>("note-settings-changed", (event) => {
      if (event.payload.id !== note.id) return;
      note = { ...note, ...event.payload };
      void applyNativeWindowState();
      scheduleNoteSave(note);
      status = "便签设置已同步";
    });

    const newNotePromise = isMainWindow
      ? listen("new-note-requested", () => {
          void createNewNoteWindow();
        })
      : Promise.resolve(() => {});

    const openSettingsPromise = isMainWindow
      ? listen("open-settings-requested", () => {
          void openRecentSettings();
        })
      : Promise.resolve(() => {});

    const showLastNotePromise = isMainWindow
      ? listen("show-last-note-requested", () => {
          void showLastNoteWindow();
        })
      : Promise.resolve(() => {});

    const movedPromise = win.onMoved(() => {
      void captureWindowState();
    });
    const resizedPromise = win.onResized(() => {
      void captureWindowState();
    });
    const focusPromise = win.onFocusChanged(({ payload }) => {
      if (payload) void markNoteActive(note);
    });
    const closePromise = win.onCloseRequested(async (event) => {
      event.preventDefault();
      await saveBeforeWindowAction();
      await markNoteClosed(note);
      await win.hide();
    });

    return () => {
      if (isMainWindow) unregisterGlobalShortcuts();
      settingsPromise.then((fn) => fn());
      noteSettingsPromise.then((fn) => fn());
      newNotePromise.then((fn) => fn());
      openSettingsPromise.then((fn) => fn());
      showLastNotePromise.then((fn) => fn());
      movedPromise.then((fn) => fn());
      resizedPromise.then((fn) => fn());
      focusPromise.then((fn) => fn());
      closePromise.then((fn) => fn());
    };
  });

  $effect(() => {
    if (!settingsReady || !ready) return;
    void setPin(note.alwaysOnTop);
    scheduleNoteSave(note);
  });

  async function registerShortcuts() {
    const signature = shortcutSignature(globalSettings.shortcuts);
    if (registeredShortcuts === signature) return;

    const result = await registerGlobalShortcuts(globalSettings.shortcuts, {
      toggleWindow: () => {
        void showLastNoteWindow();
      },
      newNote: () => {
        void createNewNoteWindow();
      },
    });
    if (result.ok) {
      registeredShortcuts = signature;
      status = "快捷键已就绪";
    } else {
      status = `快捷键注册失败：${result.message}`;
    }
  }

  async function createNewNoteWindow() {
    await captureWindowState();
    const { note: seed } = await getRecentNote();
    const next = createNote({
      content: "",
      theme: seed.theme,
      customColor: seed.customColor,
      opacity: seed.opacity,
      alwaysOnTop: seed.alwaysOnTop,
      window: {
        ...seed.window,
        x: seed.window.x == null ? undefined : seed.window.x + 24,
        y: seed.window.y == null ? undefined : seed.window.y + 24,
      },
    });
    await saveNoteNow(next);
    await openNoteWindow(next);
    status = "已新建便签";
  }

  async function showLastNoteWindow() {
    const { note: target } = await getRecentNote();

    if (target.id === note.id && isMainWindow) {
      const win = getCurrentWindow();
      if (await win.isVisible()) {
        await win.hide();
      } else {
        await win.show();
        await win.setFocus();
      }
      return;
    }

    const existing = await WebviewWindow.getByLabel(noteWindowLabel(target.id));
    if (existing) {
      if (await existing.isVisible()) {
        await existing.hide();
      } else {
        await existing.show();
        await existing.setFocus();
      }
      return;
    }

    await openNoteWindow(target);
  }

  function updateTitle(value: string) {
    note = { ...note, title: value, updatedAt: Date.now() };
    scheduleNoteSave(note);
    status = "已自动保存";
  }

  function updateContent(value: string) {
    note = { ...note, content: value, updatedAt: Date.now() };
    scheduleNoteSave(note);
    status = "已自动保存";
  }

  function applyTemplate(template: NoteTemplate) {
    note = {
      ...note,
      title: template.title,
      content: template.content,
      updatedAt: Date.now(),
    };
    editorRevision += 1;
    scheduleNoteSave(note);
    status = `已套用模板：${template.name}`;
  }

  async function syncAutoStart(value: boolean) {
    try {
      if (value) {
        await enable();
      } else {
        await disable();
      }
      const enabled = await isEnabled();
      globalSettings = { ...globalSettings, autoStart: enabled };
      if (enabled !== value) {
        status = "开机自启状态与系统启动项不一致";
      }
    } catch {
      status = "开机自启设置失败，请使用安装版运行后重试";
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
    note = { ...note, alwaysOnTop: !note.alwaysOnTop, updatedAt: Date.now() };
    scheduleNoteSave(note);
    status = note.alwaysOnTop ? "已置顶" : "已取消置顶";
  }

  async function exportMarkdown() {
    await flushNoteSave(note.id).catch(() => {
      status = "自动保存失败，仍将尝试导出";
    });

    const defaultPath = defaultMarkdownFilename(note.title);

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
        content: note.content,
      });
      status = `已导出 ${target.split(/[\\/]/).at(-1)}`;
    } catch {
      status = "导出失败，请确认 dialog 插件已安装";
    }
  }

  async function closeCurrentNote() {
    try {
      await saveBeforeWindowAction();
      await markNoteClosed(note);
      await getCurrentWindow().hide();
    } catch {
      window.close();
    }
  }

  async function deleteCurrentNote() {
    const title = note.title.trim() || "未命名便签";
    if (!window.confirm(`删除便签「${title}」？此操作不可撤销。`)) return;

    try {
      await deleteNoteNow(note.id);
      status = "便签已删除";
      await getCurrentWindow().hide();
    } catch {
      status = "删除失败，请稍后重试";
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
      openCurrentSettings();
    } else if (mod && event.key === "/") {
      event.preventDefault();
      sourceMode = !sourceMode;
    }
  }

  async function applyNativeWindowState() {
    try {
      await getCurrentWindow().setAlwaysOnTop(note.alwaysOnTop);
    } catch {
      // Browser preview cannot control a native window.
    }
  }

  async function openCurrentSettings() {
    await saveNoteNow(note);
    await markNoteActive(note);
    await openSettingsWindow(note.id);
  }

  async function openRecentSettings() {
    const { note: target } = await getRecentNote();
    await openSettingsWindow(target.id);
  }

  async function captureWindowState() {
    if (!ready) return;
    try {
      const win = getCurrentWindow();
      const [position, size, scaleFactor] = await Promise.all([
        win.outerPosition(),
        win.innerSize(),
        win.scaleFactor(),
      ]);
      const logicalPosition = position.toLogical(scaleFactor);
      const logicalSize = size.toLogical(scaleFactor);
      note = {
        ...note,
        window: {
          x: Math.round(logicalPosition.x),
          y: Math.round(logicalPosition.y),
          width: Math.round(logicalSize.width),
          height: Math.round(logicalSize.height),
        },
        updatedAt: Date.now(),
      };
      scheduleNoteSave(note);
    } catch {
      // Browser preview cannot control a native window.
    }
  }

  async function saveBeforeWindowAction() {
    await captureWindowState();
    await Promise.allSettled([flushNoteSave(note.id), saveSettings(globalSettings)]);
  }

  function shortcutSignature(shortcuts: AppSettings["shortcuts"]) {
    return `${normalizeShortcut(shortcuts.toggleWindow)}\n${normalizeShortcut(shortcuts.newNote)}`;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <meta name="description" content="PinNote Markdown sticky note" />
</svelte:head>

<WindowChrome
  title={note.title}
  {status}
  {sourceMode}
  settings={noteSettings}
  onTitleChange={updateTitle}
  onTogglePin={togglePin}
  onToggleSource={() => (sourceMode = !sourceMode)}
  onOpenTemplates={() => (templatesOpen = true)}
  onExport={exportMarkdown}
  onOpenSettings={openCurrentSettings}
  onDelete={deleteCurrentNote}
  onQuit={closeCurrentNote}
  onStartDrag={startDrag}
  onStartResize={startResize}
>
  {#if ready}
    {#key `${note.id}-${editorRevision}`}
      {#if sourceMode}
        <SourceEditor value={note.content} onChange={updateContent} />
      {:else}
        <MilkdownEditor value={note.content} onChange={updateContent} />
      {/if}
    {/key}
  {/if}
</WindowChrome>

<TemplateDialog
  open={templatesOpen}
  hasContent={note.content.trim().length > 0}
  onApply={applyTemplate}
  onClose={() => (templatesOpen = false)}
/>
