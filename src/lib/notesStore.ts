import { perfCount } from "./perf";
import { invoke } from "@tauri-apps/api/core";
import { defaultContent, defaultTitle } from "./defaultNote";
import { defaultSettings, type NoteTheme } from "./settings";

export type NoteWindowState = {
  /** `top` (work-area ratio, set by the newest `topAt`) is where the queue on that edge starts. */
  edge?: { side: "left" | "right"; display: string; order: number; top?: number; topAt?: number } | null;
  collapsed?: boolean;
  position?: { x: number; y: number };
  positionSpace?: "logical";
  capsulePosition?: { x: number; y: number };
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type PinNote = {
  revision: number;
  lifecycle: "active" | "archived" | "trash";
  placement: "center" | "desktop";
  reminder?: { at: number; state: "pending" | "delivered" | "paused" } | null;
  id: string;
  title: string;
  content: string;
  theme: NoteTheme;
  customColor: string;
  opacity: number;
  alwaysOnTop: boolean;
  window: NoteWindowState;
  createdAt: number;
  updatedAt: number;
  lastFocusedAt: number;
};

export type NotesFile = {
  version: 1 | 2;
  history?: Array<{ at: number; op: string; source?: string; note: PinNote }>;
  lastActiveNoteId: string;
  lastClosedNoteId: string;
  notes: Record<string, PinNote>;
};

type LegacyNote = {
  title?: string;
  content?: string;
};

const SAVE_DELAY = 500;
const defaultWindow = { width: 420, height: 560 };
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingNotes = new Map<string, PinNote>();
let pendingSave: Promise<void> = Promise.resolve();
const revisions = new Map<string, number>();
export function hasPendingSave(id: string) { return pendingNotes.has(id); }
export function discardPendingSave(id: string) {
  clearTimeout(timers.get(id)); timers.delete(id); pendingNotes.delete(id); scopes.delete(id);
  void invoke('note_draft',{id,dirty:false}).catch(()=>{});
}
export type NoteChange = { id: string; note: PinNote | null; op: string; layout?: boolean };
let snapshot: Promise<NotesFile> | undefined;
let following = false;
/**
 * This window's copy of the library: read once, then kept current from each
 * operation's result and `notes-changed` payloads instead of reloading the file.
 */
export function notesSnapshot(): Promise<NotesFile> {
  if (!following) {
    following = true;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<NoteChange>("notes-changed", ({ payload }) => applyNoteChange(payload))).catch(() => { following = false; });
  }
  snapshot ??= loadNotes().catch((error) => { snapshot = undefined; throw error; });
  return snapshot;
}
/** Apply one change to the snapshot (idempotent; safe to call from several listeners). */
export async function applyNoteChange(change: Pick<NoteChange, "id" | "note">) {
  if (!snapshot) return;
  const file = await snapshot.catch(() => undefined);
  if (!file) return;
  const known = file.notes[change.id];
  if (!change.note) delete file.notes[change.id];
  else if (!known || known.revision <= change.note.revision) file.notes[change.id] = change.note;
}

export async function noteOperation(note: PinNote, op: string, extra: Record<string, unknown> = {}) {
  const result = await invoke<PinNote | null>("note_operation", { request: {
    id: note.id, op, expectedRevision: Math.max(revisions.get(note.id) ?? 0, note.revision), ...extra,
  } });
  void applyNoteChange({ id: note.id, note: result });
  if (result) {
    if(op==='appearance') {
      const {theme,customColor,opacity,alwaysOnTop}=result;
      Object.assign(note,{theme,customColor,opacity,alwaysOnTop});
    } else { revisions.set(note.id, result.revision); Object.assign(note, result); }
  }
  return result;
}

export async function loadNotes(): Promise<NotesFile> {
  perfCount("ipc.loadNotes");
  const raw = await invoke<string | null>("load_notes");
  if (raw !== null) {
    const file = JSON.parse(raw) as Partial<NotesFile>;
    if (!file || typeof file.notes !== "object" || !file.notes || Array.isArray(file.notes)) {
      throw new Error("便签数据格式无效，原文件已保留");
    }
    for (const note of Object.values(file.notes)) {
      if (!note || typeof note !== "object" ||
          (note.content != null && typeof note.content !== "string") ||
          (note.title != null && typeof note.title !== "string")) {
        throw new Error("便签数据格式无效，原文件已保留");
      }
    }
    const normalized = normalizeNotes(file);
    snapshot = Promise.resolve(structuredClone(normalized));
    return normalized;
  }

  return migrateLegacyNote();
}

export async function loadNoteById(id?: string): Promise<{ note: PinNote; file: NotesFile }> {
  const file = await loadNotes();
  if (id && (!file.notes[id] || file.notes[id].lifecycle !== "active")) throw new Error("便签已归档或删除");
  const noteId = id ?? (file.lastClosedNoteId || file.lastActiveNoteId);
  const note = (file.notes[noteId]?.lifecycle === "active" ? file.notes[noteId] : undefined) ?? Object.values(file.notes).find(n => n.lifecycle === "active") ?? createNote();

  if (!file.notes[note.id]) {
    file.notes[note.id] = note;
    file.lastActiveNoteId = note.id;
    file.lastClosedNoteId = note.id;
    await saveNoteNow(note);
    await markNoteClosed(note);
  }

  return { note, file };
}

export function createNote(seed: Partial<PinNote> = {}): PinNote {
  const now = Date.now();

  return {
    revision: seed.revision ?? 0,
    lifecycle: seed.lifecycle ?? "active",
    placement: seed.placement ?? "center",
    reminder: seed.reminder ?? null,
    id: seed.id ?? createId(),
    title: seed.title ?? defaultTitle,
    content: seed.content ?? defaultContent,
    theme: seed.theme ?? defaultSettings.defaultNote.theme,
    customColor: seed.customColor ?? defaultSettings.defaultNote.customColor,
    opacity: seed.opacity ?? defaultSettings.defaultNote.opacity,
    alwaysOnTop: seed.alwaysOnTop ?? defaultSettings.defaultNote.alwaysOnTop,
    window: { ...defaultWindow, ...seed.window },
    createdAt: seed.createdAt ?? now,
    updatedAt: seed.updatedAt ?? now,
    lastFocusedAt: seed.lastFocusedAt ?? now,
  };
}

/**
 * Which part of a note a save writes.
 * - `body`: title + content (the center never writes desktop geometry).
 * - `window`: geometry only; never conflicts with a body draft edited elsewhere.
 * - `all`: an expanded desktop window owning both.
 */
export type SaveScope = "all" | "body" | "window";
const scopes = new Map<string, SaveScope>();
const mergeScope = (a: SaveScope | undefined, b: SaveScope): SaveScope => !a || a === b ? b : "all";

export function scheduleNoteSave(note: PinNote, onResult?: (error?: unknown) => void, scope: SaveScope = "all") {
  const merged = mergeScope(pendingNotes.has(note.id) ? scopes.get(note.id) : undefined, scope);
  const bodyAlreadyDirty = pendingNotes.has(note.id) && scopes.get(note.id) !== "window";
  if (merged !== "window" && !bodyAlreadyDirty) void invoke('note_draft',{id:note.id,dirty:true}).catch(()=>{});
  pendingNotes.set(note.id, { ...note, window: { ...note.window } });
  scopes.set(note.id, merged);
  clearTimeout(timers.get(note.id));
  timers.set(
    note.id,
    setTimeout(() => {
      timers.delete(note.id);
      void flushNoteSave(note.id).then(() => {
        if (!pendingNotes.has(note.id)) onResult?.();
      }).catch((error) => onResult?.(error));
    }, SAVE_DELAY),
  );
}

export async function flushNoteSave(id?: string) {
  if (id) clearTimeout(timers.get(id));
  else timers.forEach((timer) => clearTimeout(timer));

  const notes = id
    ? pendingNotes.has(id)
      ? [pendingNotes.get(id)!]
      : []
    : Array.from(pendingNotes.values());

  if (notes.length === 0) return pendingSave;

  pendingSave = pendingSave.catch(() => undefined).then(async () => {
    for (const snapshot of notes) {
      const note = pendingNotes.get(snapshot.id);
      if (!note) continue;
      const scope = scopes.get(note.id) ?? "all";
      const next = { ...note, updatedAt: Date.now() };
      const revision = Math.max(revisions.get(note.id) ?? 0, note.revision);
      const op = revision === 0 ? "create" : scope === "window" ? "window" : "save";
      const patch = scope === "window" ? { window: next.window }
        : scope === "body" ? { title: next.title, content: next.content }
        : { title: next.title, content: next.content, window: next.window };
      // Only a new note needs the full record; every other save sends just its fields.
      const result = await invoke<PinNote>("note_operation", { request: {
        id: note.id, op, expectedRevision: revision, patch, ...(op === "create" ? { note: next } : {}),
      } });
      if (result) { revisions.set(note.id, result.revision); void applyNoteChange({ id: note.id, note: result }); }
      // A newer draft may have arrived while the native write was in flight.
      if (pendingNotes.get(note.id) === note) {
        pendingNotes.delete(note.id); scopes.delete(note.id);
        if (scope !== "window") await invoke('note_draft',{id:note.id,dirty:false});
      }
    }
  });

  return pendingSave;
}

export async function saveNoteNow(note: PinNote, scope: SaveScope = "all") {
  const merged = mergeScope(pendingNotes.has(note.id) ? scopes.get(note.id) : undefined, scope);
  pendingNotes.set(note.id, { ...note, window: { ...note.window } });
  scopes.set(note.id, merged);
  await flushNoteSave(note.id);
  note.revision = revisions.get(note.id) ?? note.revision;
}

export async function getRecentNote() {
  const file = await loadNotes();
  const active = Object.values(file.notes).filter(n => n.lifecycle === "active");
  const note = active.find(n => n.id === file.lastActiveNoteId) ?? active.find(n => n.id === file.lastClosedNoteId) ?? active[0] ?? createNote();
  return { note, file };
}

export async function patchNoteNow(id: string, patch: Partial<PinNote>) {
  const { notes } = await loadNotes();
  return (await noteOperation(notes[id], "appearance", { patch }))!;
}

export async function markNoteActive(note: PinNote) {
  await invoke("note_operation", { request: { id: note.id, op: "focus" } });
}

export async function markNoteClosed(note: PinNote) {
  await markNoteActive(note);
}

export async function deleteNoteNow(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  pendingNotes.delete(id);
  scopes.delete(id);
  await pendingSave.catch(() => undefined);

  const current = (await loadNotes()).notes[id];
  if (current) await noteOperation(current, "trash");
  const file = await loadNotes();
  const fallback = Object.values(file.notes).filter(n => n.lifecycle === "active").sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0] ?? createNote();
  if (!file.notes[fallback.id]) await saveNoteNow(fallback);
  return fallback;
}

export async function saveNotes(file: NotesFile) {
  await invoke("save_notes", { json: JSON.stringify(normalizeNotes(file)) });
}

async function migrateLegacyNote(): Promise<NotesFile> {
  let legacy: LegacyNote = {};

  const raw = await invoke<string | null>("load_note");
  if (raw) legacy = JSON.parse(raw) as LegacyNote;

  const note = createNote({
    title: legacy.title ?? defaultTitle,
    content: legacy.content ?? defaultContent,
  });
  const file = normalizeNotes({
    version: 1,
    lastActiveNoteId: note.id,
    lastClosedNoteId: note.id,
    notes: { [note.id]: note },
  });
  await saveNotes(file);
  return loadNotes();
}

function normalizeNotes(file: Partial<NotesFile>): NotesFile {
  const notes = Object.fromEntries(
    Object.entries(file.notes ?? {}).map(([id, note]) => [id, createNote({ ...note, placement: note.placement ?? "desktop", id })]),
  );
  const fallbackId = Object.keys(notes)[0] ?? "";
  const lastActiveNoteId =
    file.lastActiveNoteId && notes[file.lastActiveNoteId] ? file.lastActiveNoteId : fallbackId;
  const lastClosedNoteId =
    file.lastClosedNoteId && notes[file.lastClosedNoteId] ? file.lastClosedNoteId : lastActiveNoteId;

  return {
    version: 2,
    history: file.history ?? [],
    notes,
    lastActiveNoteId,
    lastClosedNoteId,
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
