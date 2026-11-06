import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, availableMonitors, LogicalPosition, PhysicalPosition } from '@tauri-apps/api/window';
import { isMacPlatform } from './settings';
import { fitBounds, normalizeBounds, normalizeDisplays } from './windowGeometry';
import type { PinNote } from './notesStore';
export async function showPreview(note: PinNote) {
  const owner = getCurrentWindow();
  const [p, scale] = await Promise.all([owner.outerPosition(), owner.scaleFactor()]);
  const current = normalizeBounds({ x:p.x, y:p.y, width:180, height:40, scaleFactor:scale }, isMacPlatform());
  const target = fitBounds({ ...current, x: current.x + (note.window.edge?.side === 'right' ? -324 : 184) * current.scaleFactor, width:320, height:240 }, normalizeDisplays(await availableMonitors(), isMacPlatform()));
  const label = `preview-${note.id}`;
  let win = await WebviewWindow.getByLabel(label);
  if (!win) {
    win = new WebviewWindow(label, { url:`/preview?noteId=${encodeURIComponent(note.id)}`, title:'便签预览', width:320, height:240,
      decorations:false, resizable:false, alwaysOnTop:true, skipTaskbar:true, focus:false, focusable:false, visible:false });
    await new Promise<void>((resolve,reject) => { win!.once('tauri://created', () => resolve()); win!.once('tauri://error', e => reject(e.payload)); });
  }
  await win.setPosition(isMacPlatform() ? new LogicalPosition(target.x,target.y) : new PhysicalPosition(target.x,target.y));
  await win.show(); // Deliberately never setFocus or use openNoteWindow here.
}
