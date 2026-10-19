<script lang="ts">
  import { createQuitGuard } from "$lib/quitGuard";
  import { invoke } from "@tauri-apps/api/core";
  import { save } from "@tauri-apps/plugin-dialog";
  import { getCurrentWindow, PhysicalPosition, LogicalPosition, LogicalSize, availableMonitors, type Window } from "@tauri-apps/api/window";
  import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
  import { emit, listen } from "@tauri-apps/api/event";
  import { onMount, tick } from "svelte";
  import MilkdownEditor from "../components/MilkdownEditor.svelte";
  import SourceEditor from "../components/SourceEditor.svelte";
  import NoteListPopover, { type NoteListItem } from "../components/NoteListPopover.svelte";
  import TemplateDialog from "../components/TemplateDialog.svelte";
  import WindowChrome from "../components/WindowChrome.svelte";
  import { defaultMarkdownFilename } from "$lib/filename";
  import {
    defaultSettings,
    loadSettings,
    normalizeShortcut,
    isMacPlatform,
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
    loadNotes,
    loadNoteById,
    markNoteActive,
    markNoteClosed,
    saveNoteNow,
    scheduleNoteSave,
    type PinNote,
  } from "$lib/notesStore";
  import { requestWindowVisibility, listenWindowVisibility } from "$lib/windowVisibility";
  import { noteWindowLabel, findNoteWindow, openNoteWindow } from "$lib/noteWindows";

  import { CAPSULE, EDITOR_MIN, fitBounds, normalizeBounds, normalizeDisplays, switchBounds, rememberBounds, restoreBounds, type Bounds } from "$lib/windowGeometry";

  let transitioning = $state(false);
  let modeChange: Promise<void> | undefined;
  let geometryRevision = 0;
  let note = $state<PinNote>(createNote());
  let sourceMode = $state(false);
  let globalSettings = $state<AppSettings>({ ...defaultSettings });
  let status = $state("正在加载…");
  let ready = $state(false);
  let settingsReady = $state(false);
  let editorRevision = $state(0);
  let requestedShortcuts = "";
  let visibilityChange = Promise.resolve();
  let notesOpen = $state(false);
  let noteListItems = $state<NoteListItem[]>([]);
  let templatesOpen = $state(false);
  let isMainWindow = false;
  let isDeleting = false;
  let windowStateTimer: ReturnType<typeof setTimeout>;
  let initialization: Promise<void>;
  let editor = $state<MilkdownEditor>();
  const quitGuard = createQuitGuard();
  const pinned = $derived(note.alwaysOnTop);

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

    initialization = loadNoteById(requestedNoteId).then(async ({ note: loaded }) => {
      note = loaded;
      status = "已就绪";
      await applyNativeWindowState(true).catch(() => { status = "窗口位置恢复失败，可继续编辑"; });
      if (isMainWindow) await invoke("set_main_note_id", { id: note.id });
      await markNoteActive(note);
      // A window created after the native save snapshot must never become editable
      // while an installation/exit is already in progress.
      const pending = await invoke<number | null>("pending_quit");
      if (pending != null) void prepareToQuit(pending);
      // Complete the initial reveal before accepting tray requests or edits.
      if (!isMainWindow || !(await invoke<boolean>("startup_hidden"))) await win.show();
      ready = true;
    });
    void initialization.catch(async (error) => {
      status = `加载失败，原数据已保留：${String(error)}`;
      await win.show();
    });

    loadSettings().then((next) => {
      globalSettings = next;
      settingsReady = true;
      if (isMainWindow) void registerShortcuts();
    });

    const settingsPromise = listen<AppSettings>("settings-changed", (event) => {
      const next = event.payload;
      const shortcutsChanged =
        shortcutSignature(next.shortcuts) !== shortcutSignature(globalSettings.shortcuts);
      globalSettings = next;
      if (isMainWindow && shortcutsChanged) {
        void registerShortcuts();
      }
      status = "设置已同步";
    });

    const noteSettingsPromise = listen<PinNote>("note-settings-changed", (event) => {
      if (!ready || event.payload.id !== note.id) return;
      const { theme, customColor, opacity, alwaysOnTop } = event.payload;
      note = { ...note, theme, customColor, opacity, alwaysOnTop };
      queueNoteSave();
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

    const toggleNotesPromise = isMainWindow
      ? listen("toggle-notes-visibility-requested", () => {
        void toggleAllNotesVisibility();
      })
      : Promise.resolve(() => {});

    const deleteNotePromise = listen<{ id: string }>("delete-note-requested", (event) => {
      if (!ready || event.payload.id !== note.id) return;
      void deleteCurrentNote(false);
    });

    const visibilityPromise = listenWindowVisibility(async (visible, expiresAt) => {
      await initialization;
      if (visible) await showCurrentNote(expiresAt);
      else if (!(await closeCurrentNote(expiresAt))) throw new Error("保存失败，便签未隐藏");
    });
    const movedPromise = win.onMoved(scheduleWindowCapture);
    const scalePromise = win.onScaleChanged(scheduleWindowCapture);
    const resizedPromise = win.onResized(scheduleWindowCapture);
    const focusPromise = win.onFocusChanged(({ payload }) => {
      if (payload && ready && !isDeleting) void markNoteActive(note).catch(() => { status = "保存失败，请重试"; });
    });
    const closePromise = win.onCloseRequested(async (event) => {
      if (isDeleting) return;
      event.preventDefault();
      await closeCurrentNote();
    });

    async function prepareToQuit(attempt: number) {
      if (!quitGuard.begin(attempt)) return;
      document.body.inert = true;
      try {
        await initialization.catch(() => undefined);
        await saveBeforeWindowAction();
        await invoke("quit_save_complete", { success: true, attempt });
      } catch {
        if (quitGuard.isCurrent(attempt)) {
          document.body.inert = false;
          status = "保存失败，已取消退出，请重试或导出便签";
        }
        await invoke("quit_save_complete", { success: false, attempt });
      }
    }
    const quitPromise = listen<number>("save-before-quit", (event) => void prepareToQuit(event.payload));
    // A quit request may precede this webview's listener registration.
    void quitPromise.then(async () => {
      const attempt = await invoke<number | null>("pending_quit");
      if (attempt != null) await prepareToQuit(attempt);
    });
    const quitCancelledPromise = listen<number>("quit-save-cancelled", (event) => {
      if (!quitGuard.cancel(event.payload)) return;
      document.body.inert = false;
      status = "操作已取消，可以继续编辑";
    });
    const quitFailedPromise = listen<number>("quit-save-failed", (event) => {
      if (!quitGuard.cancel(event.payload)) return;
      document.body.inert = false;
      status = "保存失败，已取消退出，请重试或导出便签";
    });

    return () => {
      clearTimeout(windowStateTimer);
      if (isMainWindow) void unregisterGlobalShortcuts();
      quitPromise.then((fn) => fn());
      quitFailedPromise.then((fn) => fn());
      quitCancelledPromise.then((fn) => fn());
      settingsPromise.then((fn) => fn());
      noteSettingsPromise.then((fn) => fn());
      newNotePromise.then((fn) => fn());
      openSettingsPromise.then((fn) => fn());
      toggleNotesPromise.then((fn) => fn());
      deleteNotePromise.then((fn) => fn());
      movedPromise.then((fn) => fn());
      resizedPromise.then((fn) => fn());
      scalePromise.then((fn) => fn());
      visibilityPromise.then((fn) => fn());
      focusPromise.then((fn) => fn());
      closePromise.then((fn) => fn());
    };
  });

  $effect(() => {
    if (!settingsReady || !ready || isDeleting) return;
    void setPin(pinned);
  });

  async function registerShortcuts() {
    const signature = shortcutSignature(globalSettings.shortcuts);
    if (requestedShortcuts === signature) return;
    requestedShortcuts = signature;

    const result = await registerGlobalShortcuts(globalSettings.shortcuts, {
      toggleWindow: () => {
        void toggleAllNotesVisibility();
      },
      newNote: () => {
        void createNewNoteWindow();
      },
    });
    if (result.cancelled) return;
    if (result.ok) {
      status = "快捷键已就绪";
    } else {
      requestedShortcuts = "";
      status = `快捷键注册失败：${result.message}`;
    }
  }

  async function createNewNoteWindow() {
    if (document.body.inert) return;
    await saveBeforeWindowAction();
    const { note: seed } = await getRecentNote();
    const next = createNote({
      content: "",
      theme: seed.theme,
      customColor: seed.customColor,
      opacity: seed.opacity,
      alwaysOnTop: seed.alwaysOnTop,
      window: {
        ...seed.window,
        collapsed: false,
        capsulePosition: undefined,
        position: seed.window.position ? { x: seed.window.position.x + (seed.window.positionSpace === "logical" ? 24 : 48), y: seed.window.position.y + (seed.window.positionSpace === "logical" ? 24 : 48) } : undefined,
        x: seed.window.x == null ? undefined : seed.window.x + 24,
        y: seed.window.y == null ? undefined : seed.window.y + 24,
      },
    });
    await saveNoteNow(next);
    if (!document.body.inert) await openNoteWindow(next);
    status = "已新建便签";
  }

  function toggleAllNotesVisibility() {
    visibilityChange = visibilityChange.then(async () => {
      await initialization;
      if (document.body.inert) return;
      const file = await loadNotes();
      const visibleWindows = await getVisibleNoteWindows(file);
      if (visibleWindows.length) {
        const results = await Promise.allSettled(visibleWindows.map((target) => requestWindowVisibility(target.label, false)));
        if (results.some((result) => result.status === "rejected")) throw new Error("部分便签未隐藏");
        status = "已隐藏全部便签";
      } else {
        await showAllNotes(file);
        status = "已显示全部便签";
      }
    }).catch(() => { status = "便签显示状态切换失败，请重试"; });
    return visibilityChange;
  }

  async function showCurrentNote(expiresAt = Infinity) {
    await modeChange;
    const id = note.id;
    const revision = geometryRevision;
    const assertCurrent = () => {
      if (!ready || isDeleting || document.body.inert || note.id !== id || geometryRevision !== revision || Date.now() >= expiresAt) {
        throw new Error("窗口状态已改变，请重试");
      }
    };
    assertCurrent();
    const current = await readWindowBounds();
    const target = fitBounds(current, normalizeDisplays(await availableMonitors(), isMacPlatform()));
    assertCurrent();
    // Repair windows stranded by a disconnected display before revealing them.
    if (target.x !== current.x || target.y !== current.y || target.width !== current.width || target.height !== current.height) {
      await setWindowBounds(target, Boolean(note.window.collapsed));
      assertCurrent();
      await captureWindowState();
    }
    assertCurrent();
    await getCurrentWindow().show();
  }

  async function showAllNotes(file: Awaited<ReturnType<typeof loadNotes>>) {
    const notes = Object.values(file.notes).sort((a, b) => a.createdAt - b.createdAt);

    for (const target of notes) {
      if (target.id === note.id && isMainWindow) {
        await showCurrentNote();
        continue;
      }
      await openNoteWindow(target);
    }

    await focusRecentNote(notes);
  }

  async function focusRecentNote(notes: PinNote[]) {
    const target = [...notes].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
    if (!target) return;

    if (target.id === note.id && isMainWindow) {
      await getCurrentWindow().setFocus();
      return;
    }

    const existing = await WebviewWindow.getByLabel(noteWindowLabel(target.id));
    await existing?.setFocus();
  }

  async function getVisibleNoteWindows(file: Awaited<ReturnType<typeof loadNotes>>) {
    const windows = await WebviewWindow.getAll();
    const mainNoteId = await invoke<string | null>("main_note_id");
    const result: Array<{ id: string; label: string; lastFocusedAt: number }> = [];

    for (const win of windows) {
      const id = win.label === "main" ? mainNoteId : noteIdFromWindowLabel(win.label);
      if (!id || !file.notes[id] || !(await win.isVisible())) continue;
      result.push({ id, label: win.label, lastFocusedAt: file.notes[id].lastFocusedAt });
    }

    return result;
  }

  function noteIdFromWindowLabel(label: string) {
    if (label === "main") return isMainWindow ? note.id : "";
    if (label.startsWith("note-")) return label.slice("note-".length);
    return "";
  }

  async function openNoteList() {
    templatesOpen = false;
    notesOpen = true;
    await refreshNoteList();
  }

  async function refreshNoteList() {
    const file = await loadNotes();
    const visibleIds = new Set((await getVisibleNoteWindows(file)).map((item) => item.id));
    noteListItems = Object.values(file.notes)
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)
      .map((item) => ({
        id: item.id,
        title: item.title,
        visible: visibleIds.has(item.id),
        current: item.id === note.id,
        updatedAt: item.updatedAt,
      }));
  }

  async function showNoteById(id: string) {
    const file = await loadNotes();
    const target = file.notes[id];
    if (!target) {
      await refreshNoteList();
      return;
    }

    if (target.id === note.id && getCurrentWindow().label === (isMainWindow ? "main" : noteWindowLabel(note.id))) {
      await showCurrentNote();
      await getCurrentWindow().setFocus();
    } else {
      await openNoteWindow(target);
    }

    await refreshNoteList();
  }

  async function hideNoteById(id: string) {
    if (id === note.id) {
      await closeCurrentNote();
    } else {
      const win = await findNoteWindow(id);
      if (win) await requestWindowVisibility(win.label, false);
    }
    await refreshNoteList();
  }

  async function deleteNoteById(id: string) {
    const target = noteListItems.find((item) => item.id === id);
    const title = target?.title?.trim() || "未命名便签";
    if (!window.confirm(`删除便签「${title}」？此操作不可撤销。`)) return;

    if (id === note.id) {
      await deleteCurrentNote(false);
      return;
    }

    const win = await findNoteWindow(id);
    if (win) {
      await emit("delete-note-requested", { id });
      await new Promise((resolve) => setTimeout(resolve, 100));
    } else {
      await deleteNoteNow(id);
    }

    await refreshNoteList();
  }

  function queueNoteSave() {
    if (!ready || isDeleting) return;
    status = "正在保存…";
    scheduleNoteSave(note, (error) => {
      status = error ? "保存失败，请重试或导出便签" : "已自动保存";
    });
  }

  function updateTitle(value: string) {
    note = { ...note, title: value, updatedAt: Date.now() };
    queueNoteSave();
  }

  function updateContent(value: string) {
    note = { ...note, content: value, updatedAt: Date.now() };
    queueNoteSave();
  }

  function applyTemplate(template: NoteTemplate) {
    note = {
      ...note,
      title: template.title,
      content: template.content,
      updatedAt: Date.now(),
    };
    editorRevision += 1;
    queueNoteSave();
    status = `已套用模板：${template.name}`;
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
    queueNoteSave();
    status = note.alwaysOnTop ? "已置顶" : "已取消置顶";
  }

  async function exportMarkdown() {
    editor?.flush();
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

  async function closeCurrentNote(expiresAt = Infinity) {
    try {
      if (isDeleting || !ready || document.body.inert) return false;
      await saveBeforeWindowAction();
      await markNoteClosed(note);
      if (Date.now() >= expiresAt || isDeleting || document.body.inert) {
        status = "窗口响应超时或状态已改变，便签未隐藏";
        return false;
      }
      await getCurrentWindow().hide();
      return true;
    } catch {
      status = "保存失败，便签未关闭，请重试或导出";
      return false;
    }
  }

  async function deleteCurrentNote(shouldConfirm = true) {
    const title = note.title.trim() || "未命名便签";
    if (shouldConfirm && !window.confirm(`删除便签「${title}」？此操作不可撤销。`)) return;

    try {
      isDeleting = true;
      await modeChange;
      geometryRevision += 1;
      const fallback = await deleteNoteNow(note.id);
      status = "便签已删除";
      if (isMainWindow) {
        const existing = await WebviewWindow.getByLabel(noteWindowLabel(fallback.id));
        ready = !existing;
        await invoke("set_main_note_id", { id: ready ? fallback.id : null });
        note = ready ? fallback : createNote({ id: "" });
        editorRevision += 1;
        isDeleting = false;
        if (ready) await applyNativeWindowState(true);
        await getCurrentWindow().hide();
      } else {
        await getCurrentWindow().destroy();
      }
    } catch {
      isDeleting = false;
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

  async function startResize(event: PointerEvent, direction: Parameters<Window["startResizeDragging"]>[0]) {
    if (event.button !== 0 || transitioning || note.window.collapsed) return;
    event.preventDefault();
    event.stopPropagation();

    try {
      await getCurrentWindow().startResizeDragging(direction);
    } catch {
      status = "浏览器预览模式不能调整原生窗口大小";
    }
  }

  function isInteractiveElement(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("button, input, textarea, a"));
  }

  function toggleSource() {
    editor?.flush();
    sourceMode = !sourceMode;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!ready || document.body.inert) return;
    if (event.isComposing || event.keyCode === 229 || event.repeat) return;
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
      toggleSource();
    }
  }

  async function readWindowBounds(): Promise<Bounds> {
    const win = getCurrentWindow();
    const [position, size, scaleFactor] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
    const logical = size.toLogical(scaleFactor);
    return normalizeBounds({ x: position.x, y: position.y, width: logical.width, height: logical.height, scaleFactor }, isMacPlatform());
  }

  async function setWindowBounds(bounds: Bounds, collapsed: boolean, animate = false) {
    const win = getCurrentWindow();
    // Disable native resizing before shrinking: Windows otherwise enforces its resize-frame minimum.
    await win.setResizable(false);
    await win.setMinSize(new LogicalSize(CAPSULE.width, CAPSULE.height));
    if (animate && isMacPlatform()) {
      await invoke("animate_note_window", { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    } else {
      await win.setPosition((isMacPlatform() ? new LogicalPosition(bounds.x, bounds.y) : new PhysicalPosition(bounds.x, bounds.y)));
      await win.setSize(new LogicalSize(bounds.width, bounds.height));
      // macOS resizes from the bottom edge; restore the intended top edge afterwards.
      await win.setPosition((isMacPlatform() ? new LogicalPosition(bounds.x, bounds.y) : new PhysicalPosition(bounds.x, bounds.y)));
    }
    if (!collapsed) {
      await win.setMinSize(new LogicalSize(EDITOR_MIN.width, EDITOR_MIN.height));
      await win.setResizable(true);
    }
  }

  async function applyNativeWindowState(restoreGeometry = false) {
    if (restoreGeometry) {
      const [current, monitors] = await Promise.all([readWindowBounds(), availableMonitors()]);
      await setWindowBounds(restoreBounds(note.window, current, normalizeDisplays(monitors, isMacPlatform())), Boolean(note.window.collapsed));
    }
    await getCurrentWindow().setAlwaysOnTop(note.alwaysOnTop);
  }

  function toggleCollapsed() {
    if (!ready || isDeleting || transitioning || document.body.inert) return;
    modeChange = changeWindowMode().finally(() => { modeChange = undefined; });
  }

  async function changeWindowMode() {
    transitioning = true;
    geometryRevision += 1;
    clearTimeout(windowStateTimer);
    notesOpen = false;
    templatesOpen = false;
    editor?.flush();
    const previous = note.window;
    let current: Bounds | undefined;
    try {
      current = await readWindowBounds();
      const saved = rememberBounds(previous, current);
      const collapsed = !previous.collapsed;
      const target = switchBounds(current, saved, collapsed, normalizeDisplays(await availableMonitors(), isMacPlatform()));
      // Persist the live editor before changing the window; a failed write keeps it open.
      note = { ...note, window: saved };
      await saveNoteNow(note);
      const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Finish the content fade before resizing. The native frame animation then
      // owns both position and size, instead of separate visible IPC jumps.
      await tick();
      if (animate) await new Promise((resolve) => setTimeout(resolve, 100));
      note = { ...note, window: { ...saved, collapsed } };
      await tick();
      await setWindowBounds(target, collapsed, animate);
      note = { ...note, window: rememberBounds({ ...saved, collapsed }, target) };
      queueNoteSave();
      await flushNoteSave(note.id);
    } catch {
      note = { ...note, window: previous };
      if (current) await setWindowBounds(current, Boolean(previous.collapsed)).catch(() => undefined);
      // Replace any failed compact-state save with the rolled-back state for the next retry.
      queueNoteSave();
      status = "窗口切换失败，已保留原便签，请重试";
    } finally {
      transitioning = false;
    }
  }

  async function openCurrentSettings() {
    editor?.flush();
    await saveNoteNow(note);
    await markNoteActive(note);
    await openSettingsWindow(note.id);
  }

  async function openRecentSettings() {
    if (document.body.inert) return;
    const { note: target } = await getRecentNote();
    await openSettingsWindow(target.id);
  }

  function scheduleWindowCapture() {
    if (!ready || isDeleting || transitioning) return;
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => void captureWindowState().catch(() => { status = "窗口位置保存失败，请重试"; }), 150);
  }

  async function captureWindowState() {
    clearTimeout(windowStateTimer);
    if (!ready || isDeleting || transitioning) return;
    const revision = geometryRevision;
    const id = note.id;
    const bounds = await readWindowBounds();
    if (revision !== geometryRevision || id !== note.id || transitioning || isDeleting) return;
    note = { ...note, window: rememberBounds(note.window, bounds), updatedAt: Date.now() };
    queueNoteSave();
  }

  async function saveBeforeWindowAction() {
    await modeChange;
    if (!ready || isDeleting) return;
    editor?.flush();
    await captureWindowState();
    await flushNoteSave(note.id);
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
  disabled={!ready}
  collapsed={Boolean(note.window.collapsed)}
  {transitioning}
  onToggleCollapsed={toggleCollapsed}
  onNewNote={createNewNoteWindow}
  title={note.title}
  {status}
  {sourceMode}
  settings={noteSettings}
  onTitleChange={updateTitle}
  onTogglePin={togglePin}
  onToggleSource={toggleSource}
  onOpenNotes={openNoteList}
  onOpenTemplates={() => {
    editor?.flush();
    notesOpen = false;
    templatesOpen = true;
  }}
  onExport={exportMarkdown}
  onOpenSettings={openCurrentSettings}
  onDelete={deleteCurrentNote}
  onQuit={() => { void closeCurrentNote(); }}
  onStartDrag={startDrag}
  onStartResize={startResize}
>
  {#if ready}
    {#key `${note.id}-${editorRevision}`}
      {#if sourceMode}
        <SourceEditor value={note.content} onChange={updateContent} />
      {:else}
        <MilkdownEditor bind:this={editor} value={note.content} onChange={updateContent} />
      {/if}
    {/key}
  {/if}
</WindowChrome>

<NoteListPopover
  open={notesOpen}
  items={noteListItems}
  onShow={showNoteById}
  onHide={hideNoteById}
  onDelete={deleteNoteById}
  onRefresh={refreshNoteList}
  onClose={() => (notesOpen = false)}
/>

<TemplateDialog
  open={templatesOpen}
  hasContent={note.content.trim().length > 0}
  onApply={applyTemplate}
  onClose={() => (templatesOpen = false)}
/>
