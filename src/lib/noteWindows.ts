import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isMacPlatform } from "./settings";
import type { PinNote } from "./notesStore";

export function noteWindowLabel(noteId: string) {
  return `note-${noteId}`;
}

export async function openNoteWindow(note: PinNote, options: { offset?: boolean } = {}) {
  const label = noteWindowLabel(note.id);
  const existing = await WebviewWindow.getByLabel(label);

  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  const x = options.offset && note.window.x != null ? note.window.x + 22 : note.window.x;
  const y = options.offset && note.window.y != null ? note.window.y + 22 : note.window.y;

  new WebviewWindow(label, {
    url: `/?noteId=${encodeURIComponent(note.id)}`,
    title: note.title || "PinNote",
    width: note.window.width,
    height: note.window.height,
    x,
    y,
    minWidth: 300,
    minHeight: 320,
    preventOverflow: true,
    alwaysOnTop: note.alwaysOnTop,
    decorations: false,
    resizable: true,
    transparent: true,
    backgroundColor: "#00000000",
    shadow: false,
    visibleOnAllWorkspaces: isMacPlatform(),
  });
}
