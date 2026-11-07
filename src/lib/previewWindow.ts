import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors, LogicalPosition, PhysicalPosition } from '@tauri-apps/api/window';
import { isMacPlatform } from './settings';
import { fitBounds, normalizeBounds, normalizeDisplays } from './windowGeometry';
import type { PinNote } from './notesStore';
export async function showPreview(note: PinNote) {
  const owner = getCurrentWindow();
  const [p, size, scale] = await Promise.all([owner.outerPosition(), owner.innerSize(), owner.scaleFactor()]);
  const logical = size.toLogical(scale);
  const current = normalizeBounds({ x:p.x, y:p.y, width:logical.width, height:logical.height, scaleFactor:scale }, isMacPlatform());
  // Open beside the capsule or edge tab, toward the screen interior.
  const gap = 0; // the card itself is inset 6px inside its transparent window
  const x = note.window.edge?.side === 'right' ? current.x - (320 + gap) * current.scaleFactor : current.x + (current.width + gap) * current.scaleFactor;
  const target = fitBounds({ ...current, x, width:320, height:240 }, normalizeDisplays(await availableMonitors(), isMacPlatform()));
  const label = `preview-${note.id}`;
  let win = await WebviewWindow.getByLabel(label);
  if (!win) {
    win = new WebviewWindow(label, { url:`/preview?noteId=${encodeURIComponent(note.id)}`, title:'便签预览', width:320, height:240,
      decorations:false, transparent:true, backgroundColor:'#00000000', shadow:false,
      resizable:false, alwaysOnTop:true, skipTaskbar:true, focus:false, focusable:false, visible:false });
    await new Promise<void>((resolve,reject) => { win!.once('tauri://created', () => resolve()); win!.once('tauri://error', e => reject(e.payload)); });
  }
  await win.setPosition(isMacPlatform() ? new LogicalPosition(target.x,target.y) : new PhysicalPosition(target.x,target.y));
  await win.show(); // Deliberately never setFocus or use openNoteWindow here.
  await emitTo(label, 'preview-shown', { side: note.window.edge?.side ?? 'none' });
}
