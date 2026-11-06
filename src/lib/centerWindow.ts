import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
export async function openCenter() {
  const win = await WebviewWindow.getByLabel('main');
  await win?.show(); await win?.setFocus();
}
