import { displayFor, fitBounds, type Bounds, type Display } from './windowGeometry';

/**
 * The note center is a normal window that collapses straight to an edge handle.
 * `bar` is an optional free strip reachable only from the window menu.
 */
export type CenterMode = 'window' | 'handle' | 'bar';
export type CenterSide = 'left' | 'right';
/** Where the handle sits: a stable display id, the edge, and its vertical centre as a work-area ratio. */
export type CenterDock = { display: string; side: CenterSide; ratio: number };
export type Range = { top: number; bottom: number };

export const CENTER_WINDOW_MIN = { width: 560, height: 380 };
export const CENTER_BAR = { width: 320, height: 40 };
export const CENTER_HANDLE = { width: 24, height: 96 };
/** Logical px the window must be pushed past an edge, or the pointer must be within, to snap. */
export const SNAP_OVERSHOOT = 24;
export const SNAP_POINTER = 6;
/** Logical px the handle must be pulled inward before it turns back into the window. */
export const DETACH_PULL = 56;
const HANDLE_MARGIN = 8;
const DEFAULT_RATIO = 0.78;

export const displayKey = (d: Display) => d.name || `${d.workArea.position.x}:${d.workArea.position.y}`;

/** The dock's display, or the first (primary) display when it was unplugged. */
export function dockDisplay(dock: CenterDock, displays: Display[]): Display | undefined {
  return displays.find(d => d.name && d.name === dock.display)
    ?? displays.find(d => `${d.workArea.position.x}:${d.workArea.position.y}` === dock.display)
    ?? displays[0];
}

/** Nearest y for a `height` tall item that overlaps none of `ranges`, within [min, max]. */
export function avoidRanges(y: number, height: number, ranges: Range[], min: number, max: number, gap = 6): number {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const free = (v: number) => ranges.every(r => v + height <= r.top - gap / 2 || v >= r.bottom + gap / 2);
  y = clamp(y);
  if (free(y)) return y;
  const candidates = ranges.flatMap(r => [r.bottom + gap, r.top - gap - height]).map(clamp).filter(free);
  return candidates.sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0] ?? y;
}

/** Handle frame for a dock, kept inside the work area and clear of note tabs on that edge. */
export function handleBounds(dock: CenterDock, displays: Display[], avoid: Range[] = []): Bounds {
  const display = dockDisplay(dock, displays);
  const scale = display?.scaleFactor ?? 1;
  if (!display) return { x: 0, y: 0, ...CENTER_HANDLE, scaleFactor: scale };
  const { position: p, size: s } = display.workArea;
  const h = CENTER_HANDLE.height * scale;
  const ratio = Number.isFinite(dock.ratio) ? Math.max(0, Math.min(1, dock.ratio)) : DEFAULT_RATIO;
  const y = avoidRanges(p.y + ratio * s.height - h / 2, h, avoid, p.y + HANDLE_MARGIN * scale, p.y + s.height - h - HANDLE_MARGIN * scale);
  return { x: dock.side === 'left' ? p.x : p.x + s.width - CENTER_HANDLE.width * scale, y: Math.round(y), ...CENTER_HANDLE, scaleFactor: scale };
}

/** Dock that keeps a handle (or pointer) at `y` on `side` of the display under it. */
export function dockAt(point: { x: number; y: number }, side: CenterSide, displays: Display[]): CenterDock {
  const display = displayFor({ x: point.x, y: point.y, width: 1, height: 1, scaleFactor: 1 }, displays) ?? displays[0];
  if (!display) return { display: '', side, ratio: DEFAULT_RATIO };
  const { position: p, size: s } = display.workArea;
  return { display: displayKey(display), side, ratio: Math.max(0, Math.min(1, (point.y - p.y) / s.height)) };
}

/** Which edge a window being dragged should snap to, if any. */
export function snapSide(window: Bounds, pointer: { x: number; y: number } | undefined, displays: Display[]): CenterSide | null {
  const anchor = pointer ? { x: pointer.x, y: pointer.y, width: 1, height: 1, scaleFactor: 1 } : window;
  const display = displayFor(anchor, displays);
  if (!display) return null;
  const { position: p, size: s } = display.workArea;
  const scale = display.scaleFactor;
  const right = window.x + window.width * window.scaleFactor;
  const pastLeft = p.x - window.x, pastRight = right - (p.x + s.width);
  if (pastLeft >= SNAP_OVERSHOOT * scale || (pointer && pointer.x <= p.x + SNAP_POINTER * scale)) return 'left';
  if (pastRight >= SNAP_OVERSHOOT * scale || (pointer && pointer.x >= p.x + s.width - SNAP_POINTER * scale)) return 'right';
  return null;
}

/** The normal window placed under a pointer that pulled the handle inward: the pointer
 * lands on the title bar, near the end that faces the edge, so the grab stays continuous. */
export function detachedBounds(size: { width: number; height: number }, pointer: { x: number; y: number }, side: CenterSide, displays: Display[]): Bounds {
  const display = displayFor({ ...pointer, width: 1, height: 1, scaleFactor: 1 }, displays) ?? displays[0];
  const scale = display?.scaleFactor ?? 1;
  const grabX = Math.min(size.width / 2, 120);
  const x = side === 'right' ? pointer.x - (size.width - grabX) * scale : pointer.x - grabX * scale;
  return fitBounds({ x, y: pointer.y - 18 * scale, ...size, scaleFactor: scale }, displays);
}

/** A remembered normal-window frame is usable when it is big enough and mostly on a display. */
export function validWindow(bounds: Partial<Bounds> | undefined, displays: Display[]): bounds is Bounds {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(v => Number.isFinite(v))) return false;
  if (bounds.width! < CENTER_WINDOW_MIN.width / 2 || bounds.height! < CENTER_WINDOW_MIN.height / 2) return false;
  const b = { scaleFactor: 1, ...bounds } as Bounds;
  return displays.some(({ workArea: { position: p, size: s } }) =>
    Math.min(b.x + b.width * b.scaleFactor, p.x + s.width) - Math.max(b.x, p.x) >= 80 &&
    Math.min(b.y + b.height * b.scaleFactor, p.y + s.height) - Math.max(b.y, p.y) >= 40);
}

export type CenterSession = { mode: CenterMode; dock: CenterDock; pinned: boolean; window?: Bounds; tabs: string[]; selected: string };

/** Reads any saved center state, including the old four-form layout. `panel` was an
 * intermediate step and now maps to the normal window; `handle` keeps its edge. */
export function migrateSession(raw: unknown): CenterSession {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const side: CenterSide = (saved.dock?.side ?? saved.side) === 'left' ? 'left' : 'right';
  const dock: CenterDock = { display: typeof saved.dock?.display === 'string' ? saved.dock.display : '', side,
    ratio: Number.isFinite(saved.dock?.ratio) ? saved.dock.ratio : DEFAULT_RATIO };
  const mode: CenterMode = saved.mode === 'handle' || saved.mode === 'bar' ? saved.mode : 'window';
  const w = saved.window;
  const window = w && [w.x, w.y, w.width, w.height].every((v: unknown) => Number.isFinite(v))
    ? { x: w.x, y: w.y, width: w.width, height: w.height, scaleFactor: Number.isFinite(w.scaleFactor) ? w.scaleFactor : 1 } : undefined;
  return { mode, dock, pinned: Boolean(saved.pinned), window,
    tabs: Array.isArray(saved.tabs) ? saved.tabs.filter((t: unknown) => typeof t === 'string') : [],
    selected: typeof saved.selected === 'string' ? saved.selected : '' };
}

/** The strip keeps the window's top-left corner, so it collapses where the user was looking. */
export function barBounds(from: Bounds, displays: Display[]): Bounds {
  return fitBounds({ ...from, ...CENTER_BAR }, displays, from);
}

/** Collapse toward whichever side the window is already closer to. */
export function nearestSide(bounds: Bounds, display: Display): CenterSide {
  const { position: p, size: s } = display.workArea;
  const center = bounds.x + (bounds.width * bounds.scaleFactor) / 2;
  return center < p.x + s.width / 2 ? 'left' : 'right';
}
