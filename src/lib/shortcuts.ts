import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeShortcut, shortcutIdentity } from "./settings";
import type { ShortcutConfig } from "./settings";

export type ShortcutHandlers = {
  toggleWindow: () => void;
  newNote: () => void;
};

let registered = false;

export async function registerGlobalShortcuts(
  shortcuts: ShortcutConfig,
  handlers: ShortcutHandlers,
) {
  await unregisterGlobalShortcuts();

  try {
    const toggleWindow = normalizeShortcut(shortcuts.toggleWindow);
    const newNote = normalizeShortcut(shortcuts.newNote);

    await register([toggleWindow, newNote], (event) => {
      if (event.state !== "Pressed") return;
      const eventShortcut = shortcutIdentity(event.shortcut);
      if (eventShortcut === shortcutIdentity(toggleWindow)) handlers.toggleWindow();
      if (eventShortcut === shortcutIdentity(newNote)) handlers.newNote();
    });
    registered = true;
    return { ok: true, message: "" };
  } catch (e) {
    await unregisterAll().catch(() => undefined);
    registered = false;
    console.warn("Failed to register global shortcuts:", e);
    return { ok: false, message: e instanceof Error ? e.message : "快捷键可能被占用" };
  }
}

export async function unregisterGlobalShortcuts() {
  if (!registered) return;
  try {
    await unregisterAll();
    registered = false;
  } catch {
    // Ignore
  }
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
