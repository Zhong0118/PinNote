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
  return side ? { side, display: `${p.x}:${p.y}`, order: bounds.y } : null;
}

/** Docked notes keep their slot while expanded, so peers never jump when one opens. */
const docked = (n: PinNote) => n.lifecycle === 'active' && n.placement === 'desktop' && Boolean(n.window.edge);

export function edgeOrder(id:string, edge:NonNullable<NoteWindowState['edge']>, bounds:Bounds, notes:PinNote[], displays:Display[]) {
  const display=displayFor(bounds,displays); if(!display)return edge.order;
  const peers=notes.filter(n=>n.id!==id&&docked(n)&&n.window.edge?.display===edge.display&&n.window.edge.side===edge.side)
    .sort((a,b)=>a.window.edge!.order-b.window.edge!.order||a.id.localeCompare(b.id));
  const index=Math.max(0,Math.min(peers.length,Math.round((bounds.y-display.workArea.position.y-EDGE_INSET*display.scaleFactor)/(EDGE_PITCH*display.scaleFactor))));
  const before=peers[index-1]?.window.edge?.order;const after=peers[index]?.window.edge?.order;
  return before==null?(after??1)-1:after==null?before+1:(before+after)/2;
}

export type EdgeSlot = { bounds: Bounds; overflow: boolean; extra: number; side: 'left' | 'right'; display: Display };

export function edgeLayout(notes: PinNote[], displays: Display[]) {
  const result = new Map<string, EdgeSlot>();
  const known = new Set(displays.map(d => `${d.workArea.position.x}:${d.workArea.position.y}`));
  for (const display of displays) for (const side of ['left', 'right'] as const) {
    const { position: p, size: s } = display.workArea;
    const key = `${p.x}:${p.y}`;
    const queue = notes.filter(n => docked(n) && n.window.edge?.side === side &&
      (n.window.edge.display === key || (!known.has(n.window.edge.display) && display === displays[0])))
      .sort((a,b) => a.window.edge!.order - b.window.edge!.order || a.id.localeCompare(b.id));
    const scaleFactor = display.scaleFactor;
    const capacity = Math.max(1, Math.floor((s.height - EDGE_INSET * scaleFactor) / (EDGE_PITCH * scaleFactor)));
    queue.forEach((note, i) => result.set(note.id, { side, display,
      overflow: i >= capacity, extra: i === capacity - 1 ? Math.max(0, queue.length - capacity) : 0,
      bounds: { x: side === 'left' ? p.x : p.x + s.width - EDGE_TAB.width * scaleFactor,
        y: p.y + (EDGE_INSET + Math.min(i, capacity - 1) * EDGE_PITCH) * scaleFactor, ...EDGE_TAB, scaleFactor } }));
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
