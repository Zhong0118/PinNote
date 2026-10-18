import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeShortcut, shortcutIdentity } from "./settings";
import type { ShortcutConfig } from "./settings";

export type ShortcutHandlers = {
  toggleWindow: () => void;
  newNote: () => void;
};

let needsCleanup = false;
let revision = 0;
let pending = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.then(() => undefined, () => undefined);
  return result;
}

async function clearShortcuts() {
  if (!needsCleanup) return;
  await unregisterAll();
  needsCleanup = false;
}

export function registerGlobalShortcuts(
  shortcuts: ShortcutConfig,
  handlers: ShortcutHandlers,
) {
  const request = ++revision;
  const snapshot = { ...shortcuts };
  const cancelled = { ok: false, message: "", cancelled: true };

  return enqueue(async () => {
    if (request !== revision) return cancelled;
    let active = false;
    try {
      await clearShortcuts();
      if (request !== revision) return cancelled;
      const toggleWindow = normalizeShortcut(snapshot.toggleWindow);
      const newNote = normalizeShortcut(snapshot.newNote);
      const toggleIdentity = shortcutIdentity(toggleWindow);
      const newNoteIdentity = shortcutIdentity(newNote);
      const pressed = new Set<string>();

      // Bulk registration can fail after registering only the first shortcut.
      needsCleanup = true;
      await register([toggleWindow, newNote], (event) => {
        if (!active || request !== revision) return;
        const identity = shortcutIdentity(event.shortcut);
        if (event.state === "Released") {
          pressed.delete(identity);
          return;
        }
        if (event.state !== "Pressed" || pressed.has(identity)) return;
        pressed.add(identity);
        if (identity === toggleIdentity) handlers.toggleWindow();
        if (identity === newNoteIdentity) handlers.newNote();
      });
      if (request !== revision) return cancelled;
      active = true;
      return { ok: true, message: "", cancelled: false };
    } catch (e) {
      await clearShortcuts().catch(() => undefined);
      if (request !== revision) return cancelled;
      console.warn("Failed to register global shortcuts:", e);
      return { ok: false, message: e instanceof Error ? e.message : "快捷键可能被占用", cancelled: false };
    }
  });
}

export function unregisterGlobalShortcuts() {
  ++revision;
  return enqueue(() => clearShortcuts().catch(() => undefined));
}

export async function toggleWindowVisibility() {
  const win = getCurrentWindow();
  const visible = await win.isVisible();
  if (visible) {
    await win.hide();
  } else {
    await win.show();
    await win.setFocus();
  }
}
