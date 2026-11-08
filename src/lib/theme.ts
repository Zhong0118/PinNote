// App appearance (theme, shadows, motion) shared by every window. The resolved values
// live on <html> as data attributes; components only read semantic CSS variables.
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { defaultAppearance, isNativeApp, loadSettings, normalizeAppearance, type AppSettings, type AppearanceSettings } from './settings';

const KEY = 'pinnote.appearance';
let current: AppearanceSettings = cached();
const subscribers = new Set<(a: AppearanceSettings, dark: boolean) => void>();

function cached(): AppearanceSettings {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...defaultAppearance }; }
}
const systemDark = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
const systemReduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isDark = (a = current) => a.theme === 'dark' || (a.theme === 'system' && systemDark());
export const motionReduced = () => current.reduceMotion || systemReduce();
export const appearance = () => current;

/** Apply to this window. `persist` caches it for the next window's first paint. */
export function applyAppearance(next: AppearanceSettings, persist = true) {
  current = next;
  if (persist) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* cache only */ } }
  const root = document.documentElement, dark = isDark(next);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.motion = motionReduced() ? 'reduce' : '';
  root.dataset.centerShadow = next.centerShadow;
  root.dataset.noteShadow = next.noteShadow;
  // Native chrome (title bar, menus, color panel) follows the same theme.
  if (isNativeApp()) void getCurrentWindow().setTheme(next.theme === 'system' ? null : next.theme).catch(() => undefined);
  subscribers.forEach(fn => fn(next, dark));
}

/** Called for every window from the root layout. */
export function initAppearance() {
  applyAppearance(current, false);
  void loadSettings().then(s => applyAppearance(s.appearance)).catch(() => undefined);
  const media = typeof matchMedia !== 'undefined' ? [matchMedia('(prefers-color-scheme: dark)'), matchMedia('(prefers-reduced-motion: reduce)')] : [];
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
