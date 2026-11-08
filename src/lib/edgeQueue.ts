import { EDGE_TAB, EDGE_PITCH, EDGE_INSET, EDITOR_MIN, displayFor, fitBounds, type Bounds, type Display } from './windowGeometry';
import type { PinNote, NoteWindowState } from './notesStore';

export function edgeTarget(bounds: Bounds, displays: Display[]): NoteWindowState['edge'] {
  const display = displayFor(bounds, displays);
  if (!display) return null;
  const { position: p, size: s } = display.workArea;
  const threshold = 48 * display.scaleFactor;
  // Native dragging may overshoot the work area (Dock/taskbar or screen edge).
  // Crossing an edge should keep the snap target instead of losing it at 28px.
  const left=bounds.x-p.x;
  const right=p.x+s.width-(bounds.x+bounds.width*display.scaleFactor);
  const side = left<=threshold && left<=right ? 'left' : right<=threshold ? 'right' : null;
  return side ? { side, display: display.name || `${p.x}:${p.y}`, order: bounds.y } : null;
}

/** Docked notes keep their slot while expanded, so peers never jump when one opens. */
const docked = (n: PinNote) => n.lifecycle === 'active' && n.placement === 'desktop' && Boolean(n.window.edge);
type Edge = NonNullable<NoteWindowState['edge']>;
const positionKey = (d: Display) => `${d.workArea.position.x}:${d.workArea.position.y}`;
/** An edge belongs to a display by its stable name or, for older data, its work-area origin. */
const onDisplay = (edge: Edge, d: Display) => edge.display === positionKey(d) || (Boolean(d.name) && edge.display === d.name);
const byOrder = (a: PinNote, b: PinNote) => a.window.edge!.order - b.window.edge!.order || a.id.localeCompare(b.id);

/** Notes queued on one edge of one display, in order. Unknown displays fall back to the first. */
function queueFor(notes: PinNote[], display: Display, side: 'left' | 'right', displays: Display[], except?: string) {
  const primary = display === displays[0];
  return notes.filter(n => n.id !== except && docked(n) && n.window.edge!.side === side &&
    (onDisplay(n.window.edge!, display) || (primary && !displays.some(d => onDisplay(n.window.edge!, d))))).sort(byOrder);
}

/** Top of the first slot: the most recently placed queue start, kept inside the work area. */
function queueStart(queue: PinNote[], display: Display, slots: number) {
  const { position: p, size: s } = display.workArea;
  const scale = display.scaleFactor;
  const min = p.y + EDGE_INSET * scale;
  const set = queue.filter(n => Number.isFinite(n.window.edge!.top)).sort((a, b) => (b.window.edge!.topAt ?? 0) - (a.window.edge!.topAt ?? 0))[0];
  if (!set) return min;
  const span = ((slots - 1) * EDGE_PITCH + EDGE_TAB.height) * scale;
  const max = p.y + s.height - EDGE_INSET * scale - span;
  return Math.round(Math.max(min, Math.min(max, p.y + set.window.edge!.top! * s.height)));
}
const capacityOf = (display: Display) => Math.max(1, Math.floor((display.workArea.size.height - EDGE_INSET * display.scaleFactor) / (EDGE_PITCH * display.scaleFactor)));

/**
 * Where a tab dropped at `bounds` goes: its order among peers, and when it lands first
 * (or alone) the queue start moves to where it was dropped instead of snapping to the top.
 */
export function edgePlacement(id: string, edge: Edge, bounds: Bounds, notes: PinNote[], displays: Display[]): Edge {
  const display = displayFor(bounds, displays); if (!display) return edge;
  const peers = queueFor(notes, display, edge.side, displays, id);
  const scale = display.scaleFactor, pitch = EDGE_PITCH * scale;
  const start = queueStart(peers, display, Math.min(peers.length + 1, capacityOf(display)));
  const index = Math.max(0, Math.min(peers.length, Math.round((bounds.y - start) / pitch)));
  const before = peers[index - 1]?.window.edge?.order; const after = peers[index]?.window.edge?.order;
  const order = before == null ? (after ?? 1) - 1 : after == null ? before + 1 : (before + after) / 2;
  if (index > 0) return { ...edge, order, top: undefined, topAt: undefined };
  const { position: p, size: s } = display.workArea;
  return { ...edge, order, top: Math.max(0, Math.min(1, (bounds.y - p.y) / s.height)), topAt: Date.now() };
}

/** Kept for callers that only need the order. */
export function edgeOrder(id: string, edge: Edge, bounds: Bounds, notes: PinNote[], displays: Display[]) {
  return edgePlacement(id, edge, bounds, notes, displays).order;
}

export type EdgeSlot = { bounds: Bounds; overflow: boolean; extra: number; side: 'left' | 'right'; display: Display };

export function edgeLayout(notes: PinNote[], displays: Display[]) {
  const result = new Map<string, EdgeSlot>();
  for (const display of displays) for (const side of ['left', 'right'] as const) {
    const { position: p, size: s } = display.workArea;
    const queue = queueFor(notes, display, side, displays);
    if (!queue.length) continue;
    const scaleFactor = display.scaleFactor;
    const capacity = capacityOf(display);
    const start = queueStart(queue, display, Math.min(queue.length, capacity));
    queue.forEach((note, i) => result.set(note.id, { side, display,
      overflow: i >= capacity, extra: i === capacity - 1 ? Math.max(0, queue.length - capacity) : 0,
      bounds: { x: side === 'left' ? p.x : p.x + s.width - EDGE_TAB.width * scaleFactor,
        y: start + Math.min(i, capacity - 1) * EDGE_PITCH * scaleFactor, ...EDGE_TAB, scaleFactor } }));
  }
  return result;
}

/** An expanded docked note opens inward from its tab, flush with the same edge. */
export function dockedEditorBounds(slot: EdgeSlot, size: { width: number; height: number }, displays: Display[]): Bounds {
  const { position: p, size: s } = slot.display.workArea;
  const scale = slot.display.scaleFactor;
  const width = Math.max(EDITOR_MIN.width, size.width);
  const height = Math.max(EDITOR_MIN.height, size.height);
  return fitBounds({ ...slot.bounds, width, height,
    x: slot.side === 'left' ? p.x : p.x + s.width - width * scale,
    y: slot.bounds.y - 8 * scale }, displays, slot.bounds);
}
