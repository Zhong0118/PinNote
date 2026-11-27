import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';
import { availableMonitors, LogicalPosition, PhysicalPosition } from '@tauri-apps/api/window';
import { isMacPlatform } from './settings';
import { normalizeDisplays } from './windowGeometry';

export const QUICK_LABEL = 'quick-capture';
export const QUICK_SIZE = { width: 560, height: 174 };

let creating: Promise<WebviewWindow> | undefined;

async function ensureQuickWindow() {
  const existing = await WebviewWindow.getByLabel(QUICK_LABEL);
  if (existing) return existing;
  creating ??= (async () => {
    const win = new WebviewWindow(QUICK_LABEL, {
      url: '/quick',
      title: '驻墨速记',
      ...QUICK_SIZE,
      decorations: false,
      transparent: true,
      backgroundColor: '#00000000',
      shadow: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      visible: false,
      visibleOnAllWorkspaces: isMacPlatform(),
    });
    await new Promise<void>((resolve, reject) => {
      win.once('tauri://created', () => resolve());
      win.once('tauri://error', e => reject(e.payload));
    });
    await new Promise<void>(resolve => {
      const t = setTimeout(resolve, 1500);
      void win.once('quick-ready', () => { clearTimeout(t); resolve(); });
    });
    return win;
  })().finally(() => { creating = undefined; });
  return creating;
}

export async function openQuickCapture() {
  const win = await ensureQuickWindow();
  const displays = normalizeDisplays(await availableMonitors(), isMacPlatform());
  const screen = displays[0];
  if (screen) {
    const { position: p, size: s } = screen.workArea;
    const scale = screen.scaleFactor;
    const x = Math.round(p.x + (s.width - QUICK_SIZE.width * scale) / 2);
    const y = Math.round(p.y + Math.min(s.height * 0.22, 180 * scale));
    await win.setPosition(isMacPlatform() ? new LogicalPosition(x, y) : new PhysicalPosition(x, y));
  }
  await emitTo(QUICK_LABEL, 'quick-open');
  await win.show();
  await win.setFocus();
}
