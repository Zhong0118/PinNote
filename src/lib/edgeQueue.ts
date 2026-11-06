import { CAPSULE, displayFor, type Bounds, type Display } from './windowGeometry';
import type { PinNote, NoteWindowState } from './notesStore';

export function edgeTarget(bounds: Bounds, displays: Display[]): NoteWindowState['edge'] {
  const display = displayFor(bounds, displays);
  if (!display) return null;
  const { position: p, size: s } = display.workArea;
  const threshold = 28 * display.scaleFactor;
  const side = Math.abs(bounds.x - p.x) < threshold ? 'left' : Math.abs(bounds.x + bounds.width * display.scaleFactor - p.x - s.width) < threshold ? 'right' : null;
  return side ? { side, display: `${p.x}:${p.y}`, order: bounds.y } : null;
}

export function edgeOrder(id:string, edge:NonNullable<NoteWindowState['edge']>, bounds:Bounds, notes:PinNote[], displays:Display[]) {
  const display=displayFor(bounds,displays); if(!display)return edge.order;
  const peers=notes.filter(n=>n.id!==id&&n.lifecycle==='active'&&n.placement==='desktop'&&n.window.collapsed&&n.window.edge?.display===edge.display&&n.window.edge.side===edge.side)
    .sort((a,b)=>a.window.edge!.order-b.window.edge!.order||a.id.localeCompare(b.id));
  const index=Math.max(0,Math.min(peers.length,Math.round((bounds.y-display.workArea.position.y)/(48*display.scaleFactor))));
  const before=peers[index-1]?.window.edge?.order;const after=peers[index]?.window.edge?.order;
  return before==null?(after??1)-1:after==null?before+1:(before+after)/2;
}

export function edgeLayout(notes: PinNote[], displays: Display[]) {
  const result = new Map<string, { bounds: Bounds; overflow: boolean; extra: number }>();
  for (const display of displays) for (const side of ['left', 'right'] as const) {
    const { position: p, size: s } = display.workArea;
    const key = `${p.x}:${p.y}`;
    const known = new Set(displays.map(d => `${d.workArea.position.x}:${d.workArea.position.y}`));
    const queue = notes.filter(n => n.lifecycle === 'active' && n.placement === 'desktop' && n.window.collapsed && n.window.edge?.side === side &&
      (n.window.edge.display === key || (!known.has(n.window.edge.display) && display === displays[0])))
      .sort((a,b) => a.window.edge!.order - b.window.edge!.order || a.id.localeCompare(b.id));
    const scaleFactor = display.scaleFactor;
    const capacity = Math.max(1, Math.floor(s.height / (48 * scaleFactor)));
    queue.forEach((note, i) => result.set(note.id, { overflow: i >= capacity, extra: i === capacity - 1 ? Math.max(0, queue.length - capacity) : 0,
      bounds: { x: side === 'left' ? p.x : p.x + s.width - CAPSULE.width * scaleFactor,
        y: p.y + Math.min(i, capacity - 1) * 48 * scaleFactor, ...CAPSULE, scaleFactor } }));
  }
  return result;
}
