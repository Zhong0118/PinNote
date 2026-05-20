import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
    await register(shortcuts.toggleWindow, (event) => {
      if (event.state === "Pressed") handlers.toggleWindow();
    });
    await register(shortcuts.newNote, (event) => {
      if (event.state === "Pressed") handlers.newNote();
    });
    registered = true;
  } catch (e) {
    console.warn("Failed to register global shortcuts:", e);
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
