import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function openSettingsWindow() {
  const existing = await WebviewWindow.getByLabel("settings");
  if (existing) {
    await existing.setFocus();
    return;
  }

  new WebviewWindow("settings", {
    url: "/settings",
    title: "PinNote 设置",
    width: 480,
    height: 520,
    resizable: false,
    center: true,
    decorations: true,
  });
}
