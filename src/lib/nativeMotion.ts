import { invoke } from '@tauri-apps/api/core';
import { isMacPlatform } from './settings';
import type { Bounds } from './windowGeometry';

/** `out`: decelerate into place (opening). `inOut`: symmetric (closing, repositioning). */
export type Curve = 'out' | 'inOut' | 'in';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Native frame/opacity interpolation is macOS-only; elsewhere changes apply directly. */
export const canAnimateWindow = () => isMacPlatform() && !prefersReducedMotion();

/**
 * Animate the calling window's frame and/or opacity on the native side. Omitted
 * parts keep their current value; `duration: 0` applies at once.
 */
export function animateWindow(options: { bounds?: Bounds; alpha?: number; duration?: number; curve?: Curve }) {
  const b = options.bounds;
  return invoke<void>('animate_note_window', {
    x: b?.x, y: b?.y, width: b?.width, height: b?.height,
    alpha: options.alpha, duration: options.duration, curve: options.curve,
  });
}
