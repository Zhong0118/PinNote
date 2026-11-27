// App appearance (theme, shadows, motion, glass) shared by every window. The resolved
// values live on <html> as data attributes; components only read semantic CSS variables.
import { listen } from '@tauri-apps/api/event';
import { Effect, EffectState, getCurrentWindow } from '@tauri-apps/api/window';
import { defaultAppearance, isMacPlatform, isNativeApp, loadSettings, normalizeAppearance, type AppSettings, type AppearanceSettings } from './settings';

const KEY = 'pinnote.appearance';
let current: AppearanceSettings = cached();
const subscribers = new Set<(a: AppearanceSettings, dark: boolean) => void>();

function cached(): AppearanceSettings {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...defaultAppearance }; }
}
const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
const systemReduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const systemReduceTransparency = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-transparency: reduce)').matches;

export const isDark = (a = current) => a.theme === 'dark' || (a.theme === 'system' && systemDark());
export const motionReduced = () => current.reduceMotion || systemReduce();
/** Effective macOS glass strength (0..100), forced to 0 when the OS enables "Reduce transparency". */
export const effectiveGlass = (a = current) => systemReduceTransparency() ? 0 : a.glass;
export const celebrationsEnabled = () => current.celebrate && !motionReduced();
export const appearance = () => current;

/** Apply to this window. `persist` caches it for the next window's first paint. */
export function applyAppearance(next: AppearanceSettings, persist = true, syncNativeTheme = true) {
  current = next;
  if (persist) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* cache only */ } }
  const root = document.documentElement, dark = isDark(next);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.motion = motionReduced() ? 'reduce' : '';
  root.dataset.centerShadow = next.centerShadow;
  root.dataset.noteShadow = next.noteShadow;
  root.dataset.paperGrid = next.paperGrid ? 'on' : 'off';
  // Glass: luminous translucent surface over vibrant macOS frosted blur.
  const level = effectiveGlass(next);
  const glass = level / 100;
  root.style.setProperty('--glass-chrome', level === 0 ? '100%' : `${Math.round((0.82 - 0.64 * glass) * 100)}%`);
  root.style.setProperty('--glass-page', level === 0 ? '100%' : `${Math.round((0.92 - 0.44 * glass) * 100)}%`);
  root.style.setProperty('--glass-note', level === 0 ? '100%' : `${Math.round((0.9 - 0.46 * glass) * 100)}%`);
  root.style.setProperty('--editor-font-size', `${next.editorFontSize ?? 14}px`);
  // Native chrome (title bar, menus, vibrancy tint) follows the same theme.
  if (syncNativeTheme && isNativeApp()) void getCurrentWindow().setTheme(next.theme === 'system' ? null : next.theme).catch(() => undefined);
  subscribers.forEach(fn => fn(next, dark));
}

/** Sync only the native window theme (used when coordinating with a DOM transition). */
export function syncWindowTheme(theme: AppearanceSettings['theme'] = current.theme) {
  if (isNativeApp()) void getCurrentWindow().setTheme(theme === 'system' ? null : theme).catch(() => undefined);
}

// Each `setEffects` call adds a native NSVisualEffectView on macOS, so updates are
// serialized and de-duplicated to avoid stacking or out-of-order clear/apply races.
let glassQueue: Promise<void> = Promise.resolve();
let desiredGlass = '';
let appliedGlass = '';

export function applyWindowGlass(on: boolean, radius?: number, style: 'popover' | 'hud' = 'hud'): Promise<void> {
  if (!isMacPlatform() || !isNativeApp()) return Promise.resolve();
  const key = on ? `on:${style}:${radius ?? 'auto'}` : 'off';
  desiredGlass = key;
  glassQueue = glassQueue.then(async () => {
    if (desiredGlass !== key || appliedGlass === key) return;
    const win = getCurrentWindow();
    try {
      await win.clearEffects();
      if (desiredGlass !== key) { appliedGlass = 'off'; return; }
      if (on) {
        await win.setEffects({
          effects: [style === 'popover' ? Effect.Popover : Effect.HudWindow],
          state: EffectState.Active,
          ...(radius !== undefined ? { radius } : {}),
        });
      }
      appliedGlass = key;
    } catch { /* plain window fallback */ }
  });
  return glassQueue;
}

/** Called for every window from the root layout. */
export function initAppearance() {
  applyAppearance(current, false);
  void loadSettings().then(s => applyAppearance(s.appearance)).catch(() => undefined);
  const media = typeof matchMedia !== 'undefined' ? [
    matchMedia('(prefers-color-scheme: dark)'),
    matchMedia('(prefers-reduced-motion: reduce)'),
    matchMedia('(prefers-reduced-transparency: reduce)'),
  ] : [];
  // Following the system: react live to OS changes, no reload and no editor rebuild.
  const follow = () => applyAppearance(current, false);
  media.forEach(m => m.addEventListener('change', follow));
  const stops = isNativeApp() ? [
    listen<AppSettings>('settings-changed', e => applyAppearance(normalizeAppearance(e.payload.appearance))),
    // Live preview from the settings view while a control is being dragged.
    listen<AppearanceSettings>('appearance-preview', e => applyAppearance(normalizeAppearance(e.payload), false)),
  ] : [];
  return () => { media.forEach(m => m.removeEventListener('change', follow)); stops.forEach(p => void p.then(f => f())); };
}

export function onAppearance(fn: (a: AppearanceSettings, dark: boolean) => void) {
  subscribers.add(fn); fn(current, isDark());
  return () => { subscribers.delete(fn); };
}
