import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isMacPlatform } from "./settings";
import { requestWindowVisibility } from "./windowVisibility";
import { CAPSULE } from "./windowGeometry";
import type { PinNote } from "./notesStore";
import { noteOperation } from './notesStore';
import { emitTo } from '@tauri-apps/api/event';

export function noteWindowLabel(noteId: string) {
  return `note-${noteId}`;
}

export async function findNoteWindow(noteId: string) {
  const mainId = await invoke<string | null>("main_note_id");
  return WebviewWindow.getByLabel(mainId === noteId ? "main" : noteWindowLabel(noteId));
}

export async function openNoteWindow(note: PinNote, options: { offset?: boolean; locate?: boolean } = {}) {
  if(note.lifecycle !== 'active') throw new Error('请先恢复便签');
  if(note.placement !== 'desktop') await noteOperation(note,'desktop');
  const label = noteWindowLabel(note.id);
  const existing = await findNoteWindow(note.id);

  if (existing) {
    await requestWindowVisibility(existing.label, true);
    if(options.locate)await emitTo(existing.label,'locate-note-requested',{id:note.id});
    await existing.setFocus();
    return;
  }

  const x = options.offset && note.window.x != null ? note.window.x + 22 : note.window.x;
  const y = options.offset && note.window.y != null ? note.window.y + 22 : note.window.y;

  const created = new WebviewWindow(label, {
    url: `/?noteId=${encodeURIComponent(note.id)}`,
    title: note.title || "PinNote",
    width: note.window.collapsed ? CAPSULE.width : note.window.width,
    height: note.window.collapsed ? CAPSULE.height : note.window.height,
    x,
    y,
    minWidth: CAPSULE.width,
    minHeight: CAPSULE.height,
    preventOverflow: true,
    alwaysOnTop: note.alwaysOnTop,
    decorations: false,
    resizable: !note.window.collapsed,
    transparent: true,
    backgroundColor: "#00000000",
    shadow: false,
    visible: false,
    visibleOnAllWorkspaces: isMacPlatform(),
  });
  await new Promise<void>((resolve,reject) => { created.once('tauri://created',()=>resolve()); created.once('tauri://error', e=>reject(e.payload)); });
  await requestWindowVisibility(label, true);
  if(options.locate)await emitTo(label,'locate-note-requested',{id:note.id});
  await created.setFocus();
}
