import type { NoteWindowState } from './notesStore';

export const CAPSULE = { width: 180, height: 40 };
export const EDITOR_MIN = { width: 260, height: 180 };
export type Bounds = { x: number; y: number; width: number; height: number; scaleFactor: number; space?: 'logical'; nativeScale?: number };
export type Display = { scaleFactor: number; workArea: { position: { x: number; y: number }; size: { width: number; height: number } } };

// Windows exposes global physical coordinates; macOS scales each global origin
// by its own monitor's DPI. Normalize macOS to one global logical coordinate space.
export function normalizeBounds(bounds: Bounds, isMac: boolean): Bounds {
  if (!isMac) return bounds;
  return { ...bounds, x: bounds.x / bounds.scaleFactor, y: bounds.y / bounds.scaleFactor,
    scaleFactor: 1, space: 'logical', nativeScale: bounds.scaleFactor };
}

export function normalizeDisplays(displays: Display[], isMac: boolean): Display[] {
  if (!isMac) return displays;
  return displays.map(({ scaleFactor, workArea }) => ({ scaleFactor: 1, workArea: {
    position: { x: workArea.position.x / scaleFactor, y: workArea.position.y / scaleFactor },
    size: { width: workArea.size.width / scaleFactor, height: workArea.size.height / scaleFactor },
  } }));
}

function displayFor(bounds: Bounds, displays: Display[]): Display | undefined {
  const right = bounds.x + bounds.width * bounds.scaleFactor;
  const bottom = bounds.y + bounds.height * bounds.scaleFactor;
  const center = { x: (bounds.x + right) / 2, y: (bounds.y + bottom) / 2 };
  const overlap = ({ workArea: { position: p, size: s } }: Display) =>
    Math.max(0, Math.min(right, p.x + s.width) - Math.max(bounds.x, p.x)) *
    Math.max(0, Math.min(bottom, p.y + s.height) - Math.max(bounds.y, p.y));
  const distance = ({ workArea: { position: p, size: s } }: Display) => {
    const dx = Math.max(p.x - center.x, 0, center.x - (p.x + s.width));
    const dy = Math.max(p.y - center.y, 0, center.y - (p.y + s.height));
    return dx * dx + dy * dy;
  };
  return [...displays].sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b))[0];
}

export function fitBounds(bounds: Bounds, displays: Display[], anchor = bounds): Bounds {
  if (!displays.length) return bounds;
  const display = displayFor(anchor, displays)!;
  const { position: p, size: s } = display.workArea;
  const scaleFactor = display.scaleFactor;
  const width = Math.min(bounds.width, s.width / scaleFactor);
  const height = Math.min(bounds.height, s.height / scaleFactor);
  return { ...bounds, x: Math.round(Math.max(p.x, Math.min(bounds.x, p.x + s.width - width * scaleFactor))),
    y: Math.round(Math.max(p.y, Math.min(bounds.y, p.y + s.height - height * scaleFactor))),
    width, height, scaleFactor };
}

export function switchBounds(current: Bounds, state: NoteWindowState, collapsed: boolean, displays: Display[]): Bounds {
  const size = collapsed ? CAPSULE : { width: Math.max(EDITOR_MIN.width, state.width), height: Math.max(EDITOR_MIN.height, state.height) };
  const scaleFactor = displayFor(current, displays)?.scaleFactor ?? current.scaleFactor;
  return fitBounds({ ...current, ...size, scaleFactor,
    x: current.x + current.width * current.scaleFactor - size.width * scaleFactor }, displays, current);
}

function migrateLogicalPositions(state: NoteWindowState, current: Bounds): NoteWindowState {
  if (current.space !== 'logical' || state.positionSpace === 'logical') return state;
  const scale = current.nativeScale ?? 1;
  const position = state.position || state.x != null || state.y != null ? {
    x: state.x ?? (state.position ? state.position.x / scale : current.x),
    y: state.y ?? (state.position ? state.position.y / scale : current.y),
  } : undefined;
  return { ...state, positionSpace: 'logical', position,
    capsulePosition: state.capsulePosition ? {
      x: state.capsulePosition.x / scale, y: state.capsulePosition.y / scale,
    } : undefined };
}

export function rememberBounds(state: NoteWindowState, bounds: Bounds): NoteWindowState {
  state = migrateLogicalPositions(state, bounds);
  const position = { x: Math.round(bounds.x), y: Math.round(bounds.y) };
  if (state.collapsed) return { ...state, capsulePosition: position };
  return { ...state, position, x: Math.round(bounds.x / bounds.scaleFactor), y: Math.round(bounds.y / bounds.scaleFactor),
    width: Math.round(bounds.width), height: Math.round(bounds.height) };
}

export function restoreBounds(state: NoteWindowState, current: Bounds, displays: Display[]): Bounds {
  state = migrateLogicalPositions(state, current);
  const position = (state.collapsed ? state.capsulePosition : state.position) ?? state.position ?? {
    x: state.x == null ? current.x : state.x * current.scaleFactor,
    y: state.y == null ? current.y : state.y * current.scaleFactor,
  };
  const size = state.collapsed ? CAPSULE : { width: Math.max(EDITOR_MIN.width, state.width), height: Math.max(EDITOR_MIN.height, state.height) };
  return fitBounds({ ...current, ...position, ...size }, displays);
}
