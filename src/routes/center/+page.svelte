<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, emit, emitTo } from '@tauri-apps/api/event';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { PanelLeft, Plus, X, MoreHorizontal, Monitor, Archive, Trash2, Settings, Search, Minimize2, ChevronsLeft, ChevronsRight, PenLine, ClockArrowDown, Sun, Moon, Star, ListFilter, History, ChartColumn, Hash, Check, Bell, ListTodo, CheckCheck, MonitorDown, ArchiveRestore, CopyPlus, RefreshCw, Code2, LayoutTemplate, ChevronDown, Copy, Download, PanelRightClose, LayoutGrid, ArrowDownToLine, CornerDownRight, FileDown, EyeOff, ClipboardPaste, Ghost, Zap } from 'lucide-svelte';
  import { answerRelease } from '$lib/editorHandoff';
  import { arrangeDesktopBounds, fitBounds } from '$lib/windowGeometry';
  import { validWindow } from '$lib/centerLayout';
  import { CenterForm } from '$lib/centerForm.svelte';
  import MilkdownEditor from '../../components/MilkdownEditor.svelte';
  import SourceEditor from '../../components/SourceEditor.svelte';
  import TemplateDialog from '../../components/TemplateDialog.svelte';
  import { createNote, loadNotes, notesSnapshot, applyNoteChange, saveNoteNow, scheduleNoteSave, flushNoteSave, noteOperation, hasLocalEdits, discardPendingSave, markEdited, markSettled, classifyChange, noteConflict, onNoteConflict, keepLocalVersion, takeRemoteVersion, NoteConflictError, type PinNote, type NoteChange } from '$lib/notesStore';
  import DraftBanner from '../../components/DraftBanner.svelte';
  import { openNoteWindow, findNoteWindow } from '$lib/noteWindows';
  import { openQuickCapture } from '$lib/quickWindow';
  import { requestWindowVisibility } from '$lib/windowVisibility';
  import { loadSettings, saveSettings, isMacPlatform } from '$lib/settings';
  import { registerGlobalShortcuts, unregisterGlobalShortcuts } from '$lib/shortcuts';
  import CenterSettings from '../../components/CenterSettings.svelte';
  import { onAppearance, applyAppearance, applyWindowGlass, effectiveGlass } from '$lib/theme';
  import { defaultSettings, type AppSettings } from '$lib/settings';
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { defaultMarkdownFilename } from '$lib/filename';
  import { reveal, popup, shift, motionReduced } from '$lib/motion';
  import { sparkle, centerOf } from '$lib/celebrate';
  import { tick as settled } from 'svelte';
  import { createQuitGuard } from '$lib/quitGuard';
  import ReminderDialog from '../../components/ReminderDialog.svelte';
  import { checklistProgress, extractOpenTasks, moveCompletedToBottom, toggleTaskAtLine } from '$lib/checklist';
  import NoteColorPicker from '../../components/NoteColorPicker.svelte';
  import { noteBackground, noteTint, noteDot, noteAccent, displayTitle } from '$lib/noteAppearance';
  import { plainExcerpt, shortTime, listTime } from '$lib/excerpt';
  import { sortable, moveAmong, arrange, type SortDrag } from '$lib/sortable';
  import { LIST_WIDTH, clampListWidth } from '$lib/centerLayout';
  import type { NoteTheme } from '$lib/settings';
  import { builtInTemplates, type NoteTemplate } from '$lib/templates';
  import { starredFirst, noQuickFilters, quickFilterCount, passesQuickFilters, tagCounts, highlightParts, matchSnippet, trashDaysLeft } from '$lib/library';
  import VersionDialog from '../../components/VersionDialog.svelte';
  import CenterStats from '../../components/CenterStats.svelte';
  import CommandPalette, { type PaletteCommand } from '../../components/CommandPalette.svelte';
  import TodoBoard from '../../components/TodoBoard.svelte';
  import PixelMark from '../../components/PixelMark.svelte';

  let reminderOpen = $state(false);
  let templatesOpen = $state(false);
  let paletteOpen = $state(false);
  let todoBoardOpen = $state(false);
  let privacyMode = $state(false);
  let ghostIds = $state<Set<string>>(new Set());
  let sourceMode = $state(false);
  let autoFocusId = $state('');
  let due = $state<PinNote[]>([]);
  let fileDropActive = $state(false);
  let readonlyEditor = $state<MilkdownEditor>();
  const quitGuard = createQuitGuard();

  // Raw: rows keep their object identity, so an event re-renders only the changed note.
  let notes = $state.raw<PinNote[]>([]);
  let tabs = $state<string[]>([]);
  let selected = $state('');
  let draft = $state<PinNote>();
  const progress = $derived(checklistProgress(draft?.content ?? ''));
  const charCount = $derived((draft?.content ?? '').replace(/\s/g, '').length);
  let query = $state('');
  let searchInput = $state<HTMLInputElement>();
  let filter = $state('active');
  let sidebar = $state(true);
  let menu = $state(false);
  let moreTrigger = $state<HTMLButtonElement>();
  let filterTrigger = $state<HTMLButtonElement>();
  let overflowTrigger = $state<HTMLButtonElement>();
  let tabsOverflowOpen = $state(false);
  let ctxMenu = $state<{ kind: 'row' | 'tab'; id: string; x: number; y: number } | null>(null);
  let status = $state('正在加载…');
  let busy = $state(false);
  let revision = $state(0);
  let editor = $state<MilkdownEditor>();
  let sourceEditor = $state<SourceEditor>();
  // Draft safety for the open note: a version conflict, or the last failed save.
  let conflict = $state(false);
  let saveError = $state('');
  const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error:\s*/, '');
  let undo = $state<{ id: string; at: number } | null>(null);
  let order = $state<string[]>([]);
  let listWidth = $state(LIST_WIDTH.default);
  let resizing = $state(false);
  let rowDrag = $state<SortDrag | null>(null);
  let clock = $state(Date.now());
  const editedAt = (n: PinNote) => n.editedAt ?? n.updatedAt;
  const positions = new Map<string, { from: number; to: number; scroll: number }>();

  // List summaries (excerpt, to-do counts, search text) are derived once per note version.
  const summaries = new Map<string, { note: PinNote; title: string; excerpt: string; plain: string; tasks: { done: number; total: number }; search: string }>();
  function summary(n: PinNote) {
    let s = summaries.get(n.id);
    if (!s || s.note.content !== n.content || s.note.title !== n.title || s.note.tags !== n.tags) {
      const title = displayTitle(n.title, n.content);
      const plain = plainExcerpt(n.content, 4000, { title: n.title || title });
      s = { note: n, title, plain, excerpt: matchSnippet(plain, '', 100), tasks: checklistProgress(n.content), search: `${n.title}\n${n.content}\n${(n.tags ?? []).join(' ')}`.toLowerCase() };
      summaries.set(n.id, s);
    }
    return s;
  }
  const openTodos = (n: PinNote) => { const t = summary(n).tasks; return t.total - t.done; };
  let quick = $state(noQuickFilters());
  let filterMenu = $state(false);
  let statsOpen = $state(false);
  let versionsOpen = $state(false);
  let tagDraft = $state<string | null>(null);
  const tagsInUse = $derived(tagCounts(notes));
  const arranged = $derived(starredFirst(arrange(notes, order)));
  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return arranged.filter(n =>
      (filter === 'desktop' ? n.lifecycle === 'active' && n.placement === 'desktop' : n.lifecycle === filter) &&
      (!q || summary(n).search.includes(q)) &&
      passesQuickFilters(n, quick, openTodos(n))
    );
  });
  const starredSplitIndex = $derived.by(() => {
    if (filter !== 'active' && filter !== 'desktop') return -1;
    const firstRegular = visible.findIndex(n => !n.starredAt);
    return firstRegular > 0 ? firstRegular : -1;
  });

  // One writer per note: the center edits center notes and desktop notes that are only a
  // capsule/edge tab. An expanded desktop window owns its note until editing is handed back.
  let handoff = $state('');
  let handoffTimer: ReturnType<typeof setTimeout>;
  const editable = $derived(draft?.lifecycle === 'active' && (draft.placement === 'center' || (Boolean(draft.window?.collapsed) && handoff !== draft.id)));
  const desktopEditing = $derived(draft?.lifecycle === 'active' && draft.placement === 'desktop' && !draft.window?.collapsed);

  async function refresh() {
    const all = (await notesSnapshot()).notes;
    notes = Object.values(all).sort((a, b) => editedAt(b) - editedAt(a));
    for (const id of summaries.keys()) if (!all[id]) summaries.delete(id);
    due = notes.filter(n => n.lifecycle === 'active' && n.reminder?.state === 'delivered');
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true;
    try { await action(); } catch (e) { status = String(e); } finally { busy = false; }
  }
  /** Save the open draft now (switch, handoff, window change, quit). A failure keeps the draft and throws. */
  async function persist() {
    editor?.flush();
    if (draft && editable) {
      const pos = editor?.capture();
      if (pos) positions.set(draft.id, pos);
      try { await flushNoteSave(draft.id); saveError = ''; }
      catch (e) { if (!(e instanceof NoteConflictError)) saveError = errorText(e); throw e; }
    }
  }
  async function leaveDraft() {
    try { await persist(); return true; }
    catch (e) { status = e instanceof NoteConflictError ? '先处理这张便签的版本冲突，再切换' : '草稿未保存，仍停留在这张便签'; return false; }
  }
  async function select(id: string, force = false) {
    if (id === selected && draft && !force) { menu = false; return; }
    if (!await leaveDraft()) return;
    const note = (await notesSnapshot()).notes[id];
    if (!note) return;
    selected = id;
    draft = structuredClone($state.snapshot(note));
    conflict = Boolean(noteConflict(id));
    saveError = '';
    if (!tabs.includes(id)) tabs = [...tabs, id];
    revision++;
    menu = false;
  }
  function update(patch: Partial<PinNote>) {
    if (!draft || !editable) return;
    draft = { ...draft, ...patch };
    const id = draft.id;
    scheduleNoteSave(draft, e => {
      if (draft?.id !== id) return;
      if (!e) { saveError = ''; status = '已保存'; }
      else if (!(e instanceof NoteConflictError)) saveError = errorText(e);
    }, 'body');
  }
  async function keepMine() {
    if (!draft) return;
    editor?.flush();
    await keepLocalVersion(draft.id);
    conflict = false; saveError = ''; status = '已保留你的修改并保存';
    await refresh();
  }
  async function takeTheirs(reason = '已载入新版本') {
    if (!draft) return;
    const id = draft.id;
    let last = { title: draft.title, content: draft.content };
    const { remote, copy } = await takeRemoteVersion(id, () => {
      if (draft?.id === id) { editor?.flush(); last = { title: draft.title, content: draft.content }; }
      return last;
    });
    if (!remote || draft?.id !== id) return;
    conflict = false; saveError = ''; draft = structuredClone(remote); revision++;
    await refresh();
    if (copy && !tabs.includes(copy.id)) tabs = [...tabs, copy.id];
    status = copy ? `${reason} · 你的草稿另存为「${displayTitle(copy.title, copy.content)}」` : reason;
  }
  async function retrySave() {
    if (!draft) return;
    editor?.flush();
    await flushNoteSave(draft.id); saveError = ''; status = '已保存';
    await refresh();
  }

  let freshId = $state(''), leavingId = $state(''), trashWobble = $state(false);
  async function create(template?: NoteTemplate) {
    await persist();
    const d = appSettings.defaultNote;
    const note = createNote({
      title: template ? (template.id === 'blank' ? '' : template.title) : '',
      content: template ? template.content : '',
      placement: 'center',
      theme: d.theme,
      customColor: d.customColor,
      opacity: d.opacity,
      alwaysOnTop: d.alwaysOnTop,
    });
    freshId = note.id; setTimeout(() => { if (freshId === note.id) freshId = ''; }, 700);
    autoFocusId = note.id;
    sourceMode = false;
    await saveNoteNow(note);
    await select(note.id);
    if (filter === 'archived' || filter === 'trash') filter = 'active';
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
  }
  function applyTemplate(template: NoteTemplate) {
    if (!draft || !editable) return;
    const nextTitle = template.id === 'blank' ? '' : template.title;
    draft = { ...draft, title: nextTitle, content: template.content, updatedAt: Date.now() };
    revision++;
    scheduleNoteSave(draft, e => {
      if (!e) { saveError = ''; status = `已套用模板：${template.name}`; }
      else if (!(e instanceof NoteConflictError)) saveError = errorText(e);
    }, 'body');
    status = `已套用模板：${template.name}`;
  }
  function toggleSource() {
    if (!draft || !editable) return;
    editor?.flush();
    sourceMode = !sourceMode;
  }
  function moveCompletedBottomAction() {
    if (!draft || !editable) return;
    if (sourceMode) {
      const next = moveCompletedToBottom(draft.content);
      if (next !== draft.content) {
        update({ content: next });
        status = '已完成项已移至底部';
      }
      return;
    }
    editor?.moveCompletedBottom();
    status = '已完成项已移至底部 · 可撤销';
  }
  async function rolloverOpenTasks() {
    if (!draft) return;
    editor?.flush();
    const { openMarkdown, count } = extractOpenTasks(draft.content);
    if (!count) { status = '没有未完成待办'; return; }
    await persist();
    const copy = createNote({
      title: `${displayTitle(draft.title, draft.content)} · 续`,
      content: openMarkdown,
      placement: 'center',
      theme: draft.theme,
      customColor: draft.customColor,
      opacity: draft.opacity,
      alwaysOnTop: draft.alwaysOnTop,
      tags: draft.tags,
    });
    freshId = copy.id; setTimeout(() => { if (freshId === copy.id) freshId = ''; }, 700);
    await saveNoteNow(copy);
    await refresh();
    await select(copy.id);
    if (filter === 'archived' || filter === 'trash') filter = 'active';
    status = `已将 ${count} 条未完成待办转到新便签`;
  }
  async function adjustFontSize(delta: number | 'reset') {
    const current = appSettings.appearance.editorFontSize ?? 14;
    const nextSize = delta === 'reset' ? 14 : Math.min(20, Math.max(12, current + delta));
    if (nextSize === current) { status = `字号 ${nextSize}px`; return; }
    const nextSettings: AppSettings = { ...appSettings, appearance: { ...appSettings.appearance, editorFontSize: nextSize } };
    appSettings = nextSettings;
    applyAppearance(nextSettings.appearance);
    status = `字号 ${nextSize}px`;
    try {
      await emit('appearance-preview', nextSettings.appearance);
      if (await saveSettings(nextSettings) === 'saved') await emit('settings-changed', nextSettings);
    } catch { /* keep local preview */ }
  }
  function titleFromFilename(filePath: string) {
    const base = filePath.split(/[\\/]/).at(-1) ?? '';
    return base.replace(/\.(md|markdown|txt)$/i, '').trim();
  }
  async function importMarkdownEntries(entries: Array<{ title: string; content: string }>) {
    if (!entries.length) return;
    await persist();
    const d = appSettings.defaultNote;
    let lastId = '';
    for (const entry of entries) {
      const created = createNote({
        title: entry.title,
        content: entry.content,
        placement: 'center',
        theme: d.theme,
        customColor: d.customColor,
        opacity: d.opacity,
        alwaysOnTop: d.alwaysOnTop,
      });
      await saveNoteNow(created);
      lastId = created.id;
    }
    await refresh();
    if (lastId) {
      freshId = lastId; setTimeout(() => { if (freshId === lastId) freshId = ''; }, 700);
      await select(lastId);
      if (filter === 'archived' || filter === 'trash') filter = 'active';
    }
    status = `已导入 ${entries.length} 份便签`;
  }
  async function importFilesFromPaths(paths: string[]) {
    const images = paths.filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p));
    if (images.length && draft && editable) {
      editor?.flush();
      const inserted: string[] = [];
      for (const imgPath of images) {
        const rel = await invoke<string>('import_image_file', { path: imgPath });
        const alt = (imgPath.split(/[\\/]/).at(-1) ?? '图片').replace(/\.[^.]+$/, '');
        inserted.push(`![${alt}](${rel})`);
      }
      const sep = draft.content.trim().length ? '\n\n' : '';
      const nextContent = `${draft.content}${sep}${inserted.join('\n\n')}`;
      draft = { ...draft, content: nextContent };
      revision++;
      scheduleNoteSave(draft, e => {
        if (!e) { saveError = ''; status = `已插入 ${inserted.length} 张图片`; }
        else if (!(e instanceof NoteConflictError)) saveError = errorText(e);
      }, 'body');
      status = `已插入 ${inserted.length} 张图片`;
      return;
    }
    const supported = paths.filter(p => /\.(md|markdown|txt)$/i.test(p));
    if (!supported.length) {
      status = '支持拖入 .md / .txt 导入便签，或在编辑便签时拖入图片';
      return;
    }
    const entries: Array<{ title: string; content: string }> = [];
    for (const filePath of supported) {
      const content = await invoke<string>('read_text_file', { path: filePath });
      entries.push({ title: titleFromFilename(filePath), content });
    }
    await importMarkdownEntries(entries);
  }
  async function togglePrivacyMode() {
    const current = await loadSettings();
    const enabled = !current.behavior.hideFromCapture;
    const next: AppSettings = { ...current, behavior: { ...current.behavior, hideFromCapture: enabled } };
    appSettings = next;
    privacyMode = enabled;
    void invoke('set_capture_protection', { enabled }).catch(() => undefined);
    try {
      if (await saveSettings(next) === 'saved') await emit('settings-changed', next);
    } catch (e) { status = `隐私模式未保存：${errorText(e)}`; return; }
    status = enabled ? '隐私模式已开启：截屏与共享屏幕时隐藏窗口' : '已关闭隐私防截屏模式';
  }
  async function toggleTaskInNote(noteId: string, lineIndex: number): Promise<boolean> {
    if (draft?.id === noteId) await persist();
    const fresh = (await loadNotes()).notes[noteId];
    if (!fresh || fresh.lifecycle !== 'active') return false;
    const nextContent = toggleTaskAtLine(fresh.content, lineIndex);
    if (nextContent === fresh.content) return false;
    const updated = await noteOperation(fresh, 'save', {
      expectedRevision: fresh.revision,
      patch: { title: fresh.title, content: nextContent },
    });
    if (draft?.id === noteId && updated) {
      draft = structuredClone(updated);
      revision++;
    }
    await refresh();
    return true;
  }
  function handleBrowserDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      fileDropActive = true;
    }
  }
  function handleBrowserDragLeave(e: DragEvent) {
    if (e.relatedTarget === null) fileDropActive = false;
  }
  async function handleBrowserDrop(e: DragEvent) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    fileDropActive = false;
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(md|markdown|txt)$/i.test(f.name));
    if (!files.length) { status = '仅支持拖入 .md / .markdown / .txt 文件'; return; }
    const entries = await Promise.all(files.map(async f => ({ title: titleFromFilename(f.name), content: await f.text() })));
    await run(() => importMarkdownEntries(entries));
  }
  async function closeTab(id: string) {
    if (id === selected && !await leaveDraft()) return;
    tabs = tabs.filter(t => t !== id);
    if (id === selected) {
      if (tabs.length) await select(tabs.at(-1)!);
      else { editor = undefined; selected = ''; draft = undefined; }
    }
    status = '已关闭标签页';
  }
  async function closeOtherTabs(keepId: string) {
    if (selected !== keepId && !await leaveDraft()) return;
    tabs = tabs.filter(t => t === keepId);
    if (selected !== keepId) await select(keepId);
  }
  async function closeTabsRight(anchorId: string) {
    const idx = tabs.indexOf(anchorId);
    if (idx < 0) return;
    const drop = new Set(tabs.slice(idx + 1));
    if (drop.has(selected) && !await leaveDraft()) return;
    tabs = tabs.slice(0, idx + 1);
    if (drop.has(selected)) await select(anchorId);
  }
  async function desktop(id?: string) {
    const targetId = id ?? draft?.id;
    if (!targetId) return;
    await persist();
    const note = (await loadNotes()).notes[targetId];
    if (!note) return;
    if (ghostIds.has(targetId)) {
      await invoke('exit_note_ghost', { id: targetId }).catch(() => undefined);
    }
    await openNoteWindow(note, { locate: true });
    if (draft?.id === targetId || !id) await select(note.id);
    status = '已展开并高亮桌面便签';
  }
  async function exitGhost(id: string) {
    try {
      await invoke('exit_note_ghost', { id });
      status = '已恢复桌面便签交互';
    } catch (e) { status = `恢复失败：${errorText(e)}`; }
  }
  async function clearAllGhosts() {
    try {
      await invoke('clear_all_ghost');
      status = '已退出全部穿透参考模式';
    } catch (e) { status = `恢复失败：${errorText(e)}`; }
  }
  async function changeColor(theme: NoteTheme, customColor?: string) {
    if (!draft) return;
    const current = (await loadNotes()).notes[draft.id];
    await noteOperation(current, 'appearance', { patch: { theme, ...(customColor ? { customColor } : {}) } });
    draft = { ...draft, theme: current.theme, customColor: current.customColor };
    await refresh();
    status = current.placement === 'desktop' ? '颜色已同步到桌面便签' : '已更新便签颜色';
  }
  async function toggleStar(id: string) {
    const current = (await loadNotes()).notes[id];
    if (!current) return;
    const result = await noteOperation(current, 'appearance', { patch: { starredAt: current.starredAt ? null : Date.now() } });
    if (draft?.id === id) draft = { ...draft, starredAt: result?.starredAt };
    await refresh();
    status = result?.starredAt ? '已收藏，固定在列表顶部' : '已取消收藏';
  }
  async function setTags(tags: string[]) {
    if (!draft) return;
    const current = (await loadNotes()).notes[draft.id];
    const result = await noteOperation(current, 'appearance', { patch: { tags } });
    if (draft?.id === current.id) draft = { ...draft, tags: result?.tags ?? [] };
    await refresh();
  }
  function addTag(text: string) {
    const tag = text.trim().replace(/^#+/, '').trim();
    tagDraft = null;
    if (!tag || !draft) return;
    if ((draft.tags ?? []).some(t => t.toLowerCase() === tag.toLowerCase())) return;
    void run(() => setTags([...(draft!.tags ?? []), tag]));
  }
  async function restoreVersion(at: number) {
    if (!draft) return;
    await persist();
    const id = draft.id;
    const note = (await loadNotes()).notes[id];
    await noteOperation(note, 'revert', { versionAt: at });
    await select(id, true);
    status = '已恢复到所选版本 · 恢复前的内容已保留为一个版本';
  }
  function showTag(tag: string) { quick = { ...noQuickFilters(), tag }; filter = 'active'; statsOpen = false; settingsOpen = false; sidebar = true; }
  async function editHere() {
    if (!draft) return;
    const id = draft.id;
    const win = await findNoteWindow(id);
    if (win) { await emitTo(win.label, 'collapse-note-requested', { id }); status = '正在把编辑移到中心…'; }
    else {
      const note = (await loadNotes()).notes[id];
      await noteOperation(note, 'window', { patch: { window: { ...note.window, collapsed: true } } });
      await refresh();
    }
  }
  async function recall() {
    if (!draft) return;
    const id = draft.id;
    const win = await findNoteWindow(id);
    if (win) await requestWindowVisibility(win.label, false);
    const note = (await loadNotes()).notes[id];
    await noteOperation(note, 'center');
    if (win) await win.destroy().catch(() => {});
    await select(id, true);
    status = '已收回中心 · 编辑历史从此处重新开始';
  }
  async function operation(op: string, targetId?: string) {
    const id = targetId ?? draft?.id;
    if (!id) return;
    menu = false;
    ctxMenu = null;
    if (op === 'purge' && !window.confirm('永久删除这张便签？此操作无法撤销。')) return;
    if (draft?.id === id) await persist();
    if (op === 'archive' || op === 'trash') {
      leavingId = id;
      if (!motionReduced()) await new Promise(r => setTimeout(r, 220));
    }
    try {
      const win = await findNoteWindow(id);
      if (win) await requestWindowVisibility(win.label, false);
      const note = (await loadNotes()).notes[id];
      if (!note) return;
      await noteOperation(note, op);
      if (op === 'trash') { trashWobble = true; setTimeout(() => (trashWobble = false), 700); }
      if (win && ['archive', 'trash', 'restore', 'purge'].includes(op)) await win.destroy().catch(() => {});
      const file = await loadNotes();
      if (op === 'trash' || op === 'archive') {
        const h = file.history?.filter(h => h.note.id === id).at(-1);
        if (h) undo = { id, at: h.at };
      }
      await refresh();
      if (op === 'purge') {
        if (tabs.includes(id)) await closeTab(id);
      } else if (draft?.id === id) {
        await select(id, true);
      }
    } finally {
      leavingId = '';
    }
    status = op === 'purge' ? '已永久删除' : op === 'trash' ? '已移到回收站' : op === 'archive' ? '已归档' : '已恢复到中心';
  }
  async function duplicateNote(id: string) {
    const source = (await loadNotes()).notes[id];
    if (!source) return;
    const copy = createNote({
      title: `${displayTitle(source.title, source.content)}（副本）`,
      content: source.content,
      theme: source.theme,
      customColor: source.customColor,
      opacity: source.opacity,
      alwaysOnTop: source.alwaysOnTop,
      tags: source.tags,
    });
    await saveNoteNow(copy);
    await refresh();
    await select(copy.id);
    status = '已复制为新便签';
  }
  async function copyNoteMarkdown(id: string) {
    const source = draft?.id === id ? draft : notes.find(n => n.id === id);
    if (!source) return;
    if (draft?.id === id) editor?.flush();
    try {
      await navigator.clipboard.writeText(source.content);
      status = '已复制 Markdown 正文';
    } catch { status = '复制失败，请检查剪贴板权限'; }
  }
  function tomorrowMorning() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }
  async function snoozeDue(id: string, at: number | null) {
    const n = (await loadNotes()).notes[id];
    if (!n) return;
    const updated = await noteOperation(n, 'reminder', { at });
    if (draft?.id === id) draft = { ...draft, reminder: updated?.reminder ?? null };
    await refresh();
    status = at == null ? '已关闭提醒' : `已推迟到 ${shortTime(at)}`;
  }
  async function createFromClipboard() {
    let text = '';
    try {
      text = await invoke<string>('read_clipboard_text');
    } catch {
      try { text = await navigator.clipboard.readText(); } catch { status = '无法读取剪贴板'; return; }
    }
    if (!text.trim()) { status = '剪贴板为空'; return; }
    await persist();
    const d = appSettings.defaultNote;
    const note = createNote({
      title: '',
      content: text,
      placement: 'center',
      theme: d.theme,
      customColor: d.customColor,
      opacity: d.opacity,
      alwaysOnTop: d.alwaysOnTop,
    });
    freshId = note.id; setTimeout(() => { if (freshId === note.id) freshId = ''; }, 700);
    autoFocusId = note.id;
    sourceMode = false;
    await saveNoteNow(note);
    if (form.mode !== 'window') await form.expand();
    await select(note.id);
    if (filter === 'archived' || filter === 'trash') filter = 'active';
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
    status = '已从剪贴板新建便签';
  }
  async function dockAllDesktopNotes() {
    const all = Object.values((await loadNotes()).notes).filter(n => n.lifecycle === 'active' && n.placement === 'desktop');
    if (!all.length) { status = '当前没有桌面便签'; return; }
    const pending = all.filter(n => !(n.window?.collapsed && n.window?.edge));
    if (!pending.length) { status = '所有桌面便签都已收纳在侧边'; return; }
    for (const note of pending) {
      let win = await findNoteWindow(note.id);
      if (!win) {
        await openNoteWindow(note);
        win = await findNoteWindow(note.id);
      }
      if (win) {
        await emitTo(win.label, 'dock-note-requested', { id: note.id, side: note.window.edge?.side ?? 'right' });
        await new Promise(r => setTimeout(r, 90));
      }
    }
    status = `已将 ${pending.length} 张桌面便签收纳到侧边`;
  }
  async function arrangeDesktopNotes() {
    const all = Object.values((await loadNotes()).notes)
      .filter(n => n.lifecycle === 'active' && n.placement === 'desktop')
      .sort((a, b) => (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0));
    if (!all.length) { status = '当前没有桌面便签'; return; }
    const expanded = all.filter(n => !n.window?.collapsed);
    const targets = expanded.length ? expanded : all;
    const displays = await form.displays();
    const display = displays[0];
    if (!display) { status = '无法读取显示器工作区'; return; }
    const plan = arrangeDesktopBounds(targets, display);
    for (const target of targets) {
      const bounds = plan.get(target.id);
      if (!bounds) continue;
      let win = await findNoteWindow(target.id);
      if (!win) {
        await openNoteWindow(target);
        win = await findNoteWindow(target.id);
      }
      if (win) await emitTo(win.label, 'arrange-note-requested', { id: target.id, bounds });
    }
    status = `已整齐排列 ${targets.length} 张桌面便签`;
  }
  async function openNoteFromTray(id: string) {
    const target = (await loadNotes()).notes[id];
    if (!target) return;
    if (target.lifecycle === 'active' && target.placement === 'desktop') {
      await desktop(id);
      return;
    }
    if (form.mode !== 'window') await form.expand();
    await select(id);
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
  }
  async function undoLast() {
    if (!undo) return;
    await persist();
    const note = (await loadNotes()).notes[undo.id];
    if (!note) { undo = null; return; }
    await noteOperation(note, 'undo', { historyId: undo.at });
    await select(note.id, true);
    undo = null;
    status = '已撤销';
  }
  async function toggleTheme(event?: MouseEvent) {
    const current = await loadSettings();
    const next = { ...current, appearance: { ...current.appearance, theme: dark ? 'light' as const : 'dark' as const } };
    const start = (document as Document & { startViewTransition?: (update: () => Promise<void>) => { ready: Promise<void> } }).startViewTransition;
    // On solid windows, sweep the new theme in a circle; on frosted glass windows, let the
    // native vibrancy tint and CSS surfaces cross-fade together so they never visually split.
    if (start && !motionReduced() && !glass) {
      const from = event?.currentTarget instanceof Element ? centerOf(event.currentTarget) : { x: innerWidth - 60, y: 22 };
      const radius = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y));
      const transition = start.call(document, async () => { applyAppearance(next.appearance); await settled(); });
      void transition.ready.then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${from.x}px ${from.y}px)`, `circle(${radius}px at ${from.x}px ${from.y}px)`] },
        { duration: 380, easing: 'cubic-bezier(.2,.85,.25,1)', pseudoElement: '::view-transition-new(root)' })).catch(() => undefined);
    } else {
      applyAppearance(next.appearance);
    }
    try { if (await saveSettings(next) === 'saved') await emit('settings-changed', next); }
    catch (e) { status = `主题未保存：${errorText(e)}`; }
  }
  async function openSettings() {
    menu = false;
    ctxMenu = null;
    await persist().catch(() => undefined);
    if (form.mode !== 'window') await form.expand();
    else { await getCurrentWindow().show(); await getCurrentWindow().setFocus(); }
    settingsOpen = true;
  }
  async function exportCurrent() {
    if (!draft) return;
    await persist();
    try {
      const path = await saveDialog({ title: '导出 Markdown', defaultPath: defaultMarkdownFilename(displayTitle(draft.title, draft.content)), filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!path) { status = '已取消导出'; return; }
      const target = path.toLowerCase().endsWith('.md') ? path : `${path}.md`;
      await invoke('write_markdown_file', { path: target, content: draft.content });
      status = `已导出 ${target.split(/[\\/]/).at(-1)}`;
    } catch (error) { status = `导出失败：${error}`; }
  }
  function dropRow(id: string, index: number | null, target: Element | null) {
    if (index !== null) { order = moveAmong(arranged.map(n => n.id), visible.map(n => n.id), id, index); return; }
    if (target?.closest('[data-drop-desktop]')) void run(async () => { await select(id); await desktop(); });
    else if (target?.closest('.tabs')) void run(() => select(id));
  }
  function dropTab(id: string, index: number | null) { if (index !== null) tabs = moveAmong(tabs, tabs, id, index); }
  function resizeList(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement; handle.setPointerCapture(event.pointerId);
    const start = event.clientX, from = shownListWidth; resizing = true;
    const move = (e: PointerEvent) => { listWidth = clampListWidth(from + e.clientX - start); };
    const end = () => { resizing = false; handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }
  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 10;
    if (event.key === 'ArrowLeft') { event.preventDefault(); listWidth = clampListWidth(shownListWidth - step); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); listWidth = clampListWidth(shownListWidth + step); }
  }
  function openContextMenu(event: MouseEvent, kind: 'row' | 'tab', id: string) {
    event.preventDefault();
    event.stopPropagation();
    menu = false; filterMenu = false; tabsOverflowOpen = false;
    const menuW = 196, menuH = kind === 'row' ? 236 : 160;
    ctxMenu = {
      kind, id,
      x: Math.max(8, Math.min(event.clientX, innerWidth - menuW - 8)),
      y: Math.max(8, Math.min(event.clientY, innerHeight - menuH - 8)),
    };
  }
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'k') {
      e.preventDefault();
      if (!settingsOpen && !versionsOpen && !reminderOpen && !templatesOpen) paletteOpen = !paletteOpen;
      return;
    }
    if (key === ',') { e.preventDefault(); void openSettings(); return; }
    if (settingsOpen || statsOpen || todoBoardOpen || paletteOpen || versionsOpen || reminderOpen || templatesOpen) return;
    if (key === 'n' && !e.shiftKey) { e.preventDefault(); void run(() => create()); }
    else if (key === 'f' && e.shiftKey) {
      e.preventDefault();
      sidebar = true;
      requestAnimationFrame(() => { searchInput?.focus(); searchInput?.select(); });
    } else if (key === 'f') {
      e.preventDefault();
      if (draft) {
        if (!editable) readonlyEditor?.openFind();
        else if (sourceMode) sourceEditor?.openFind();
        else editor?.openFind();
      } else {
        sidebar = true;
        requestAnimationFrame(() => { searchInput?.focus(); searchInput?.select(); });
      }
    } else if (key === '=' || key === '+') { e.preventDefault(); void adjustFontSize(1); }
    else if (key === '-') { e.preventDefault(); void adjustFontSize(-1); }
    else if (key === '0') { e.preventDefault(); void adjustFontSize('reset'); }
    else if (key === 'w') {
      e.preventDefault();
      if (selected) void run(() => closeTab(selected));
      else void run(async () => { await persist(); await getCurrentWindow().hide(); });
    } else if (key === 's') { e.preventDefault(); if (draft) void exportCurrent(); }
    else if (key === 't') { e.preventDefault(); void form.setPinned(!form.pinned); }
    else if (key === '/') { e.preventDefault(); toggleSource(); }
    else if (/^[1-9]$/.test(key) && !e.shiftKey && !e.altKey) {
      const targetTab = tabs[Number(key) - 1];
      if (targetTab) { e.preventDefault(); void run(() => select(targetTab)); }
    }
  }
  function scrollTabStrip(e: WheelEvent) {
    if (!tabStrip || tabStrip.scrollWidth <= tabStrip.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      tabStrip.scrollLeft += e.deltaY;
    }
  }

  let visibility = Promise.resolve();
  function toggleDesktop() {
    visibility = visibility.then(async () => {
      const all = Object.values((await loadNotes()).notes).filter(n => n.lifecycle === 'active' && n.placement === 'desktop');
      const windows = await Promise.all(all.map(n => findNoteWindow(n.id)));
      const shown = await Promise.all(windows.map(async w => w && await w.isVisible() ? w : null));
      if (shown.some(Boolean)) await Promise.all(shown.map(w => w ? requestWindowVisibility(w.label, false) : Promise.resolve()));
      else for (const note of all) await openNoteWindow(note);
    }).catch(e => { status = String(e); });
  }

  // ---- Center window form: normal window ⇄ edge handle or strip. ----
  const mac = isMacPlatform();
  let width = $state(960);
  let dark = $state(false);
  const draftAccent = $derived(draft ? noteAccent(draft.theme, draft.customColor, dark) : undefined);
  const totalOpenTodos = $derived(notes.filter(n => n.lifecycle === 'active').reduce((sum, n) => sum + openTodos(n), 0));
  const paletteCommands = $derived<PaletteCommand[]>([
    { id: 'quick', label: '唤起快速速记条（HUD）', hint: `${mac ? '⌘⌥Space' : 'Alt+Shift+Space'}`, keywords: 'quick capture hud suji', icon: Zap, run: () => void openQuickCapture() },
    { id: 'new', label: '新建空白便签', hint: `${mac ? '⌘' : 'Ctrl+'}N`, keywords: 'new create xinjian', icon: Plus, run: () => run(() => create()) },
    { id: 'clipboard', label: '从剪贴板新建便签', keywords: 'clipboard paste jianqieban', icon: ClipboardPaste, run: () => run(createFromClipboard) },
    { id: 'todos', label: '打开跨便签待办汇总', hint: totalOpenTodos ? `${totalOpenTodos} 项未完成` : undefined, keywords: 'todo checklist daiban', icon: ListTodo, run: () => { settingsOpen = false; statsOpen = false; todoBoardOpen = true; } },
    ...(ghostIds.size ? [{ id: 'exit-ghost', label: `退出全部穿透参考模式（${ghostIds.size}）`, keywords: 'ghost chuantou exit', icon: Ghost, run: () => void clearAllGhosts() }] : []),
    ...(draft && draft.lifecycle === 'active' ? [
      { id: 'desktop', label: draft.placement === 'desktop' ? '定位当前桌面便签' : '将当前便签放到桌面', keywords: 'desktop pin zhuomian', icon: Monitor, run: () => run(() => desktop()) },
      { id: 'copy', label: '复制当前便签正文', keywords: 'copy markdown fuzhi', icon: Copy, run: () => { if (draft) void copyNoteMarkdown(draft.id); } },
      { id: 'export', label: '导出当前便签为 Markdown', hint: `${mac ? '⌘' : 'Ctrl+'}S`, keywords: 'export daochu', icon: Download, run: () => void exportCurrent() },
    ] : []),
    { id: 'dock-all', label: '全部桌面便签收纳到侧边', keywords: 'dock edge shouna', icon: PanelRightClose, run: () => run(dockAllDesktopNotes) },
    { id: 'arrange', label: '整齐排列桌面便签', keywords: 'arrange tile pailie', icon: LayoutGrid, run: () => run(arrangeDesktopNotes) },
    { id: 'privacy', label: privacyMode ? '关闭隐私防截屏模式' : '开启隐私防截屏模式', keywords: 'privacy hide share yinsi', icon: EyeOff, run: () => void togglePrivacyMode() },
    { id: 'theme', label: dark ? '切换到浅色外观' : '切换到深色外观', keywords: 'dark light theme zhuti', icon: dark ? Sun : Moon, run: () => void toggleTheme() },
    { id: 'stats', label: '打开写作与待办统计', keywords: 'stats heatmap tongji', icon: ChartColumn, run: () => { settingsOpen = false; todoBoardOpen = false; statsOpen = true; } },
    { id: 'settings', label: '打开设置', hint: `${mac ? '⌘' : 'Ctrl+'},`, keywords: 'settings shezhi', icon: Settings, run: () => void openSettings() },
    ...builtInTemplates.slice(1).map(tpl => ({
      id: `tpl:${tpl.id}`,
      label: `用「${tpl.name}」模板新建`,
      keywords: `template moban ${tpl.name}`,
      icon: LayoutTemplate,
      run: () => run(() => create(tpl)),
    })),
  ]);
  let glassLevel = $state(0);
  const glass = $derived(mac && glassLevel > 0);
  $effect(() => {
    document.documentElement.toggleAttribute('data-glass', glass);
    void applyWindowGlass(glass);
  });

  let appSettings: AppSettings = structuredClone(defaultSettings);
  let trashDays = $state<number>(defaultSettings.trashDays);
  let settingsOpen = $state(false);
  let shortcutStatus = $state('');
  const edgeSnap = () => appSettings.behavior.edgeSnap;
  const form = new CenterForm({
    persist,
    notes: () => notes,
    title: () => draft ? displayTitle(draft.title, draft.content) : (notes.length ? '' : '还没有便签'),
    status: text => (status = text),
    edgeSnap,
    morph,
  });

  let mainEl = $state<HTMLElement>();
  let heldWidth = $state<number | null>(null);
  function morph(m: { size: { width: number; height: number }; scale: number; ms: number; curve: string } | null) {
    const el = mainEl, root = document.documentElement;
    if (!el) return;
    if (!m) {
      heldWidth = null; root.style.removeProperty('overflow');
      for (const p of ['width', 'height', 'transform', 'transform-origin', 'transition']) el.style.removeProperty(p);
      return;
    }
    heldWidth = m.size.width; root.style.overflow = 'hidden';
    el.style.width = `${m.size.width}px`; el.style.height = `${m.size.height}px`; el.style.transformOrigin = '0 0';
    el.style.transition = m.ms ? `transform ${m.ms}ms ${m.curve}` : 'none';
    if (m.ms) void el.offsetWidth;
    el.style.transform = `scale(${m.scale})`;
    if (!m.ms) void el.offsetWidth;
  }
  const layoutWidth = $derived(heldWidth ?? width);
  const narrow = $derived(layoutWidth < 640);
  const shownListWidth = $derived(Math.max(LIST_WIDTH.min, Math.min(listWidth, layoutWidth - 380)));
  let restored = false;
  function restoreSession() {
    const session = form.restore();
    if (!appSettings.behavior.restoreSession) { session.tabs = []; session.selected = ''; }
    tabs = session.tabs.filter(id => notes.some(n => n.id === id));
    order = session.order; listWidth = session.listWidth;
    const last = notes.find(n => n.id === session.selected);
    if (last) { selected = last.id; draft = structuredClone($state.snapshot(last)); if (!tabs.includes(last.id)) tabs = [...tabs, last.id]; revision++; }
    restored = true;
    return session;
  }
  $effect(() => {
    form.tabs = [...tabs]; form.selected = selected; form.order = [...order];
    if (!resizing) form.listWidth = listWidth;
    if (restored && !resizing) form.save();
  });
  $effect(() => { if (narrow) sidebar = false; });
  let tabStrip = $state<HTMLDivElement>();
  let tabsOverflow = $state(false);
  $effect(() => {
    void tabs.length;
    if (!tabStrip) return;
    const strip = tabStrip;
    const measure = () => { tabsOverflow = strip.scrollWidth > strip.clientWidth + 1; };
    const observer = new ResizeObserver(measure); observer.observe(strip); measure();
    return () => observer.disconnect();
  });

  onMount(() => {
    const setup = (async () => {
      await refresh();
      appSettings = await loadSettings(); trashDays = appSettings.trashDays; privacyMode = appSettings.behavior.hideFromCapture;
      void invoke('set_capture_protection', { enabled: appSettings.behavior.hideFromCapture }).catch(() => undefined);
      void invoke<string[]>('list_ghost_notes').then(ids => { ghostIds = new Set(ids); }).catch(() => undefined);
      const registered = await registerGlobalShortcuts(appSettings.shortcuts, { toggleWindow: toggleDesktop, newNote: () => void run(() => create()), quickCapture: () => void openQuickCapture() });
      shortcutStatus = registered.ok || registered.cancelled ? '' : `全局快捷键注册失败：${registered.message}`;
      const hidden = await invoke<boolean>('startup_hidden');
      const session = restoreSession();
      const all = await form.displays();
      if (validWindow(session.window, all)) await form.applyOuter(fitBounds(session.window, all));
      if (form.pinned) await getCurrentWindow().setAlwaysOnTop(true);
      const collapsed = form.mode; form.mode = 'window';
      if (!hidden) {
        if (collapsed === 'handle') await form.collapse(form.dock.side, undefined, form.normal);
        else if (collapsed === 'bar') await form.collapseToBar();
        else await getCurrentWindow().show();
      }
      for (const note of notes.filter(n => n.lifecycle === 'active' && n.placement === 'desktop')) {
        if (!(await invoke<boolean>('startup_hidden'))) await openNoteWindow(note);
      }
      status = '已就绪';
      const { perfConfig } = await import('$lib/perf');
      const perf = await perfConfig();
      if (perf.scenario) void import('$lib/perfScenario').then(m => m.runScenario({ select: id => run(() => select(id)) }));
      if (perf.check) void import('$lib/perfScenario').then(m => m.runWindowCheck(form));
      if (perf.tour) void import('$lib/perfScenario').then(m => m.runTour({ openSettings, closeSettings: () => (settingsOpen = false), form, select: id => run(() => select(id)), reminder: open => (reminderOpen = open) }));
    })().catch(e => { status = String(e); void getCurrentWindow().show(); });
    const changes = listen<NoteChange>('notes-changed', async ({ payload }) => {
      await applyNoteChange(payload); await refresh();
      if (payload.layout) void form.relayoutHandle();
      if (payload.op === 'trash' || payload.op === 'archive') { const h = (await loadNotes()).history?.filter(h => h.note.id === payload.id).at(-1); if (h) undo = { id: payload.id, at: h.at }; }
      const n = payload.note;
      if (!draft || payload.id !== draft.id || !n || payload.op === 'focus') return;
      if (payload.op === 'window') {
        draft = { ...draft, window: n.window }; if (handoff === payload.id) handoff = ''; void form.syncDock(); return;
      }
      if (payload.op === 'appearance') { draft = { ...draft, theme: n.theme, customColor: n.customColor, opacity: n.opacity, alwaysOnTop: n.alwaysOnTop, starredAt: n.starredAt, tags: n.tags }; return; }
      if (payload.op === 'reminder') draft = { ...draft, reminder: n.reminder };
      const verdict = classifyChange(payload, { label: 'main', revision: draft.revision, title: draft.title, content: draft.content, lifecycle: draft.lifecycle, placement: draft.placement });
      if (verdict === 'conflict') {
        if (n.lifecycle !== draft.lifecycle || n.placement !== draft.placement) { void takeTheirs('这张便签已在别处变更').catch(e => { conflict = true; status = `草稿另存失败：${errorText(e)}`; }); return; }
        conflict = true; status = '这张便签刚在别处被修改，你的草稿已保留'; return;
      }
      if (verdict === 'apply') {
        const changed = draft.content !== n.content || draft.placement !== n.placement || draft.lifecycle !== n.lifecycle;
        draft = structuredClone(n); if (changed) revision++;
      }
    });
    const stopConflict = onNoteConflict(id => { if (draft?.id === id) conflict = true; });
    const reminder = listen<{ note: PinNote; error?: string }>('reminder-due', async ({ payload }) => { await refresh(); status = payload.error ? `通知发送失败：${payload.error}` : `提醒：${displayTitle(payload.note.title, payload.note.content)}`; });
    const reminderError = listen<string>('reminder-error', e => { status = `提醒调度失败：${e.payload}`; });
    const newNote = listen('new-note-requested', () => void run(() => create()));
    const clipboardNote = listen('new-note-from-clipboard-requested', () => void run(createFromClipboard));
    const dockAll = listen('dock-all-notes-requested', () => void run(dockAllDesktopNotes));
    const arrangeAll = listen('arrange-desktop-notes-requested', () => void run(arrangeDesktopNotes));
    const privacyToggle = listen('toggle-privacy-mode-requested', () => void togglePrivacyMode());
    const quickCaptureEvent = listen('quick-capture-requested', () => void openQuickCapture());
    const ghostChanged = listen<{ id: string; ghost: boolean }>('ghost-changed', ({ payload }) => {
      const next = new Set(ghostIds);
      if (payload.id === '*' && !payload.ghost) next.clear();
      else if (payload.ghost && payload.id) next.add(payload.id);
      else if (payload.id) next.delete(payload.id);
      ghostIds = next;
    });
    const trayOpen = listen<{ id: string }>('open-note-requested', e => void run(() => openNoteFromTray(e.payload.id)));
    const release = listen<{ id: string }>('release-note-editor', async ({ payload }) => {
      const id = payload.id;
      try {
        if (draft?.id === id) { editor?.flush(); handoff = id; clearTimeout(handoffTimer); handoffTimer = setTimeout(() => { if (handoff === id) handoff = ''; }, 5000); }
        await flushNoteSave(id);
        await answerRelease(id, true);
      } catch (error) {
        if (handoff === id) handoff = '';
        status = `草稿未保存，桌面便签保持收起：${error}`;
        await answerRelease(id, false, `便签中心的草稿未保存：${error}`);
      }
    });
    const dockHello = listen('center-dock-hello', () => void form.syncDock());
    const dockAction = listen<Parameters<CenterForm['dockAction']>[0]>('center-dock-action', ({ payload }) => {
      if (payload.action === 'new') void run(async () => { await form.expand(); await create(); });
      else void form.dockAction(payload);
    });
    const focus = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) void form.adoptShown();
    });
    let displaySignature = '';
    const clockTimer = setInterval(() => (clock = Date.now()), 60000);
    const staleHover = () => { document.documentElement.dataset.staleHover = ''; };
    const freshHover = () => { delete document.documentElement.dataset.staleHover; };
    window.addEventListener('blur', staleHover); window.addEventListener('pointermove', freshHover, { passive: true });
    const displayTimer = setInterval(() => void form.displays().then(all => {
      const signature = JSON.stringify(all);
      if (displaySignature && signature !== displaySignature) { void emit('displays-changed'); void form.relayoutHandle(); }
      displaySignature = signature;
    }).catch(() => undefined), 5000);
    const moved = getCurrentWindow().onMoved(() => form.windowChanged('moved'));
    const resized = getCurrentWindow().onResized(() => form.windowChanged('resized'));
    const dragDrop = getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === 'enter' || payload.type === 'over') {
        if ('paths' in payload && Array.isArray(payload.paths)) {
          fileDropActive = payload.paths.some(p => /\.(md|markdown|txt|png|jpe?g|webp|gif)$/i.test(p));
        }
      } else if (payload.type === 'leave') {
        fileDropActive = false;
      } else if (payload.type === 'drop') {
        fileDropActive = false;
        if (payload.paths.length) void run(() => importFilesFromPaths(payload.paths));
      }
    });
    const agentOpen = listen<{ id: string }>('agent-open-note', e => void run(async () => { await persist(); const n = (await loadNotes()).notes[e.payload.id]; await openNoteWindow(n); if (draft?.id === n.id) await select(n.id, true); }));
    const toggle = listen('toggle-notes-visibility-requested', toggleDesktop);
    const settings = listen('open-settings-requested', () => void openSettings());
    const settingsChanged = listen<AppSettings>('settings-changed', async ({ payload }) => {
      const before = JSON.stringify(appSettings.shortcuts);
      if (payload.behavior?.hideFromCapture !== appSettings.behavior.hideFromCapture) void invoke('set_capture_protection', { enabled: payload.behavior.hideFromCapture }).catch(() => undefined);
      appSettings = payload; trashDays = payload.trashDays; privacyMode = payload.behavior.hideFromCapture;
      if (JSON.stringify(payload.shortcuts) === before) return;
      const registered = await registerGlobalShortcuts(payload.shortcuts, { toggleWindow: toggleDesktop, newNote: () => void run(() => create()), quickCapture: () => void openQuickCapture() });
      shortcutStatus = registered.ok || registered.cancelled ? '' : `全局快捷键注册失败（可能被其他应用占用）：${registered.message}`;
    });
    const stopAppearance = onAppearance((a, isDark) => {
      dark = isDark;
      glassLevel = effectiveGlass(a);
      void getCurrentWindow().setShadow(a.centerShadow === 'standard').catch(() => undefined);
    });
    const close = getCurrentWindow().onCloseRequested(e => { e.preventDefault(); void run(async () => { await persist(); await getCurrentWindow().hide(); }); });
    async function saveForQuit(attempt: number) {
      if (!quitGuard.begin(attempt)) return;
      document.body.inert = true;
      try { await setup; await persist(); await invoke('quit_save_complete', { success: true, attempt }); }
      catch (error) { if (quitGuard.isCurrent(attempt)) document.body.inert = false; status = String(error); await invoke('quit_save_complete', { success: false, attempt }); }
    }
    const quit = listen<number>('save-before-quit', e => void saveForQuit(e.payload));
    void quit.then(async () => { const attempt = await invoke<number | null>('pending_quit'); if (attempt != null) void saveForQuit(attempt); });
    const cancelled = listen<number>('quit-save-cancelled', e => { if (quitGuard.cancel(e.payload)) document.body.inert = false; });
    const failed = listen<number>('quit-save-failed', e => { if (quitGuard.cancel(e.payload)) document.body.inert = false; });
    return () => {
      [changes, newNote, clipboardNote, dockAll, arrangeAll, privacyToggle, quickCaptureEvent, ghostChanged, trayOpen, toggle, settings, settingsChanged, close, quit, cancelled, failed, reminder, reminderError, agentOpen, release, dockHello, dockAction, focus, moved, resized, dragDrop].forEach(p => p.then(f => f()));
      void unregisterGlobalShortcuts(); clearTimeout(handoffTimer); clearInterval(displayTimer); clearInterval(clockTimer);
      window.removeEventListener('blur', staleHover); window.removeEventListener('pointermove', freshHover);
      stopAppearance(); stopConflict();
    };
  });
</script>

<svelte:window bind:innerWidth={width} onkeydown={handleGlobalKeydown} ondragover={handleBrowserDragOver} ondragleave={handleBrowserDragLeave} ondrop={handleBrowserDrop} />
{#if form.snapHint}<div class="snap-hint side-{form.snapHint}" role="status"><span>松手收起到{form.snapHint === 'left' ? '左' : '右'}侧边缘</span></div>{/if}
{#if fileDropActive}
  <div class="drop-overlay" role="status" transition:reveal>
    <div class="drop-card"><FileDown size={22} /><strong>松手导入 Markdown / 文本便签</strong><small>支持 .md / .markdown / .txt</small></div>
  </div>
{/if}
<main bind:this={mainEl} class:folded={!sidebar || narrow} class:narrow class:drawer={narrow && sidebar} class:mac class:glass class:settings-open={settingsOpen} class:stats-open={statsOpen || todoBoardOpen} class:resizing style:--list-w="{shownListWidth}px">
  {#if settingsOpen}<CenterSettings onClose={() => (settingsOpen = false)} {shortcutStatus} onExportCurrent={draft ? () => void exportCurrent() : undefined} />{/if}
  {#if statsOpen && !settingsOpen}<CenterStats {notes} {openTodos} onClose={() => (statsOpen = false)} onTag={showTag} onOpen={id => { statsOpen = false; void run(() => select(id)); }} />{/if}
  {#if todoBoardOpen && !settingsOpen && !statsOpen}<TodoBoard {notes} onToggleTask={toggleTaskInNote} onOpenNote={id => { todoBoardOpen = false; void run(() => select(id)); }} onClose={() => (todoBoardOpen = false)} />{/if}
  {#if paletteOpen}<CommandPalette {notes} commands={paletteCommands} onSelectNote={id => void run(() => select(id))} onClose={() => (paletteOpen = false)} />{/if}
  {#if narrow}<button class="scrim" tabindex="-1" aria-label="关闭列表" onclick={() => (sidebar = false)}></button>{/if}
  <aside inert={!sidebar || settingsOpen || statsOpen || todoBoardOpen} aria-hidden={!sidebar || settingsOpen || statsOpen || todoBoardOpen}>
    <div class="side-inner">
      {#if mac}<div class="titlebar-space" data-tauri-drag-region></div>{/if}
      <div class="search">
        <label class="search-field">
          <Search size={14} />
          <input bind:this={searchInput} aria-label="搜索标题和正文" placeholder="搜索便签" bind:value={query} />
          {#if query}<button type="button" class="search-clear" aria-label="清除搜索" onclick={() => { query = ''; searchInput?.focus(); }}><X size={12} /></button>{/if}
        </label>
        <button aria-label="新建便签" title="新建便签（{mac ? '⌘' : 'Ctrl+'}N）" onclick={() => run(() => create())}><Plus size={16} /></button>
      </div>
      <nav>
        <div class="seg" role="radiogroup" aria-label="便签范围">
          <i class="seg-pill" class:right={filter === 'desktop'} class:hidden={filter !== 'active' && filter !== 'desktop'} aria-hidden="true"></i>
          <button role="radio" aria-label="全部便签" aria-checked={filter === 'active'} class:current={filter === 'active'} onclick={() => (filter = 'active')}>全部</button>
          <button role="radio" aria-label="桌面便签" aria-checked={filter === 'desktop'} class:current={filter === 'desktop'} onclick={() => (filter = 'desktop')}>桌面</button>
        </div>
        {#if order.length}<button class="sort-reset" aria-label="恢复按编辑时间排序" title="恢复按编辑时间排序" onclick={() => (order = [])}><ClockArrowDown size={14} /></button>{/if}
        <button bind:this={filterTrigger} class="filter-toggle" class:on={quickFilterCount(quick) > 0 || filterMenu} aria-label="筛选" title="筛选：收藏、提醒、待办、标签" aria-expanded={filterMenu} onclick={() => (filterMenu = !filterMenu)}>
          <ListFilter size={14} />{#if quickFilterCount(quick)}<span class="count">{quickFilterCount(quick)}</span>{/if}
        </button>
        {#if filterMenu}
          <div class="menu filter-menu" use:popup={{ close: () => (filterMenu = false), trigger: filterTrigger }} transition:reveal role="menu" tabindex="-1">
            <button role="menuitemcheckbox" aria-checked={quick.starred} onclick={() => (quick = { ...quick, starred: !quick.starred })}><Star size={14} />已收藏{#if quick.starred}<Check size={13} />{/if}</button>
            <button role="menuitemcheckbox" aria-checked={quick.reminder} onclick={() => (quick = { ...quick, reminder: !quick.reminder })}><Bell size={14} />有提醒{#if quick.reminder}<Check size={13} />{/if}</button>
            <button role="menuitemcheckbox" aria-checked={quick.todo} onclick={() => (quick = { ...quick, todo: !quick.todo })}><ListTodo size={14} />有未完成待办{#if quick.todo}<Check size={13} />{/if}</button>
            <div class="menu-label">标签</div>
            {#each tagsInUse as item (item.tag)}
              <button role="menuitemradio" aria-checked={quick.tag === item.tag} onclick={() => (quick = { ...quick, tag: quick.tag === item.tag ? '' : item.tag })}><Hash size={14} /><span class="grow">{item.tag}</span><small>{item.count}</small>{#if quick.tag === item.tag}<Check size={13} />{/if}</button>
            {:else}<p class="menu-hint">暂无标签</p>{/each}
            {#if quickFilterCount(quick)}<button class="clear" onclick={() => { quick = noQuickFilters(); filterMenu = false; }}>清除筛选</button>{/if}
          </div>
        {/if}
      </nav>
      {#if quickFilterCount(quick)}
        <div class="chips" aria-label="当前筛选" transition:slide={{ duration: motionReduced() ? 0 : 160 }}>
          {#if quick.starred}<button onclick={() => (quick = { ...quick, starred: false })}>已收藏<X size={11} /></button>{/if}
          {#if quick.reminder}<button onclick={() => (quick = { ...quick, reminder: false })}>有提醒<X size={11} /></button>{/if}
          {#if quick.todo}<button onclick={() => (quick = { ...quick, todo: false })}>有待办<X size={11} /></button>{/if}
          {#if quick.tag}<button onclick={() => (quick = { ...quick, tag: '' })}>#{quick.tag}<X size={11} /></button>{/if}
        </div>
      {/if}
      {#if filter === 'trash'}<p class="trash-hint">{trashDays ? `便签在回收站中保留 ${trashDays} 天，之后自动永久删除。` : '回收站中的便签不会自动删除。'}<button onclick={() => void openSettings()}>更改</button></p>{/if}
      {#if filter === 'desktop' && visible.length}
        <div class="desktop-tools">
          <button type="button" disabled={busy} title="将桌面便签全部收纳到屏幕侧边" onclick={() => void run(dockAllDesktopNotes)}><PanelRightClose size={13} />全部收纳</button>
          <button type="button" disabled={busy} title="从屏幕右侧整齐排列桌面便签" onclick={() => void run(arrangeDesktopNotes)}><LayoutGrid size={13} />整齐排列</button>
        </div>
      {/if}
      <div class="list" use:sortable={{ axis: 'y', onDrag: d => (rowDrag = d), onDrop: dropRow }}>
        {#each due as item (item.id)}
          <div class="due">
            <div class="due-top">
              <span class="due-bell" aria-hidden="true"><Bell size={13} /></span>
              <button class="due-title" onclick={() => run(() => select(item.id))}>{displayTitle(item.title, item.content)}</button>
              <button class="due-close" aria-label="关闭提醒" title="关闭提醒" onclick={() => run(() => snoozeDue(item.id, null))}><X size={13} /></button>
            </div>
            <div class="due-snooze">
              <button onclick={() => run(() => snoozeDue(item.id, Date.now() + 10 * 60000))}>+10分</button>
              <button onclick={() => run(() => snoozeDue(item.id, Date.now() + 3600000))}>+1时</button>
              <button onclick={() => run(() => snoozeDue(item.id, tomorrowMorning()))}>明天</button>
            </div>
          </div>
        {/each}
        {#each visible as note, i (note.id)}
          {@const info = summary(note)}{@const tasks = info.tasks}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div animate:shift class="note-row-wrap" data-sort-id={note.id} class:after-starred={i === starredSplitIndex} class:fresh={freshId === note.id} class:leaving={leavingId === note.id}
            oncontextmenu={e => openContextMenu(e, 'row', note.id)}>
            <button class="note-row" class:chosen={selected === note.id} class:on-desktop={note.placement === 'desktop' && note.lifecycle === 'active'}
              aria-current={selected === note.id ? 'true' : undefined}
              onclick={() => run(async () => { await select(note.id); if (narrow) sidebar = false; })}>
              <span class="row-heading">
                <i class="note-dot" style:background={noteDot(note.theme, note.customColor)}></i>
                <b>{#each highlightParts(info.title, query) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}</b>
                {#if note.starredAt}<Star size={11} class="starred" aria-label="已收藏" />{/if}
                {#if ghostIds.has(note.id)}<span class="ghost-tag" title="点击定位或左侧按钮退出穿透">穿透</span>{/if}
                {#if note.placement === 'desktop' && note.lifecycle === 'active'}<Monitor size={12} class="desk-mark" aria-label="在桌面上" />{/if}
                <time datetime={new Date(editedAt(note)).toISOString()} title="编辑于 {shortTime(editedAt(note), clock)}">{listTime(editedAt(note), clock)}</time>
              </span>
              <small>{#if query.trim()}{#each highlightParts(matchSnippet(info.plain, query, 100), query) as part}{#if part.hit}<mark>{part.text}</mark>{:else}{part.text}{/if}{/each}{:else}{info.excerpt || (note.content.trim() ? '打开查看内容' : '暂无正文')}{/if}</small>
              {#if tasks.total || note.tags?.length}
                <span class="row-meta">
                  {#if tasks.total}<small class="list-progress">{tasks.total - tasks.done ? `${tasks.total - tasks.done} 项待办` : '待办已完成'}</small>{/if}
                  {#each (note.tags ?? []).slice(0, 3) as tag}<small class="row-tag">#{tag}</small>{/each}
                </span>
              {/if}
            </button>
            {#if note.lifecycle === 'active'}
              <span class="row-quick">
                <button type="button" class:lit={Boolean(note.starredAt)} title={note.starredAt ? '取消收藏' : '收藏'} aria-label={note.starredAt ? '取消收藏' : '收藏'} onclick={e => { e.stopPropagation(); void run(() => toggleStar(note.id)); }}><Star size={12} /></button>
                <button type="button" title={note.placement === 'desktop' ? '定位桌面窗口' : '放到桌面'} aria-label={note.placement === 'desktop' ? '定位桌面窗口' : '放到桌面'} onclick={e => { e.stopPropagation(); void run(() => desktop(note.id)); }}><Monitor size={12} /></button>
              </span>
            {/if}
          </div>
          {:else}<p class="empty">{query ? '没有找到便签' : filter === 'archived' ? '暂无归档' : filter === 'trash' ? '回收站为空' : filter === 'desktop' ? '桌面上没有便签' : '暂无便签'}</p>{/each}
      </div>
      <footer>
        <div class="footer-folders">
          <button aria-pressed={filter === 'archived'} onclick={() => (filter = 'archived')}><Archive size={13} />归档</button>
          <button aria-pressed={filter === 'trash'} onclick={() => (filter = 'trash')}><span class="trash-icon" class:wobble={trashWobble}><Trash2 size={13} /></span>回收站</button>
        </div>
        <div class="footer-icons">
          <button class="todo-btn" aria-label="待办汇总" title="待办汇总（跨便签清单）" onclick={() => { settingsOpen = false; statsOpen = false; todoBoardOpen = true; }}>
            <ListTodo size={15} />{#if totalOpenTodos}<span class="todo-badge">{totalOpenTodos > 99 ? '99+' : totalOpenTodos}</span>{/if}
          </button>
          <button aria-pressed={privacyMode} aria-label="共享屏幕时隐藏" title={privacyMode ? '关闭共享时隐藏' : '共享屏幕时隐藏'} onclick={() => void togglePrivacyMode()}><EyeOff size={15} /></button>
          <button class="stats-open" aria-label="记录概览" title="记录概览" onclick={() => { settingsOpen = false; todoBoardOpen = false; statsOpen = true; }}><ChartColumn size={15} /></button>
          <button aria-label="设置" title="设置（{mac ? '⌘' : 'Ctrl+'},）" onclick={() => void openSettings()}><Settings size={15} /></button>
        </div>
      </footer>
    </div>
  </aside>
  {#if !narrow}<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div class="list-resizer" role="separator" aria-orientation="vertical" aria-label="调整列表宽度" aria-valuemin={LIST_WIDTH.min} aria-valuemax={LIST_WIDTH.max} aria-valuenow={shownListWidth} tabindex={sidebar ? 0 : -1} title="拖动调整列表宽度 · 双击恢复默认" hidden={!sidebar || settingsOpen || statsOpen} onpointerdown={resizeList} onkeydown={resizeKey} ondblclick={() => (listWidth = LIST_WIDTH.default)}></div>{/if}
  <section class="work" class:ink={draft?.theme === 'ink'}
    style:--pin-bg={draft ? noteBackground(draft.theme, draft.customColor) : 'var(--surface)'}
    style:--note-tint={draft ? noteTint(draft.theme, draft.customColor) : undefined}
    style:--pin-accent={draftAccent ?? undefined}
    style:--pin-on-accent={draft?.theme === 'ink' || dark ? '#0b1530' : '#ffffff'}
    inert={busy || settingsOpen || statsOpen || todoBoardOpen}>
    <header class="tabs" data-tauri-drag-region>
      <button class="list-toggle" aria-label={sidebar ? '隐藏列表' : '显示列表'} title={sidebar ? '隐藏列表' : '显示列表'} onclick={() => (sidebar = !sidebar)}><PanelLeft size={16} /></button>
      <div class="tab-strip" bind:this={tabStrip} data-tauri-drag-region onwheel={scrollTabStrip} use:sortable={{ axis: 'x', onDrop: dropTab }}>
        {#each tabs as id (id)}
          {@const tabNote = notes.find(n => n.id === id)}
          {@const tabLabel = tabNote ? displayTitle(tabNote.title, tabNote.content) : '未命名便签'}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="tab" data-sort-id={id} class:current={selected === id} class:inactive={tabNote && tabNote.lifecycle !== 'active'} animate:shift
            oncontextmenu={e => openContextMenu(e, 'tab', id)}>
            <button class="tab-title" title={tabLabel} aria-current={selected === id ? 'true' : undefined} onclick={() => run(() => select(id))}>
              {#if tabNote?.lifecycle === 'archived'}<Archive size={11} class="tab-state" />{:else if tabNote?.lifecycle === 'trash'}<Trash2 size={11} class="tab-state" />{/if}
              <span>{tabLabel}</span>
            </button>
            <button class="tab-close" aria-label="关闭标签页" onclick={() => run(() => closeTab(id))}><X size={13} /></button>
          </div>
        {/each}
      </div>
      {#if tabsOverflow}
        <div class="overflow-wrap">
          <button bind:this={overflowTrigger} class="overflow-btn" aria-label="更多工作便签" title="全部打开的标签页" aria-expanded={tabsOverflowOpen} onclick={() => (tabsOverflowOpen = !tabsOverflowOpen)}>
            <ChevronDown size={14} />
          </button>
          {#if tabsOverflowOpen}
            <div class="menu overflow-menu" role="menu" tabindex="-1" use:popup={{ close: () => (tabsOverflowOpen = false), trigger: overflowTrigger }} transition:reveal>
              {#each tabs as id (id)}
                {@const tabNote = notes.find(n => n.id === id)}
                <button role="menuitem" class:chosen={selected === id} aria-current={selected === id ? 'true' : undefined} onclick={() => { tabsOverflowOpen = false; void run(() => select(id)); }}>
                  <i class="note-dot" style:background={tabNote ? noteDot(tabNote.theme, tabNote.customColor) : '#a1a1aa'}></i>
                  <span class="grow">{tabNote ? displayTitle(tabNote.title, tabNote.content) : '未命名便签'}</span>
                  {#if selected === id}<Check size={13} />{/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <div class="window-tools">
        <button class="theme-switch" class:dark role="switch" aria-checked={dark} aria-label="深色模式" title={dark ? '切换到浅色' : '切换到深色'} onclick={e => void toggleTheme(e)}><span class="knob">{#if dark}<Moon size={11} />{:else}<Sun size={11} />{/if}</span></button>
        <button class="pin" class:on={form.pinned} aria-pressed={form.pinned} aria-label={form.pinned ? '取消置顶便签中心' : '置顶便签中心'} title={form.pinned ? '取消置顶便签中心' : '置顶便签中心'} onclick={() => form.setPinned(!form.pinned)}><PixelMark variant="pin" size={16} filled={form.pinned} /></button>
        <button aria-label="收起到左侧边缘" title="收起到左侧边缘 · 也可以把窗口拖到屏幕左边缘" onclick={() => form.collapse('left')}><ChevronsLeft size={16} /></button>
        <button aria-label="收起到右侧边缘" title="收起到右侧边缘 · 也可以把窗口拖到屏幕右边缘" onclick={() => form.collapse('right')}><ChevronsRight size={16} /></button>
        <button aria-label="收起为小条" title="收起为小条" onclick={() => form.collapseToBar()}><Minimize2 size={15} /></button>
      </div>
    </header>
    <div class="work-body">
      {#if draft}
        <div class="title-row" class:no-tags={!draft.tags?.length && tagDraft === null}>
          <input aria-label="便签标题" placeholder={displayTitle(draft.title, draft.content)} value={draft.title} readonly={!editable} oninput={e => update({ title: e.currentTarget.value })} />
          {#if draft.lifecycle === 'active'}
            <button class="star" class:on={Boolean(draft.starredAt)} aria-pressed={Boolean(draft.starredAt)} aria-label={draft.starredAt ? '取消收藏' : '收藏'} title={draft.starredAt ? '取消收藏' : '收藏：固定在列表顶部'} onclick={e => { const el = e.currentTarget; if (!draft?.starredAt) { const c = centerOf(el); sparkle(c.x, c.y, '#e9a23b'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); } void run(() => toggleStar(draft!.id)); }}><Star size={16} /></button>
            <NoteColorPicker theme={draft.theme} customColor={draft.customColor} onChange={changeColor} />
          {/if}
          {#if draft.reminder}<button class="time" onclick={() => (reminderOpen = true)}>{shortTime(draft.reminder.at)}</button>{/if}
          {#if draft.lifecycle === 'active'}
            <button class="desktop" data-drop-desktop class:drop-target={rowDrag && rowDrag.index === null} disabled={busy} onclick={() => run(() => desktop())}><Monitor size={15} />{draft.placement === 'desktop' ? '定位窗口' : '放到桌面'}</button>
          {/if}
          <div class="more-wrap">
            <button bind:this={moreTrigger} class="more" aria-label="更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={menu} onclick={() => (menu = !menu)}><MoreHorizontal size={16} /></button>
            {#if menu}
              <div class="menu more-menu" use:popup={{ close: () => (menu = false), trigger: moreTrigger }} transition:reveal role="menu" tabindex="-1">
                {#if draft.lifecycle === 'active'}
                  <button role="menuitem" onclick={() => { menu = false; reminderOpen = true; }}><Bell size={14} />设置提醒</button>
                  {#if editable}
                    <button role="menuitem" onclick={() => { menu = false; editor?.flush(); templatesOpen = true; }}><LayoutTemplate size={14} />模板</button>
                    <button role="menuitem" onclick={() => { menu = false; toggleSource(); }}><Code2 size={14} />{sourceMode ? '返回可视化编辑' : 'Markdown 源码'}</button>
                  {/if}
                  <button role="menuitem" onclick={() => { menu = false; void persist().catch(() => undefined).then(() => (versionsOpen = true)); }}><History size={14} />历史版本</button>
                  <button role="menuitem" onclick={() => { menu = false; if (draft) void copyNoteMarkdown(draft.id); }}><Copy size={14} />复制正文</button>
                  <button role="menuitem" onclick={() => { menu = false; void exportCurrent(); }}><Download size={14} />导出 Markdown</button>
                  {#if editable && progress.done > 0 && progress.done < progress.total}<button role="menuitem" onclick={() => { moveCompletedBottomAction(); menu = false; }}><ArrowDownToLine size={14} />已完成项沉底</button>{/if}
                  {#if progress.total - progress.done > 0}<button role="menuitem" onclick={() => { menu = false; void run(rolloverOpenTasks); }}><CornerDownRight size={14} />未完成项转到新便签</button>{/if}
                  {#if editable && !sourceMode && progress.done}<button role="menuitem" onclick={() => { editor?.clearCompleted(); menu = false; }}><CheckCheck size={14} />移除已完成项（可撤销）</button>{/if}
                  <hr aria-hidden="true" />
                  {#if draft.placement === 'desktop'}<button role="menuitem" onclick={() => run(recall)}><MonitorDown size={14} />收回中心</button>{/if}
                  <button role="menuitem" onclick={() => run(() => operation('archive'))}><Archive size={14} />归档</button>
                  <button role="menuitem" class="danger" onclick={() => run(() => operation('trash'))}><Trash2 size={14} />移到回收站</button>
                {:else}
                  <button role="menuitem" onclick={() => run(() => operation('restore'))}><ArchiveRestore size={14} />恢复到中心</button>
                  {#if draft.lifecycle === 'trash'}<button role="menuitem" class="danger" onclick={() => run(() => operation('purge'))}><Trash2 size={14} />永久删除</button>{/if}
                {/if}
                <hr aria-hidden="true" />
                <button role="menuitem" onclick={() => run(async () => { if (!draft) return; menu = false; await duplicateNote(draft.id); })}><CopyPlus size={14} />保留草稿为新便签</button>
                <button role="menuitem" onclick={() => run(async () => { if (!draft) return; menu = false; editor?.flush(); const fresh = (await loadNotes()).notes[draft.id]; if (hasLocalEdits(draft.id) && !window.confirm('放弃本地草稿并载入已保存版本？')) return; discardPendingSave(draft.id); conflict = false; saveError = ''; draft = fresh; revision++; })}><RefreshCw size={14} />重新载入已保存版本</button>
              </div>
            {/if}
          </div>
          {#if draft.tags?.length || draft.lifecycle === 'active'}
            <div class="tag-row" aria-label="标签">
              {#each draft.tags ?? [] as tag (tag)}
                <span class="tag"><button class="tag-name" title="在列表中只看「{tag}」" onclick={() => showTag(tag)}>#{tag}</button>{#if draft.lifecycle === 'active'}<button class="tag-remove" aria-label="移除标签 {tag}" onclick={() => run(() => setTags((draft!.tags ?? []).filter(t => t !== tag)))}><X size={11} /></button>{/if}</span>
              {/each}
              {#if draft.lifecycle === 'active'}
                {#if tagDraft !== null}<!-- svelte-ignore a11y_autofocus -->
                  <input class="tag-input" list="pinnote-tags" aria-label="新标签" placeholder="标签名，回车添加" maxlength="20" autofocus bind:value={tagDraft}
                    onkeydown={e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); addTag(tagDraft ?? ''); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); tagDraft = null; } }}
                    onblur={() => { if (tagDraft?.trim()) addTag(tagDraft); else tagDraft = null; }} />
                  <datalist id="pinnote-tags">{#each tagsInUse.filter(t => !(draft?.tags ?? []).includes(t.tag)) as item}<option value={item.tag}></option>{/each}</datalist>
                {:else}<button class="tag-add" aria-label="添加标签" title="添加标签" onclick={() => (tagDraft = '')}><Hash size={12} />{draft.tags?.length ? '' : '添加标签'}</button>{/if}
              {/if}
            </div>
          {/if}
        </div>
        {#if editable}
          <div class="editor-area">
            <DraftBanner {conflict} error={saveError} busy={busy} onKeepMine={() => run(keepMine)} onTakeTheirs={() => run(() => takeTheirs())} onRetry={() => run(retrySave)} />
            {#key `${selected}:${revision}`}
              <div class="work-pane">
                {#if sourceMode}
                  <SourceEditor bind:this={sourceEditor} value={draft.content} autoFocus={autoFocusId === selected} onChange={content => update({ content })} />
                {:else}
                  <MilkdownEditor bind:this={editor} value={draft.content} autoFocus={autoFocusId === selected} onChange={content => { if (autoFocusId === selected) autoFocusId = ''; update({ content }); }} onEdit={() => markEdited(selected)} onSettled={() => markSettled(selected)} initialPosition={positions.get(selected)} onReminder={() => (reminderOpen = true)} onArchive={() => void run(() => operation('archive'))} />
                {/if}
              </div>
            {/key}
          </div>
        {:else}
          <div class="preview" transition:reveal>
            {#if desktopEditing}<div class="notice">{#if ghostIds.has(draft.id)}正在桌面穿透参考模式 <button onclick={() => void exitGhost(draft!.id)}><Ghost size={13} />退出穿透</button>{:else}正在桌面窗口编辑 <button onclick={() => run(editHere)}><PenLine size={13} />在这里编辑</button>{/if}<button onclick={() => run(recall)}>收回中心</button></div>{/if}
            {#if draft.lifecycle !== 'active'}<div class="notice">{draft.lifecycle === 'trash' ? (trashDaysLeft(draft.trashedAt, trashDays, clock) ? `已在回收站，${trashDaysLeft(draft.trashedAt, trashDays, clock)} 天后自动永久删除` : '已在回收站') : '已归档'} <button onclick={() => run(() => operation('restore'))}>恢复</button></div>{/if}
            {#key `${selected}:${revision}`}<MilkdownEditor bind:this={readonlyEditor} readonly value={draft.content} onChange={() => {}} onReminder={draft.lifecycle === 'active' ? () => (reminderOpen = true) : undefined} />{/key}
          </div>
        {/if}
      {:else}
        <div class="empty-work">
          <span class="empty-icon"><PixelMark variant="brand" size={32} /></span>
          <p>没有打开的便签</p>
          <div class="empty-actions">
            <button class="primary" onclick={() => run(() => create())}><Plus size={15} />新建便签</button>
            {#each builtInTemplates.slice(1, 3) as tpl (tpl.id)}
              <button class="quick-tpl" onclick={() => run(() => create(tpl))}>{tpl.name}</button>
            {/each}
          </div>
          <button class="empty-command" onclick={() => (paletteOpen = true)}>命令面板 <kbd>{mac ? '⌘K' : 'Ctrl+K'}</kbd></button>
        </div>
      {/if}
      <div class="status" role="status">
        <span class="status-left">{status}{#if undo}<button onclick={() => run(undoLast)}>撤销移除</button>{/if}</span>
        {#if draft}
          <span class="status-right">
            <span>{charCount} 字</span>
            <span class="sep">·</span>
            <span>{shortTime(editedAt(draft), clock)}</span>
            {#if editable}
              <button class="status-toggle" class:on={sourceMode} title="切换 Markdown 源码（{mac ? '⌘' : 'Ctrl+'}/）" onclick={toggleSource}><Code2 size={12} />{sourceMode ? '可视化' : '源码'}</button>
            {/if}
          </span>
        {/if}
      </div>
    </div>
  </section>
</main>

{#if ctxMenu}
  {@const ctxNote = notes.find(n => n.id === ctxMenu!.id)}
  <div class="menu ctx-menu" role="menu" tabindex="-1" style:left="{ctxMenu.x}px" style:top="{ctxMenu.y}px" use:popup={() => (ctxMenu = null)} transition:reveal>
    {#if ctxMenu.kind === 'row' && ctxNote}
      {#if ctxNote.lifecycle === 'active'}
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => desktop(id)); }}><Monitor size={14} />{ctxNote.placement === 'desktop' ? '定位桌面窗口' : '放到桌面'}</button>
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => toggleStar(id)); }}><Star size={14} />{ctxNote.starredAt ? '取消收藏' : '收藏'}</button>
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void copyNoteMarkdown(id); }}><Copy size={14} />复制 Markdown</button>
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => duplicateNote(id)); }}><CopyPlus size={14} />复制副本</button>
        <hr aria-hidden="true" />
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => operation('archive', id)); }}><Archive size={14} />归档</button>
        <button role="menuitem" class="danger" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => operation('trash', id)); }}><Trash2 size={14} />移到回收站</button>
      {:else}
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => operation('restore', id)); }}><ArchiveRestore size={14} />恢复到中心</button>
        {#if ctxNote.lifecycle === 'trash'}
          <button role="menuitem" class="danger" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => operation('purge', id)); }}><Trash2 size={14} />永久删除</button>
        {/if}
      {/if}
    {:else if ctxMenu.kind === 'tab' && ctxNote}
      {#if ctxNote.lifecycle === 'active'}
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => desktop(id)); }}><Monitor size={14} />{ctxNote.placement === 'desktop' ? '定位桌面窗口' : '放到桌面'}</button>
      {/if}
      <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => closeTab(id)); }}><X size={14} />关闭标签页</button>
      {#if tabs.length > 1}
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => closeOtherTabs(id)); }}><X size={14} />关闭其他标签页</button>
      {/if}
      {#if tabs.indexOf(ctxNote.id) < tabs.length - 1}
        <button role="menuitem" onclick={() => { const id = ctxNote.id; ctxMenu = null; void run(() => closeTabsRight(id)); }}><X size={14} />关闭右侧标签页</button>
      {/if}
    {/if}
  </div>
{/if}

{#if versionsOpen && draft}<VersionDialog id={draft.id} title={displayTitle(draft.title, draft.content)} current={draft.content} onRestore={restoreVersion} onClose={() => (versionsOpen = false)} />{/if}
{#if reminderOpen && draft}<ReminderDialog currentAt={draft.reminder?.at} onClose={() => (reminderOpen = false)} onSet={async at => { await persist(); const note = (await loadNotes()).notes[draft!.id]; await noteOperation(note, 'reminder', { at }); draft = note; await refresh(); }} />{/if}
<TemplateDialog open={templatesOpen && Boolean(draft && editable)} hasContent={Boolean(draft?.content.trim().length)} onApply={applyTemplate} onClose={() => (templatesOpen = false)} />

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; font: 13px/1.55 var(--font); color: var(--text); background: var(--surface); -webkit-font-smoothing: antialiased; }
  :global(:root[data-glass] body) { background: transparent; }

  main.glass { --accent-soft: color-mix(in srgb, var(--accent) 18%, transparent); --accent-soft-strong: color-mix(in srgb, var(--accent) 26%, transparent); }
  main.glass aside {
    background: color-mix(in srgb, var(--surface-muted) var(--glass-chrome, 56%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge), inset -1px 0 0 var(--glass-divider-light);
  }
  main.glass .tabs {
    background: color-mix(in srgb, var(--surface-sunken) var(--glass-chrome, 56%), transparent);
    box-shadow: inset 0 1px 0 var(--glass-edge);
  }
  main.glass .work { background: transparent; }
  main.glass .work-body { background: color-mix(in srgb, var(--pin-bg) var(--glass-page, 85%), transparent); }
  main.glass.narrow aside { background: var(--material); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur); }
  main.glass.settings-open > aside, main.glass.settings-open > .work,
  main.glass.stats-open > aside, main.glass.stats-open > .work { visibility: hidden; }

  main {
    position: relative;
    --pin-text: var(--text); --pin-heading: var(--text-strong); --pin-muted: var(--muted);
    --pin-accent: var(--accent); --pin-accent-strong: var(--accent-strong); --pin-border: var(--border);
    --pin-active: var(--accent-soft); --pin-bg: var(--surface);
    display: grid; grid-template-columns: var(--list-w, 230px) minmax(0, 1fr); height: 100vh; overflow: hidden;
    transition: grid-template-columns var(--motion) var(--ease-out);
  }
  main.folded { grid-template-columns: 0px minmax(0, 1fr); }
  main.resizing { transition: none; cursor: col-resize; user-select: none; }

  .list-resizer { position: absolute; z-index: 5; top: 0; bottom: 0; left: calc(var(--list-w, 230px) - 4px); width: 8px; cursor: col-resize; touch-action: none; }
  .list-resizer::after { content: ''; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px; background: transparent; transition: background var(--motion-fast); }
  .list-resizer:hover::after, main.resizing .list-resizer::after, .list-resizer:focus-visible::after { background: var(--accent); }
  .list-resizer:focus-visible { outline: none; }
  :global([data-center-shadow="light"]) main { box-shadow: inset 0 0 0 1px var(--border); }

  aside { grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; overflow: hidden; display: block; background: var(--surface-muted); border-right: 1px solid var(--hairline); }
  .side-inner { width: var(--list-w, 230px); height: 100%; display: flex; flex-direction: column; }
  .titlebar-space { height: 36px; flex: 0 0 auto; }

  .search { display: flex; align-items: center; gap: 6px; padding: 12px 10px 8px; color: var(--muted); }
  main.mac .search { padding-top: 2px; }
  .search-field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 8px; border-radius: var(--radius); background: var(--fill); cursor: text; transition: box-shadow var(--motion-fast), background var(--motion-fast); }
  .search-field:focus-within { box-shadow: 0 0 0 3px var(--focus-ring); }
  .search input { min-width: 0; width: 100%; background: transparent; color: var(--text); }
  .search input:focus { box-shadow: none; }
  .search input::placeholder { color: var(--subtle); }
  .search .search-clear { flex: 0 0 18px; width: 18px; height: 18px; padding: 0; border-radius: 50%; color: var(--muted); }
  .search .search-clear:hover { color: var(--text); background: var(--hover-strong); }

  input { font: inherit; border: 0; outline: 0; color: inherit; }
  input:focus { box-shadow: 0 1px var(--accent); }
  button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: var(--radius-sm); background: transparent; color: inherit; padding: 6px 8px; font: inherit; cursor: pointer; transition: background var(--motion-fast), color var(--motion-fast), transform var(--motion-fast); }
  button:hover { background: var(--hover); }
  button:active { transform: scale(.96); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  button:disabled { opacity: .5; cursor: wait; }

  nav { position: relative; display: flex; padding: 0 10px 10px; gap: 6px; }
  nav button { font-size: 12px; flex: 1; }
  .seg { position: relative; flex: 1; display: flex; min-width: 0; padding: 2px; gap: 2px; border-radius: var(--px-radius); background: var(--fill); box-shadow: inset 0 0 0 1px var(--border); }
  .seg button { position: relative; z-index: 1; flex: 1; min-width: 0; height: 24px; padding: 0 6px; border-radius: var(--px-radius); color: var(--muted); white-space: nowrap; transition: color var(--motion-fast); }
  .seg button:hover { background: transparent; color: var(--text); }
  .seg button:active { transform: none; }
  .seg button.current { color: var(--text); font-weight: 500; }
  .seg-pill { position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc(50% - 3px); border-radius: var(--px-radius); background: var(--px-selected); box-shadow: var(--px-selected-edge); transition: transform var(--motion) var(--ease-out), opacity var(--motion-fast); pointer-events: none; }
  .seg-pill.right { transform: translateX(calc(100% + 2px)); }
  .seg-pill.hidden { opacity: 0; }
  nav .sort-reset, nav .filter-toggle { position: relative; flex: 0 0 28px; padding: 0; border-radius: var(--radius); color: var(--muted); }
  nav .sort-reset:hover, nav .filter-toggle:hover { color: var(--text); background: var(--hover-strong); }
  nav .filter-toggle.on { color: var(--accent); background: var(--accent-soft); }
  .filter-toggle .count { position: absolute; top: 1px; right: 1px; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 9px; line-height: 13px; font-weight: 600; }

  .filter-menu { top: 36px; left: 10px; right: auto; width: min(220px, calc(var(--list-w, 230px) - 16px)); max-height: min(360px, 60vh); overflow: auto; transform-origin: top right; }
  .menu.filter-menu button { display: flex; align-items: center; gap: 8px; justify-content: flex-start; }
  .menu.filter-menu button :global(svg:last-child:not(:first-child)) { margin-left: auto; color: var(--accent); }
  .menu .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu.filter-menu small { color: var(--subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
  .menu.filter-menu .clear { margin-top: 4px; border-top: 1px solid var(--hairline); border-radius: 0 0 var(--radius-sm) var(--radius-sm); color: var(--accent); }
  .menu-label { padding: 8px 8px 2px; font-size: 11px; color: var(--subtle); }
  .menu-hint { margin: 0; padding: 4px 8px 8px; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 10px 8px; }
  .chips button { gap: 3px; padding: 2px 6px 2px 8px; border-radius: 999px; font-size: 11px; color: var(--accent); background: var(--accent-soft); }
  .chips button:hover { background: var(--accent-soft-strong); }

  .list { flex: 1; overflow: auto; padding: 0 10px; }
  .note-row-wrap { position: relative; margin: 0 0 2px; }
  .note-row-wrap.after-starred { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--hairline); }
  .note-row-wrap.after-starred .row-quick { top: 14px; }
  .note-row-wrap.fresh { animation: row-in var(--motion-celebrate) var(--ease-spring); }
  .note-row-wrap.leaving { animation: row-out 220ms var(--ease-out) forwards; pointer-events: none; }
  @keyframes row-in { from { opacity: 0; transform: translateY(-10px) scale(.97); } }
  @keyframes row-out { to { opacity: 0; transform: translateX(-24px); } }

  .note-row { position: relative; display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: var(--px-radius);
    transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast), transform 100ms ease; }
  .note-row.chosen, .menu button.chosen { background: var(--px-selected); color: var(--text-strong); box-shadow: var(--px-selected-edge); }
  .note-row.chosen .row-heading b { font-weight: 650; }
  .note-row:active { transform: scale(.99); }
  .note-row.on-desktop::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 2px; background: color-mix(in srgb, var(--accent) 55%, transparent); pointer-events: none; }
  .note-row span { display: flex; align-items: center; justify-content: space-between; gap: 6px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .note-row .row-heading { justify-content: flex-start; }
  .row-heading b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .note-row small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); margin-top: 3px; font-size: 12px; }
  .note-row .list-progress { color: var(--accent); font-size: 10px; }
  .note-row .row-meta { justify-content: flex-start; gap: 6px; margin-top: 3px; }
  .note-row .row-meta small { margin-top: 0; flex: 0 1 auto; }
  .note-row .row-tag { color: var(--muted); font-size: 10.5px; }
  .note-row :global(.starred) { flex: 0 0 auto; color: #e9a23b; fill: #e9a23b; }
  .note-row .ghost-tag { flex: 0 0 auto; padding: 0 5px; border-radius: 999px; font-size: 9.5px; line-height: 15px; background: var(--accent-soft); color: var(--accent); }
  .note-row :global(.desk-mark) { flex: 0 0 auto; color: var(--subtle); }
  .row-quick {
    position: absolute; top: 6px; right: 6px; display: inline-flex; gap: 2px;
    padding: 1px; border-radius: var(--radius-sm); background: var(--surface-raised);
    box-shadow: 0 1px 4px #00000018; opacity: 0; pointer-events: none; transition: opacity var(--motion-fast);
  }
  .note-row-wrap:hover .row-quick, .row-quick:focus-within { opacity: 1; pointer-events: auto; }
  .row-quick button { width: 22px; height: 22px; padding: 0; border-radius: 4px; color: var(--muted); }
  .row-quick button:hover { background: var(--hover-strong); color: var(--text); }
  .row-quick button.lit { color: #e9a23b; }
  .row-quick button.lit :global(svg) { fill: currentColor; }

  .trash-icon { display: inline-grid; transform-origin: 50% 0; }
  .trash-icon.wobble { animation: wobble 600ms var(--ease-out); }
  @keyframes wobble { 20% { transform: rotate(-14deg); } 45% { transform: rotate(10deg); } 70% { transform: rotate(-5deg); } }

  mark { background: color-mix(in srgb, #f5c542 45%, transparent); color: inherit; border-radius: 2px; padding: 0 1px; }
  .row-heading time { flex: 0 0 auto; margin-left: auto; color: var(--subtle); font-size: 11px; font-variant-numeric: tabular-nums; }
  .note-row.chosen time { color: var(--muted); }
  .note-row-wrap, .tab { position: relative; }

  :global(.sort-ghost) { border-radius: var(--radius) !important; box-shadow: none !important; opacity: .97; transition: scale var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out) !important; }
  :global(.sort-ghost.lifted) { scale: 1.02; box-shadow: var(--menu-shadow) !important; }
  :global(.sort-ghost.settling) { transition: transform var(--motion) var(--ease-out), scale var(--motion) var(--ease-out), box-shadow var(--motion) var(--ease-out) !important; }
  :global(:root[data-sorting]), :global(:root[data-sorting] *) { cursor: grabbing !important; user-select: none !important; }
  .desktop.drop-target { background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent); }
  .note-dot { display: inline-block; width: 8px; height: 8px; flex-shrink: 0; clip-path: var(--px-cut); }

  .desktop-tools { display: flex; gap: 6px; padding: 0 10px 8px; }
  .desktop-tools button { flex: 1; padding: 5px 8px; font-size: 11.5px; color: var(--muted); background: var(--fill); border-radius: var(--radius); }
  .desktop-tools button:hover { color: var(--text); background: var(--hover-strong); }

  .due { display: flex; flex-direction: column; gap: 3px; font-size: 11px; background: var(--accent-soft); border-radius: var(--radius); margin: 0 0 6px; padding: 5px 6px; }
  .due-top { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .due-bell { display: grid; place-items: center; color: var(--accent); flex: 0 0 auto; }
  .due button { font-size: 11px; padding: 2px 6px; flex: 0 0 auto; }
  .due .due-title { flex: 1; min-width: 0; justify-content: flex-start; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; padding: 2px 4px; }
  .due .due-close { padding: 2px; border-radius: 50%; color: var(--muted); }
  .due-snooze { display: flex; align-items: center; gap: 4px; padding-left: 17px; }
  .due-snooze button { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); border-radius: 999px; padding: 1px 7px; font-size: 10.5px; }
  .due-snooze button:hover { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  footer { flex: 0 0 auto; display: grid; grid-template-columns: minmax(max-content, 1fr) max-content; align-items: center;
    padding: 7px 10px; gap: 8px; border-top: 1px solid var(--hairline); }
  footer button { font-size: 12px; color: var(--muted); border-radius: var(--px-radius); }
  .footer-folders { display: grid; gap: 2px; }
  .footer-folders button { justify-content: flex-start; min-height: 28px; padding: 4px 7px; white-space: nowrap; }
  .footer-icons { display: grid; grid-template-columns: repeat(2, 28px); gap: 2px; }
  .footer-icons button { position: relative; width: 28px; height: 28px; padding: 0; }
  footer button[aria-pressed="true"] { color: var(--accent); background: var(--px-selected); box-shadow: var(--px-selected-edge); }
  .todo-badge { position: absolute; top: 1px; right: 0; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px; background: var(--accent); color: var(--on-accent); font-size: 9px; line-height: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); padding: 16px; }
  .trash-hint { margin: 0 10px 8px; padding: 6px 10px; border-radius: var(--radius); background: var(--fill); color: var(--muted); font-size: 11.5px; line-height: 1.5; }
  .trash-hint button { margin-left: 4px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }

  /* Work area: tabs + work-body (title, editor, status). */
  .work { grid-column: 2; grid-row: 1; display: grid; grid-template-rows: 44px minmax(0, 1fr); min-width: 0; min-height: 0; color: var(--pin-text); }
  .work-body { display: grid; grid-template-rows: auto minmax(0, 1fr) 30px; min-width: 0; min-height: 0; background: var(--pin-bg); transition: background var(--motion-fast), color var(--motion-fast); }
  .work.ink { --pin-text: #f5f5f5; --pin-heading: #ffffff; --pin-muted: #aaaaaa; --pin-border: #ffffff20; --pin-accent: #93b4ff; --pin-accent-strong: #b6cdff; --pin-active: #343434; }
  :global([data-theme="dark"]) .work[style*="--note-tint"] { --pin-bg: color-mix(in srgb, var(--note-tint) 10%, var(--surface)) !important; }

  .tabs { display: flex; align-items: center; gap: 6px; height: 44px; padding: 0 8px; min-width: 0; background: var(--surface-sunken); color: var(--text); border-bottom: 1px solid var(--hairline); transition: padding-left var(--motion) var(--ease-out); }
  main.mac.folded .tabs { padding-left: 84px; }
  .list-toggle, .window-tools button, .more, .search > button, .overflow-btn { flex: 0 0 28px; width: 28px; height: 28px; padding: 0; border-radius: 50%; color: var(--muted); transition: background var(--motion-fast), color var(--motion-fast), transform 240ms var(--ease-spring); }
  .list-toggle:hover, .window-tools button:hover, .more:hover, .search > button:hover, .overflow-btn:hover { color: var(--text); background: var(--hover-strong); }
  .list-toggle:active, .window-tools button:active, .more:active, .search > button:active, .overflow-btn:active { transform: scale(.92); }
  .window-tools button.on, .more[aria-expanded="true"], .overflow-btn[aria-expanded="true"] { color: var(--accent); background: var(--accent-soft); }
  .window-tools button.on:hover, .more[aria-expanded="true"]:hover, .overflow-btn[aria-expanded="true"]:hover { color: var(--accent); background: var(--accent-soft-strong); }
  :global(:root[data-stale-hover]) .window-tools button:not(.on, .theme-switch):hover, :global(:root[data-stale-hover]) .list-toggle:hover { background: transparent; color: var(--muted); }

  .tab-strip { display: flex; align-items: center; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; flex: 1; gap: 2px; }
  .tab-strip::-webkit-scrollbar { display: none; }
  .tab { position: relative; display: flex; align-items: center; flex: 0 1 auto; min-width: 72px; max-width: 200px; height: 28px; padding: 0 3px 0 10px; border-radius: var(--px-radius); color: var(--muted); transition: background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast); }
  .tab:hover { background: var(--hover); }
  .tab.current { background: var(--px-selected); color: var(--text-strong); box-shadow: var(--px-selected-edge); font-weight: 600; }
  .tab.inactive { opacity: .72; font-style: italic; }
  .tab button { padding: 0; background: none; border-radius: var(--radius-sm); }
  .tab button:hover { background: none; }
  .tab button:active { transform: none; }
  .tab .tab-title { display: inline-flex; align-items: center; gap: 5px; overflow: hidden; min-width: 0; flex: 1; justify-content: flex-start; height: 100%; font-size: 12.5px; line-height: 28px; }
  .tab .tab-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab .tab-title :global(.tab-state) { flex: 0 0 auto; opacity: .75; }
  .tab .tab-close { flex: 0 0 auto; width: 18px; height: 18px; margin-left: 4px; color: var(--muted); opacity: 0; transition: opacity var(--motion-fast), background var(--motion-fast); }
  .tab:hover .tab-close, .tab.current .tab-close, .tab-close:focus-visible { opacity: 1; }
  .tab .tab-close:hover { background: var(--hover-strong); color: var(--text); }

  .overflow-wrap, .more-wrap { position: relative; flex: 0 0 auto; }
  .window-tools { position: relative; display: flex; align-items: center; gap: 2px; margin-left: auto; padding-left: 6px; border-left: 1px solid var(--hairline); }

  .menu { position: absolute; right: 0; top: 34px; z-index: 60; width: 214px; padding: 5px; background: var(--material); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur); color: var(--text); border: 0; border-radius: var(--radius-sm); box-shadow: var(--material-shadow); transform-origin: top right; }
  .ctx-menu { position: fixed; right: auto; width: 196px; z-index: 150; transform-origin: top left; }
  .overflow-menu { max-height: min(320px, 55vh); overflow: auto; }
  .menu button { display: flex; justify-content: flex-start; gap: 9px; text-align: left; width: 100%; height: 29px; padding: 0 9px; font-size: 12px; border-radius: var(--px-radius); }
  .menu button:hover { background: var(--fill-strong); }
  .menu button:active { transform: none; }
  .menu button :global(svg) { flex: 0 0 auto; color: var(--muted); }
  .menu button.danger :global(svg) { color: currentColor; }
  .menu hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--hairline); }

  .window-tools .theme-switch { flex: 0 0 34px; width: 34px; height: 20px; margin-right: 4px; padding: 2px; border-radius: var(--px-radius); justify-content: flex-start; background: var(--surface-sunken); box-shadow: inset 0 0 0 1px var(--border); transition: background var(--motion-fast); }
  .window-tools .theme-switch:hover { background: color-mix(in srgb, var(--text) 16%, transparent); }
  .window-tools .theme-switch.dark { background: var(--accent); }
  .window-tools .theme-switch.dark:hover { background: var(--accent-strong); }
  .theme-switch .knob { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 1px; background: var(--surface-raised); color: var(--muted); box-shadow: inset 0 -1px 0 var(--border); transition: transform var(--motion-fast) steps(4, end); }
  .theme-switch.dark .knob { transform: translateX(14px); color: var(--accent); }
  .window-tools .theme-switch:active { transform: none; }
  .danger { color: var(--danger); }

  .title-row { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; width: 100%; max-width: 866px; margin: 0 auto; padding: 18px 30px 6px 14px; }
  .title-row input { flex: 1; min-width: 0; font-size: 18px; font-weight: 650; background: transparent; color: var(--pin-heading); }
  .title-row input::placeholder { color: var(--pin-muted); font-weight: 500; opacity: .75; }
  .time { font-size: 11px; color: var(--pin-accent); background: var(--pin-active); }
  .star { width: 28px; height: 28px; padding: 0; border-radius: 50%; color: var(--pin-muted); transition: background var(--motion-fast), color var(--motion-fast), transform 240ms var(--ease-spring); }
  .star:hover { color: var(--pin-text); }
  .star.on { color: #e9a23b; }
  .star.on :global(svg) { fill: currentColor; }
  .star:global(.pop) :global(svg) { animation: star-pop var(--motion-celebrate) var(--ease-spring); }
  @keyframes star-pop { from { transform: scale(.5) rotate(-30deg); } }

  .tag-row { flex: 0 0 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: 22px; margin-top: 2px; transition: opacity var(--motion-fast); }
  .title-row.no-tags .tag-row { opacity: .45; }
  .title-row.no-tags:hover .tag-row, .title-row.no-tags:focus-within .tag-row { opacity: 1; }
  .tag { display: inline-flex; align-items: center; height: 22px; border-radius: 999px; background: color-mix(in srgb, var(--pin-text), transparent 93%); color: var(--pin-text); font-size: 11.5px; }
  .tag button { height: 22px; padding: 0 4px; border-radius: 999px; }
  .tag .tag-name { padding-left: 8px; }
  .tag .tag-remove { width: 20px; color: var(--pin-muted); opacity: .6; }
  .tag .tag-remove:hover { opacity: 1; }
  .tag-add { height: 22px; padding: 0 8px; gap: 3px; border-radius: 999px; font-size: 11.5px; color: var(--pin-muted); }
  .tag-add:hover { color: var(--pin-accent); }
  .tag-row > .tag-add:first-child { margin-left: -6px; }
  .tag-input { width: 140px; height: 22px; padding: 0 8px; border-radius: 999px; font-size: 11.5px; background: color-mix(in srgb, var(--pin-text), transparent 93%); }
  .tag-input:focus { box-shadow: 0 0 0 1.5px var(--pin-accent); }
  .desktop { font-size: 12px; color: var(--pin-accent); }

  .editor-area { display: flex; flex-direction: column; min-height: 0; --banner-inset: max(14px, calc((100% - 852px) / 2)); }
  .editor-area > :global(.banner) { margin-top: 2px; margin-bottom: 6px; }
  .work-pane { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; animation: pane-in 140ms var(--ease-out); }
  @keyframes pane-in { from { opacity: 0; transform: translateY(3px); } }

  .preview { display: flex; flex-direction: column; min-height: 0; overflow: auto; width: 100%; padding: 0 22px 22px; }
  .preview :global(.editor-layout) { flex: 1; min-height: 0; }
  .preview :global(pre) { white-space: pre-wrap; overflow-wrap: anywhere; }
  .notice { display: flex; align-items: center; gap: 6px; color: var(--pin-muted); font-size: 12px; background: color-mix(in srgb, var(--pin-text), transparent 95%); padding: 8px; border-radius: var(--radius-sm); }
  .preview .notice { max-width: 820px; margin: 0 auto 8px; width: 100%; }
  .notice button { padding: 2px 6px; gap: 4px; color: var(--pin-accent); }

  .empty-work { grid-row: 1 / 3; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; color: var(--muted); padding: 24px;
    background-image: var(--paper-grid); background-position: center; }
  .empty-icon { display: grid; place-items: center; width: 52px; height: 52px; clip-path: var(--px-cut); background: var(--accent-soft); color: var(--text); margin-bottom: 2px; }
  .empty-work p { margin: 0; font-size: 13.5px; color: var(--text); }
  .empty-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; margin-top: 4px; }
  .empty-work .primary { background: var(--accent); color: var(--on-accent); box-shadow: var(--px-shadow-accent); padding: 6px 14px; font-size: 12.5px; font-weight: 500; }
  .empty-work .primary:hover { background: var(--accent-strong); }
  .empty-work .quick-tpl { background: var(--fill); color: var(--text); padding: 6px 11px; font-size: 12px; }
  .empty-work .quick-tpl:hover { background: var(--fill-strong); color: var(--accent); }
  .empty-command { color: var(--muted); font-size: 12px; }
  .empty-command kbd { color: var(--text); font: 11px/1.3 var(--font-pixel); padding: 2px 4px;
    border: 1px solid var(--border); border-radius: var(--px-radius); background: var(--surface-raised); }

  .status { grid-row: 3; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; color: var(--pin-muted); font-size: 11px; border-top: 1px solid var(--hairline); overflow: hidden; white-space: nowrap; }
  .status-left { display: inline-flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .status-right { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; font-variant-numeric: tabular-nums; }
  .status-right .sep { opacity: .45; }
  .status button { font-size: 11px; color: var(--pin-accent); padding: 2px 7px; }
  .status-toggle { color: var(--pin-muted) !important; gap: 4px; border-radius: var(--radius-sm); }
  .status-toggle:hover, .status-toggle.on { color: var(--pin-accent) !important; background: var(--pin-active); }

  .snap-hint { position: fixed; z-index: 200; top: 0; bottom: 0; width: 60px; pointer-events: none; display: flex; align-items: center; justify-content: center; animation: snap-in var(--motion-fast) ease-out; }
  .snap-hint.side-left { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent); }
  .snap-hint.side-right { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent); }
  .snap-hint span { writing-mode: vertical-rl; font-size: 12px; color: var(--accent-strong); letter-spacing: 2px; background: var(--surface-raised); border-radius: var(--radius); padding: 10px 4px; box-shadow: var(--menu-shadow); }
  @keyframes snap-in { from { opacity: 0; } }
  .drop-overlay { position: fixed; inset: 0; z-index: 240; display: grid; place-items: center; pointer-events: none; background: color-mix(in srgb, var(--surface) 45%, transparent); -webkit-backdrop-filter: var(--material-blur); backdrop-filter: var(--material-blur); }
  .drop-card { display: grid; place-items: center; gap: 6px; padding: 24px 32px; border: 1.5px dashed var(--accent); border-radius: var(--radius-lg); background: var(--material); box-shadow: var(--material-shadow); color: var(--accent); text-align: center; }
  .drop-card strong { font-size: 14px; font-weight: 600; color: var(--text-strong); }
  .drop-card small { font-size: 11.5px; color: var(--muted); }

  .scrim { position: absolute; z-index: 29; inset: 0; border-radius: 0; background: var(--overlay); padding: 0; opacity: 0; pointer-events: none; transition: opacity var(--motion); }
  .scrim:hover { background: var(--overlay); }
  .scrim:active { transform: none; }
  main.drawer .scrim { opacity: 1; pointer-events: auto; }
  main.narrow aside { position: absolute; z-index: 30; top: 0; bottom: 0; left: 0; width: min(280px, 85%); transform: translateX(-100%); transition: transform var(--motion) var(--ease-out), box-shadow var(--motion); box-shadow: none; }
  main.narrow.drawer aside { transform: none; box-shadow: 8px 0 28px #0000002a; }
  main.narrow .side-inner { width: 100%; }
  main.narrow .title-row { padding: 12px 14px; }
  main.narrow .tab { min-width: 84px; }
  main.narrow .desktop { padding: 6px; }
  @media (max-width: 700px) { .title-row { padding: 12px; } .desktop { font-size: 11px; } }

  :global(::view-transition-old(root)), :global(::view-transition-new(root)) { animation: none; mix-blend-mode: normal; }
  .due-bell { display: inline-grid; margin-left: 4px; color: var(--accent); transform-origin: 50% 2px; animation: bell 900ms var(--ease-out) 2; }
  @keyframes bell { 15% { transform: rotate(16deg); } 30% { transform: rotate(-14deg); } 45% { transform: rotate(9deg); } 60% { transform: rotate(-6deg); } 75% { transform: rotate(2deg); } }
  @media (prefers-reduced-motion: reduce) {
    .seg-pill, .note-row-wrap, .trash-icon, .due-bell, .star :global(svg), .work-pane { transition: none; animation: none; }
    .theme-switch .knob, main, main.narrow aside, .scrim, .tabs, .tab, .tab .tab-close, button, .work-body, .snap-hint, .list-resizer::after { transition: none; animation: none; }
  }
</style>
