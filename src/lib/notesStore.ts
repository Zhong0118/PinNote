import { invoke } from "@tauri-apps/api/core";
import { defaultContent, defaultTitle } from "./defaultNote";
import { defaultSettings, type NoteTheme } from "./settings";

export type NoteWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type PinNote = {
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
  version: 1;
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

export async function loadNotes(): Promise<NotesFile> {
  try {
    const raw = await invoke<string | null>("load_notes");
    if (raw) return normalizeNotes(JSON.parse(raw) as Partial<NotesFile>);
  } catch {
    // Browser preview or first launch.
  }

  return migrateLegacyNote();
}

export async function loadNoteById(id?: string): Promise<{ note: PinNote; file: NotesFile }> {
  const file = await loadNotes();
  const noteId = id && file.notes[id] ? id : file.lastClosedNoteId || file.lastActiveNoteId;
  const note = file.notes[noteId] ?? Object.values(file.notes)[0] ?? createNote();

  if (!file.notes[note.id]) {
    file.notes[note.id] = note;
    file.lastActiveNoteId = note.id;
    file.lastClosedNoteId = note.id;
    await saveNotes(file);
  }

  return { note, file };
}

export function createNote(seed: Partial<PinNote> = {}): PinNote {
  const now = Date.now();

  return {
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

export function scheduleNoteSave(note: PinNote) {
  pendingNotes.set(note.id, note);
  clearTimeout(timers.get(note.id));
  timers.set(
    note.id,
    setTimeout(() => {
      void flushNoteSave(note.id).catch(() => {
        // Keep the note pending for the next attempt.
      });
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

  notes.forEach((note) => pendingNotes.delete(note.id));
  if (notes.length === 0) return pendingSave;

  pendingSave = pendingSave.catch(() => undefined).then(async () => {
    try {
      for (const note of notes) {
        const next = { ...note, updatedAt: Date.now() };
        await invoke("upsert_note", {
          json: JSON.stringify(next),
          setActive: false,
          setClosed: false,
        });
      }
    } catch (error) {
      notes.forEach((note) => pendingNotes.set(note.id, note));
      throw error;
    }
  });

  return pendingSave;
}

export async function saveNoteNow(note: PinNote) {
  pendingNotes.set(note.id, note);
  await flushNoteSave(note.id);
}

export async function getRecentNote() {
  const file = await loadNotes();
  const note = file.notes[file.lastActiveNoteId] ?? file.notes[file.lastClosedNoteId] ?? Object.values(file.notes)[0];
  return { note, file };
}

export async function patchNoteNow(id: string, patch: Partial<PinNote>) {
  const raw = await invoke<string>("patch_note", {
    id,
    json: JSON.stringify({ ...patch, updatedAt: Date.now() }),
    setActive: true,
    setClosed: false,
  });
  return createNote(JSON.parse(raw) as Partial<PinNote>);
}

export async function markNoteActive(note: PinNote) {
  await invoke("patch_note", {
    id: note.id,
    json: JSON.stringify({ lastFocusedAt: Date.now() }),
    setActive: true,
    setClosed: false,
  });
}

export async function markNoteClosed(note: PinNote) {
  await invoke("upsert_note", {
    json: JSON.stringify({ ...note, updatedAt: Date.now() }),
    setActive: true,
    setClosed: true,
  });
}

export async function deleteNoteNow(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  pendingNotes.delete(id);

  const file = await loadNotes();
  delete file.notes[id];

  const fallback = Object.values(file.notes).sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0] ?? createNote();
  file.notes[fallback.id] = fallback;
  file.lastActiveNoteId = fallback.id;
  file.lastClosedNoteId = fallback.id;

  await saveNotes(file);
  return fallback;
}

export async function saveNotes(file: NotesFile) {
  await invoke("save_notes", { json: JSON.stringify(normalizeNotes(file)) });
}

async function migrateLegacyNote(): Promise<NotesFile> {
  let legacy: LegacyNote = {};

  try {
    const raw = await invoke<string | null>("load_note");
    if (raw) legacy = JSON.parse(raw) as LegacyNote;
  } catch {
    // No legacy note to migrate.
  }

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
  await saveNotes(file).catch(() => undefined);
  return file;
}

function normalizeNotes(file: Partial<NotesFile>): NotesFile {
  const notes = Object.fromEntries(
    Object.entries(file.notes ?? {}).map(([id, note]) => [id, createNote({ ...note, id })]),
  );
  const firstId = Object.keys(notes)[0];

  if (!firstId) {
    const note = createNote();
    notes[note.id] = note;
  }

  const fallbackId = Object.keys(notes)[0];
  const lastActiveNoteId =
    file.lastActiveNoteId && notes[file.lastActiveNoteId] ? file.lastActiveNoteId : fallbackId;
  const lastClosedNoteId =
    file.lastClosedNoteId && notes[file.lastClosedNoteId] ? file.lastClosedNoteId : lastActiveNoteId;

  return {
    version: 1,
    notes,
    lastActiveNoteId,
    lastClosedNoteId,
  };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
