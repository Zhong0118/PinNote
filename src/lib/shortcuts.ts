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
    return { ok: true, message: "" };
  } catch (e) {
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
