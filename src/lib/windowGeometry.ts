import type { NoteWindowState } from './notesStore';

export const CAPSULE = { width: 180, height: 40 };
/** A docked note is a slim bookmark tab: flat against the screen edge, rounded inward. */
export const EDGE_TAB = { width: 28, height: 64 };
export const EDGE_PITCH = 70;
export const EDGE_INSET = 12;
/** Smallest frame any note window may take (edge tab or capsule). */
export const NOTE_MIN = { width: Math.min(CAPSULE.width, EDGE_TAB.width), height: Math.min(CAPSULE.height, EDGE_TAB.height) };
export const EDITOR_MIN = { width: 260, height: 180 };
export type Bounds = { x: number; y: number; width: number; height: number; scaleFactor: number; space?: 'logical'; nativeScale?: number };
export type Display = { name?: string | null; scaleFactor: number; workArea: { position: { x: number; y: number }; size: { width: number; height: number } } };

// Windows exposes global physical coordinates; macOS scales each global origin
// by its own monitor's DPI. Normalize macOS to one global logical coordinate space.
export function normalizeBounds(bounds: Bounds, isMac: boolean): Bounds {
  if (!isMac) return bounds;
  return { ...bounds, x: bounds.x / bounds.scaleFactor, y: bounds.y / bounds.scaleFactor,
    scaleFactor: 1, space: 'logical', nativeScale: bounds.scaleFactor };
}

export function normalizeDisplays(displays: Display[], isMac: boolean): Display[] {
  if (!isMac) return displays;
  return displays.map(({ name, scaleFactor, workArea }) => ({ name, scaleFactor: 1, workArea: {
    position: { x: workArea.position.x / scaleFactor, y: workArea.position.y / scaleFactor },
    size: { width: workArea.size.width / scaleFactor, height: workArea.size.height / scaleFactor },
  } }));
}

export function displayFor(bounds: Bounds, displays: Display[]): Display | undefined {
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
  const size = state.collapsed ? (state.edge ? EDGE_TAB : CAPSULE) : { width: Math.max(EDITOR_MIN.width, state.width), height: Math.max(EDITOR_MIN.height, state.height) };
  return fitBounds({ ...current, ...position, ...size }, displays);
}

/**
 * Arrange desktop notes cleanly in columns starting from the top-right of `display.workArea`,
 * wrapping left when a column runs out of vertical space and never overflowing the work area.
 */
export function arrangeDesktopBounds(
  notes: Array<{ id: string; window: Pick<NoteWindowState, 'width' | 'height'> }>,
  display: Display,
  gap = 12,
): Map<string, Bounds> {
  const result = new Map<string, Bounds>();
  if (!notes.length) return result;
  const { position: p, size: s } = display.workArea;
  const scale = display.scaleFactor;
  const maxW = Math.max(EDITOR_MIN.width, Math.floor(s.width / scale - gap * 2));
  const maxH = Math.max(EDITOR_MIN.height, Math.floor(s.height / scale - gap * 2));
  const stepGap = gap * scale;

  let colRight = p.x + s.width - stepGap;
  let colY = p.y + stepGap;
  let colWidth = 0;

  for (const item of notes) {
    const width = Math.min(maxW, Math.max(EDITOR_MIN.width, item.window.width || 340));
    const height = Math.min(maxH, Math.max(EDITOR_MIN.height, item.window.height || 300));
    const wPx = width * scale;
    const hPx = height * scale;

    if (colWidth > 0 && colY + hPx > p.y + s.height - stepGap) {
      colRight -= colWidth + stepGap;
      colY = p.y + stepGap;
      colWidth = 0;
    }

    const raw: Bounds = {
      x: Math.round(colRight - wPx),
      y: Math.round(colY),
      width,
      height,
      scaleFactor: scale,
    };
    result.set(item.id, fitBounds(raw, [display]));
    colY += hPx + stepGap;
    colWidth = Math.max(colWidth, wPx);
  }
  return result;
}
