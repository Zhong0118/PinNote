import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function openSettingsWindow(noteId?: string) {
  const label = noteId ? `settings-${noteId}` : "settings";
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow(label, {
    url: noteId ? `/settings?noteId=${encodeURIComponent(noteId)}` : "/settings",
    title: "PinNote 设置",
    width: 480,
    height: 520,
    resizable: false,
    center: true,
    decorations: true,
  });
}
