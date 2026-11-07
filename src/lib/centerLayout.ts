import { fitBounds, type Bounds, type Display } from './windowGeometry';

/**
 * The note center has one window and two placements, each expandable or collapsed:
 * - `window`: free, normal window        · `bar`: free, collapsed to a compact strip
 * - `panel`: docked flush to a screen edge · `handle`: docked, collapsed to an edge handle
 */
export type CenterMode = 'window' | 'bar' | 'panel' | 'handle';
export type CenterSide = 'left' | 'right';

export const CENTER_WINDOW_MIN = { width: 560, height: 380 };
export const CENTER_PANEL = { width: 440, minWidth: 360 };
export const CENTER_BAR = { width: 320, height: 40 };
export const CENTER_HANDLE = { width: 24, height: 96 };

/**
 * Full-height side panel on `side` of the display's work area. `inset` leaves the
 * edge rail free so docked note tabs on that side stay visible next to the panel.
 */
export function panelBounds(display: Display, side: CenterSide, width: number = CENTER_PANEL.width, inset = 0): Bounds {
  const { position: p, size: s } = display.workArea;
  const scale = display.scaleFactor;
  const w = Math.max(CENTER_PANEL.minWidth, Math.min(width, s.width / scale - inset));
  return { x: side === 'left' ? p.x + inset * scale : p.x + s.width - (w + inset) * scale, y: p.y, width: w, height: s.height / scale, scaleFactor: scale };
}

/** Panel moved fully past its edge: the start/end frame of the slide in/out. */
export function offscreenPanel(panel: Bounds, side: CenterSide, inset = 0): Bounds {
  return { ...panel, x: panel.x + (side === 'left' ? -1 : 1) * (panel.width + inset) * panel.scaleFactor };
}

/**
 * Edge handle in the lower part of the edge, clear of note tabs which stack from the top.
 */
export function handleBounds(display: Display, side: CenterSide): Bounds {
  const { position: p, size: s } = display.workArea;
  const scale = display.scaleFactor;
  return { x: side === 'left' ? p.x : p.x + s.width - CENTER_HANDLE.width * scale,
    y: p.y + s.height - (CENTER_HANDLE.height + 48) * scale, ...CENTER_HANDLE, scaleFactor: scale };
}

/** The strip keeps the window's top-left corner, so it collapses where the user was looking. */
export function barBounds(from: Bounds, displays: Display[]): Bounds {
  return fitBounds({ ...from, ...CENTER_BAR }, displays, from);
}

/** Dock to whichever side the window is already closer to. */
export function nearestSide(bounds: Bounds, display: Display): CenterSide {
  const { position: p, size: s } = display.workArea;
  const center = bounds.x + (bounds.width * bounds.scaleFactor) / 2;
  return center < p.x + s.width / 2 ? 'left' : 'right';
}
