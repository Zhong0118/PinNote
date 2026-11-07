<script lang="ts">
  import { createQuitGuard } from "$lib/quitGuard";
  import { noteOperation, hasPendingSave, discardPendingSave } from '$lib/notesStore';
  import { edgeTarget, edgeLayout, edgeOrder, dockedEditorBounds } from '$lib/edgeQueue';
  import { releaseCenterEditor } from '$lib/editorHandoff';
  import { animateWindow, type Curve } from '$lib/nativeMotion';
  import { showPreview } from '$lib/previewWindow';
  import { openCenter } from '$lib/centerWindow';
  import ReminderDialog from '../components/ReminderDialog.svelte';
  import { checklistProgress } from '$lib/checklist';
  let reminderOpen = $state(false);
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
    type NoteWindowState,
    type SaveScope,
  } from "$lib/notesStore";
  import { requestWindowVisibility, listenWindowVisibility } from "$lib/windowVisibility";
  import { noteWindowLabel, findNoteWindow, openNoteWindow } from "$lib/noteWindows";

  import { CAPSULE, EDITOR_MIN, NOTE_MIN, displayFor, fitBounds, normalizeBounds, normalizeDisplays, switchBounds, rememberBounds, restoreBounds, type Bounds, type Display } from "$lib/windowGeometry";

  type Edge = NonNullable<NoteWindowState["edge"]>;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let transitioning = $state(false);
  let modeChange: Promise<void> | undefined;
  let dragging = false;
  let layingOut = false;
  let relayout = false;
  // While the native frame animates, the content keeps its expanded size and is
  // clipped by the moving frame, so nothing reflows mid-animation.
  let freeze = $state<{ width: number; height: number }>();
  let opening = $state(false);
  let edgeHint = $state('');
  let previewTimer: ReturnType<typeof setTimeout>;
  let hovering = false;
  let edgeOverflow = $state(0);
  let overflowHidden = false;
  let locating=$state(false);
  let locateTimer:ReturnType<typeof setTimeout>;
  let undoId = $state('');
  let geometryRevision = 0;
  let note = $state<PinNote>(createNote());
  const progress = $derived(checklistProgress(note.content));
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
      if(note.placement !== 'desktop') throw new Error('便签已收回中心');
      await markNoteActive(note);
      // A window created after the native save snapshot must never become editable
      // while an installation/exit is already in progress.
      const pending = await invoke<number | null>("pending_quit");
      if (pending != null) void prepareToQuit(pending);
      // Complete the initial reveal before accepting tray requests or edits.
      ready = true;
      // Place a docked tab in its slot before the first paint instead of jumping after it.
      await layoutEdges(false);
      if ((!isMainWindow || !(await invoke<boolean>("startup_hidden"))) && !overflowHidden) await win.show();
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
    const changes = listen<{id:string;note:PinNote|null;op:string;layout?:boolean}>('notes-changed', async ({payload}) => {
      if (payload.id === note.id && ready && payload.op !== 'focus') {
        if(payload.op==='appearance'&&payload.note){const {theme,customColor,opacity,alwaysOnTop}=payload.note;note={...note,theme,customColor,opacity,alwaysOnTop};return;}
        editor?.flush();
        if (!payload.note || payload.note.lifecycle !== 'active' || payload.note.placement !== 'desktop') {
          if(hasPendingSave(note.id)) { status='便签状态已变化，本地草稿已保留，请先导出';return; }
          discardPendingSave(note.id); ready = false; isDeleting = true; await win.destroy();
        } else if (payload.note.revision > note.revision && (!hasPendingSave(note.id) || note.window.collapsed)) {
          // Body edits made in the center while this note is a capsule/tab. Geometry
          // stays owned by this window.
          const contentChanged = note.content !== payload.note.content;
          note = { ...payload.note, window: note.window }; if (contentChanged) editorRevision++;
        }
      }
      if(notesOpen) await refreshNoteList();
      if(payload.layout) await layoutEdges();
    });
    const expand = listen<{id:string}>('expand-note-requested', ({payload}) => {
      if(payload.id === note.id && note.window.collapsed) { toggleCollapsed(); void win.setFocus(); }
    });
    // The center asks to take over editing: collapse back to the capsule or edge slot.
    const collapseRequest = listen<{id:string}>('collapse-note-requested', ({payload}) => {
      if(payload.id === note.id && ready && !note.window.collapsed) toggleCollapsed();
    }, { target: win.label });
    const locate=listen<{id:string}>('locate-note-requested',async({payload})=>{
      if(payload.id!==note.id||!ready)return;
      try{
        await modeChange;
        if(note.window.collapsed)await changeWindowMode();
        await getCurrentWindow().show();await getCurrentWindow().setFocus();
        locating=true;clearTimeout(locateTimer);locateTimer=setTimeout(()=>locating=false,2200);
      }catch(error){status=`定位失败：${error}`;}
    });
    let displaySignature = '';
    const monitorTimer=setInterval(()=>void (async()=>{
      if(!ready||dragging||transitioning||layingOut)return;
      const monitors=await availableMonitors();const signature=JSON.stringify(monitors);
      if(signature===displaySignature)return;displaySignature=signature;
      if(note.window.edge)await layoutEdges();
      else if(await win.isVisible())await showCurrentNote();
    })().catch(()=>{status='显示器位置恢复失败，请重新显示便签';}),5000);

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
      clearTimeout(previewTimer); changes.then(f=>f()); expand.then(f=>f()); collapseRequest.then(f=>f());
      clearTimeout(locateTimer);locate.then(f=>f());
      clearInterval(monitorTimer);
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
      placement: 'desktop',
      content: "",
      theme: seed.theme,
      customColor: seed.customColor,
      opacity: seed.opacity,
      alwaysOnTop: seed.alwaysOnTop,
      window: {
        ...seed.window,
        collapsed: false,
        edge: null,
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
    if(note.window.collapsed && note.window.edge) {
      const target=edgeLayout(Object.values((await loadNotes()).notes),normalizeDisplays(await availableMonitors(),isMacPlatform())).get(note.id);
      if(target?.overflow){overflowHidden=true;return;}
      if(target)await setWindowBounds(target.bounds,true);
    }
    await getCurrentWindow().show();
  }

  async function showAllNotes(file: Awaited<ReturnType<typeof loadNotes>>) {
    const notes = Object.values(file.notes).filter(n => n.lifecycle === 'active' && n.placement === 'desktop').sort((a, b) => a.createdAt - b.createdAt);

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
      if (!id || file.notes[id]?.lifecycle !== 'active' || file.notes[id]?.placement !== 'desktop' || !(await win.isVisible())) continue;
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
    await saveBeforeWindowAction();
    await openCenter();
  }

  async function refreshNoteList() {
    const file = await loadNotes();
    const visibleIds = new Set((await getVisibleNoteWindows(file)).map((item) => item.id));
    noteListItems = Object.values(file.notes)
      .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)
      .map((item) => ({
        id: item.id,
        title: item.title,
        content: item.content,
        lifecycle: item.lifecycle,
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
    undoId = id;

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

  // A collapsed note is only an entry point: it writes geometry, never the body.
  function queueNoteSave(scope: SaveScope = note.window.collapsed ? "window" : "all") {
    if (!ready || isDeleting) return;
    if (scope !== "window") status = "正在保存…";
    scheduleNoteSave(note, (error) => {
      if (error) status = "保存失败，请重试或导出便签";
      else if (scope !== "window") status = "已自动保存";
    }, scope);
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

  async function togglePin() {
    note = { ...note, alwaysOnTop: !note.alwaysOnTop, updatedAt: Date.now() };
    try{await noteOperation({...note},'appearance',{patch:{alwaysOnTop:note.alwaysOnTop}});}catch(error){status=String(error);return;}
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
    let frozen = false;
    try {
      if (isDeleting || !ready || document.body.inert) return false;
      document.body.inert = true; frozen = true;
      await saveBeforeWindowAction();
      await markNoteClosed(note);
      if (Date.now() >= expiresAt || isDeleting) {
        status = "窗口响应超时或状态已改变，便签未隐藏";
        return false;
      }
      await getCurrentWindow().hide();
      return true;
    } catch {
      status = "保存失败，便签未关闭，请重试或导出";
      return false;
    } finally {
      if(frozen) document.body.inert = false;
    }
  }

  async function deleteCurrentNote(shouldConfirm = true) {
    void shouldConfirm;
    await lifecycle(note.id,'trash');
  }

  async function startDrag(event: PointerEvent) {
    if (event.button !== 0 || isInteractiveElement(event.target) || dragging || transitioning) return;

    try {
      dragging = true; hoverPreview(false);
      clearTimeout(windowStateTimer);
      const start = await readWindowBounds();
      await getCurrentWindow().startDragging();
      // Native startDragging can resolve before mouse-up (notably on macOS).
      // Track the native button, not DOM pointerup which leaves this webview.
      while(await invoke<boolean>('pointer_pressed')) {
        const b=await readWindowBounds();const edge=edgeTarget(b,normalizeDisplays(await availableMonitors(),isMacPlatform()));
        edgeHint=edge?`松手收纳到${edge.side==='left'?'左':'右'}侧`:'';
        await new Promise(resolve=>setTimeout(resolve,60));
      }
      const bounds = await readWindowBounds();
      dragging = false; edgeHint = '';
      // A press without movement (e.g. on the title bar of a note opened from its tab)
      // must not re-dock or undock it.
      if (Math.abs(bounds.x - start.x) < 4 * bounds.scaleFactor && Math.abs(bounds.y - start.y) < 4 * bounds.scaleFactor) return;
      const displays=normalizeDisplays(await availableMonitors(), isMacPlatform());
      const edge = edgeTarget(bounds, displays);
      if(edge) await dockToEdge(edge.side,bounds);
      else await undock(bounds, displays);
    } catch(error) {
      status=`贴边或移动失败：${String(error)}`;
    } finally { dragging = false; edgeHint = ''; }
  }

  /** Dragging off the edge is the only way to leave a slot; a tab becomes a free capsule. */
  async function undock(bounds: Bounds, displays: Display[]) {
    let target = bounds;
    if (note.window.collapsed && note.window.edge) {
      const fromRight = note.window.edge.side === 'right';
      target = fitBounds({ ...bounds, ...CAPSULE, x: fromRight ? bounds.x + bounds.width * bounds.scaleFactor - CAPSULE.width * bounds.scaleFactor : bounds.x }, displays, bounds);
      layingOut = true;
      try {
        note = { ...note, window: { ...note.window, edge: null } };
        await tick();
        await setWindowBounds(target, true, !reducedMotion(), "out", 220);
      } finally { layingOut = false; }
    }
    note = { ...note, window: { ...rememberBounds({ ...note.window, edge: null }, target), edge: null } };
    await saveNoteNow(note, "window");
  }

  async function dockToEdge(side:'left'|'right', bounds?:Bounds) {
    try {
      editor?.flush();
      const current=bounds??await readWindowBounds();const displays=normalizeDisplays(await availableMonitors(),isMacPlatform());
      const display=displayFor(current,displays);if(!display)throw new Error('无法读取显示器工作区');
      const p=display.workArea.position;
      const edge:Edge={side,display:`${p.x}:${p.y}`,order:current.y};
      edge.order=edgeOrder(note.id,edge,current,Object.values((await loadNotes()).notes),displays);
      if(!note.window.collapsed) {
        // Shrink straight into the slot: one continuous motion, no intermediate capsule.
        await modeChange;
        modeChange = changeWindowMode(edge).finally(() => { modeChange = undefined; });
        await modeChange;
        if(!note.window.collapsed)throw new Error('收起失败，请先保存便签');
      } else {
        note={...note,window:{...note.window,edge}};
        await saveNoteNow(note,"window");
        await layoutEdges();
      }
      status=`已收纳到${side==='left'?'左':'右'}侧 · 向内拖动可移出`;
    }catch(error){status=`贴边失败：${String(error)}`;}
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

  async function setWindowBounds(bounds: Bounds, collapsed: boolean, animate = false, curve: Curve = "inOut", duration = 220) {
    const win = getCurrentWindow();
    // Disable native resizing before shrinking: Windows otherwise enforces its resize-frame minimum.
    await win.setResizable(false);
    await win.setMinSize(new LogicalSize(NOTE_MIN.width, NOTE_MIN.height));
    if (animate && isMacPlatform()) {
      await animateWindow({ bounds, curve, duration });
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

  /** Where the window goes next: its edge slot, a frame opening inward from it, or a free capsule. */
  async function modeTarget(current: Bounds, state: NoteWindowState, displays: Display[]): Promise<Bounds> {
    if (state.edge) {
      const peers = Object.values((await loadNotes()).notes).map(n => n.id === note.id ? { ...note, window: state } : n);
      const slot = edgeLayout(peers, displays).get(note.id);
      if (slot) return state.collapsed ? slot.bounds : dockedEditorBounds(slot, state, displays);
    }
    return switchBounds(current, state, Boolean(state.collapsed), displays);
  }

  async function changeWindowMode(dockEdge?: Edge) {
    transitioning = true;
    // The capsule/tab unmounts without a pointerleave; dismiss its hover preview explicitly.
    hoverPreview(false);
    geometryRevision += 1;
    clearTimeout(windowStateTimer);
    notesOpen = false;
    templatesOpen = false;
    editor?.flush();
    const previous = note.window;
    let current: Bounds | undefined;
    let moved = false;
    try {
      current = await readWindowBounds();
      const collapsed = !previous.collapsed;
      // Expanding keeps the slot: collapsing again returns to it; only dragging away undocks.
      const edge = dockEdge ?? previous.edge ?? null;
      const saved = { ...rememberBounds(previous, current), edge };
      const displays = normalizeDisplays(await availableMonitors(), isMacPlatform());
      const animate = !reducedMotion();
      if (collapsed) {
        // Persist the live editor before shrinking; a failed write keeps it open.
        note = { ...note, window: saved };
        await saveNoteNow(note, "all");
      } else {
        // The center may be editing this note; take the editor back with its latest text.
        await releaseCenterEditor(note.id);
        const fresh = (await loadNotes()).notes[note.id];
        if (fresh && (fresh.content !== note.content || fresh.title !== note.title || fresh.revision > note.revision)) {
          const contentChanged = fresh.content !== note.content;
          note = { ...fresh, window: saved };
          if (contentChanged) editorRevision++;
        }
      }
      const next = { ...saved, collapsed };
      const target = await modeTarget(current, next, displays);
      if (collapsed) {
        // Fold the expanded note into the capsule/tab spot, then swap in the capsule.
        freeze = { width: current.width, height: current.height };
        await tick();
        moved = true;
        await setWindowBounds(target, true, animate, "inOut", 220);
        note = { ...note, window: next };
      } else {
        // Lay out the header and editor at their final size first; the growing
        // frame reveals them while the editor fades in.
        freeze = { width: target.width, height: target.height };
        note = { ...note, window: next };
        opening = true;
        await tick();
        moved = true;
        await setWindowBounds(target, false, animate, "out", 260);
      }
      freeze = undefined; opening = false;
      note = { ...note, window: rememberBounds(next, target) };
      transitioning = false;
      await saveNoteNow(note, "window");
    } catch (error) {
      freeze = undefined; opening = false;
      note = { ...note, window: previous };
      if (current && moved) await setWindowBounds(current, Boolean(previous.collapsed)).catch(() => undefined);
      // Replace any failed compact-state save with the rolled-back state for the next retry.
      queueNoteSave("window");
      status = `窗口切换失败，已保留原便签：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      transitioning = false;
    }
    if (note.window.collapsed && note.window.edge) await layoutEdges();
  }

  async function openCurrentSettings() {
    editor?.flush();
    await saveNoteNow(note, note.window.collapsed ? "window" : "all");
    await markNoteActive(note);
    await openSettingsWindow(note.id);
  }

  async function openRecentSettings() {
    if (document.body.inert) return;
    const { note: target } = await getRecentNote();
    await openSettingsWindow(target.id);
  }

  function scheduleWindowCapture() {
    if (!ready || isDeleting || transitioning || layingOut) return;
    if(dragging) { void readWindowBounds().then(async b => { edgeHint = edgeTarget(b, normalizeDisplays(await availableMonitors(), isMacPlatform())) ? '松手贴边' : ''; }); return; }
    clearTimeout(windowStateTimer);
    windowStateTimer = setTimeout(() => void captureWindowState().catch(() => { status = "窗口位置保存失败，请重试"; }), 150);
  }

  async function captureWindowState() {
    clearTimeout(windowStateTimer);
    if (!ready || isDeleting || transitioning || dragging) return;
    const revision = geometryRevision;
    const id = note.id;
    const bounds = await readWindowBounds();
    if (revision !== geometryRevision || id !== note.id || transitioning || isDeleting) return;
    // A docked tab's place is its slot; an expanded docked note still remembers its size.
    if(note.window.edge && note.window.collapsed) return;
    note = { ...note, window: rememberBounds(note.window, bounds), updatedAt: Date.now() };
    queueNoteSave("window");
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
  async function layoutEdges(animate = true) {
    if (!ready || dragging || transitioning || !note.window.collapsed || !note.window.edge) return;
    if (layingOut) { relayout = true; return; }
    layingOut = true;
    try {
      do {
        relayout = false;
        const win = getCurrentWindow();
        const entries = edgeLayout(Object.values((await loadNotes()).notes), normalizeDisplays(await availableMonitors(), isMacPlatform()));
        const target = entries.get(note.id);
        if(target?.overflow) { if(!overflowHidden){ overflowHidden=true; await win.hide(); } }
        else if(target) {
          edgeOverflow = target.extra;
          const current = await readWindowBounds();
          const b = target.bounds;
          const changed = Math.abs(current.x - b.x) > 1 || Math.abs(current.y - b.y) > 1 || Math.abs(current.width - b.width) > 1 || Math.abs(current.height - b.height) > 1;
          // Peers glide into freed slots; unchanged tabs are left alone.
          if (changed) await setWindowBounds(b, true, animate && !overflowHidden && !reducedMotion() && await win.isVisible(), "inOut", 200);
          if(overflowHidden){overflowHidden=false;await win.show();}
        }
      } while (relayout && note.window.collapsed && note.window.edge);
    } finally { layingOut = false; relayout = false; }
  }
  function hoverPreview(inside: boolean) {
    hovering = inside;
    clearTimeout(previewTimer);
    void emit('preview-hover',{id:note.id,inside});
    if(inside && !dragging && note.window.collapsed) previewTimer = setTimeout(() => void showPreview(note).then(()=>{if(!hovering)void emit('preview-hover',{id:note.id,inside:false});}), 350);
  }
  async function lifecycle(id:string, op:string) {
    try {
      if(id === note.id) await saveBeforeWindowAction();
      else { const win = await findNoteWindow(id); if(win) await requestWindowVisibility(win.label,false); }
      const target = (await loadNotes()).notes[id];
      if(op === 'purge' && !window.confirm('永久删除后无法恢复，确定删除？')) return;
      await noteOperation(target,op);
      if(op === 'center' || op === 'archive' || op === 'trash') {
        await openCenter();
        if(id === note.id) { isDeleting = true; await getCurrentWindow().destroy().catch(()=>{}); }
      }
      if(op === 'trash' || op === 'archive') undoId = id;
      await refreshNoteList();
    } catch(error) { status = String(error); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<svelte:head>
  <meta name="description" content="PinNote Markdown sticky note" />
</svelte:head>

<WindowChrome
  disabled={!ready}
  collapsed={Boolean(note.window.collapsed)}
  dockedSide={note.window.edge?.side}
  {freeze}
  {opening}
  {transitioning}
  onToggleCollapsed={toggleCollapsed}
  {edgeHint}
  {edgeOverflow}
  {locating}
  onDock={side=>void dockToEdge(side)}
  onHover={hoverPreview}
  onArchive={() => lifecycle(note.id,'archive')}
  onReturn={() => lifecycle(note.id,'center')}
  onReminder={() => reminderOpen=true}
  onClearCompleted={!sourceMode && progress.done>0 ? () => editor?.clearCompleted() : undefined}
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
    {#if note.reminder}<button class="reminder-tag" onclick={()=>reminderOpen=true}>{note.reminder.state==='delivered'?'已提醒 · ':''}{new Date(note.reminder.at).toLocaleString()}</button>{/if}
    {#key `${note.id}-${editorRevision}`}
      {#if sourceMode}
        <SourceEditor value={note.content} onChange={updateContent} />
      {:else}
        <MilkdownEditor bind:this={editor} value={note.content} onChange={updateContent} onReminder={()=>reminderOpen=true}/>
      {/if}
    {/key}
  {/if}
</WindowChrome>
{#if reminderOpen}<ReminderDialog currentAt={note.reminder?.at} onClose={()=>reminderOpen=false} onSet={async at=>{await saveBeforeWindowAction();const current=(await loadNotes()).notes[note.id];await noteOperation(current,'reminder',{at});note=current;}}/>{/if}
<style>.reminder-tag{border:0;border-radius:5px;background:#eff6ff;color:#2563eb;font-size:11px;padding:3px 8px;margin:6px 16px;cursor:pointer}</style>

<NoteListPopover
  open={notesOpen}
  items={noteListItems}
  onShow={showNoteById}
  onHide={hideNoteById}
  onDelete={deleteNoteById}
  onRefresh={refreshNoteList}
  onClose={() => (notesOpen = false)}
  onAction={lifecycle}
  {undoId}
/>

<TemplateDialog
  open={templatesOpen}
  hasContent={note.content.trim().length > 0}
  onApply={applyTemplate}
  onClose={() => (templatesOpen = false)}
/>
