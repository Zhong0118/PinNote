import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow, availableMonitors, LogicalPosition, PhysicalPosition } from '@tauri-apps/api/window';
import { isMacPlatform } from './settings';
import { perfCount } from './perf';
import { checklistProgress } from './checklist';
import { plainExcerpt } from './excerpt';
import { fitBounds, normalizeBounds, normalizeDisplays } from './windowGeometry';
import type { PinNote } from './notesStore';

/** One hover preview window is shared by every capsule and tab and reused. */
export const PREVIEW_LABEL = 'preview-shared';
export const PREVIEW_SIZE = { width: 320, height: 240 };
export type PreviewSummary = { id: string; title: string; excerpt: string; done: number; total: number; reminderAt?: number; side: 'left' | 'right' | 'none'; seq: number };

let creating: Promise<WebviewWindow> | undefined;
async function previewWindow() {
  const existing = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (existing) return existing;
  creating ??= (async () => {
    perfCount('preview.window.create');
    const win = new WebviewWindow(PREVIEW_LABEL, { url: '/preview', title: '便签预览', ...PREVIEW_SIZE,
      decorations: false, transparent: true, backgroundColor: '#00000000', shadow: false,
      resizable: false, alwaysOnTop: true, skipTaskbar: true, focus: false, focusable: false, visible: false });
    await new Promise<void>((resolve, reject) => { win.once('tauri://created', () => resolve()); win.once('tauri://error', e => reject(e.payload)); });
    // Its page announces readiness before the first summary can be shown.
    await new Promise<void>(resolve => { const t = setTimeout(resolve, 1500); void win.once('preview-ready', () => { clearTimeout(t); resolve(); }); });
    return win;
  })().finally(() => { creating = undefined; });
  return creating;
}

let seq = 0;
export async function showPreview(note: PinNote) {
  const owner = getCurrentWindow();
  const [p, size, scale] = await Promise.all([owner.outerPosition(), owner.innerSize(), owner.scaleFactor()]);
  const logical = size.toLogical(scale);
  const current = normalizeBounds({ x:p.x, y:p.y, width:logical.width, height:logical.height, scaleFactor:scale }, isMacPlatform());
  // Open beside the capsule or edge tab, toward the screen interior.
  const x = note.window.edge?.side === 'right' ? current.x - PREVIEW_SIZE.width * current.scaleFactor : current.x + current.width * current.scaleFactor;
  const target = fitBounds({ ...current, x, ...PREVIEW_SIZE }, normalizeDisplays(await availableMonitors(), isMacPlatform()));
  const id = ++seq;
  const win = await previewWindow();
  if (id !== seq) return; // a newer hover took over while the window was being created
  const tasks = checklistProgress(note.content);
  const summary: PreviewSummary = { id: note.id, title: note.title, excerpt: plainExcerpt(note.content, 600, { title: note.title, code: false }).replace(/\n{2,}/g, '\n'), done: tasks.done, total: tasks.total,
    reminderAt: note.reminder?.at, side: note.window.edge?.side ?? 'none', seq: id };
  await emitTo(PREVIEW_LABEL, 'preview-show', summary);
  await win.setPosition(isMacPlatform() ? new LogicalPosition(target.x,target.y) : new PhysicalPosition(target.x,target.y));
  await win.show(); // Deliberately never setFocus or use openNoteWindow here.
}
