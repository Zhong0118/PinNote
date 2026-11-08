import { emitTo } from "@tauri-apps/api/event";

/** Settings live inside the note center; every entry point (button, tray, ⌘,) opens it there. */
export async function openSettingsWindow() {
  await emitTo("main", "open-settings-requested");
}
