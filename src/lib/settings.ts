import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

export type NoteTheme = "paper" | "mint" | "rose" | "sky" | "grape" | "ink" | "custom";

export type ShortcutConfig = {
  toggleWindow: string;
  newNote: string;
};

export type ThemeMode = "system" | "light" | "dark";
export type ShadowLevel = "off" | "light" | "standard";
export type AppearanceSettings = { theme: ThemeMode; centerShadow: ShadowLevel; noteShadow: ShadowLevel; reduceMotion: boolean };
/** `hideFromCapture`: ask the system to keep PinNote windows out of screenshots and screen sharing. */
export type BehaviorSettings = { edgeSnap: boolean; hoverPreview: boolean; restoreSession: boolean; hideFromCapture: boolean };

export type AppSettings = {
  autoStart: boolean;
  shortcuts: ShortcutConfig;
  appearance: AppearanceSettings;
  behavior: BehaviorSettings;
  /** Applied to new notes only; never rewrites existing notes. */
  defaultNote: {
    alwaysOnTop: boolean;
    opacity: number;
    theme: NoteTheme;
    customColor: string;
  };
};

const settingsKey = "pinnote.settings.v1";

export const windowsDefaultShortcuts: ShortcutConfig = {
  toggleWindow: "Alt+N",
  newNote: "Alt+Shift+N",
};

export const macDefaultShortcuts: ShortcutConfig = {
  toggleWindow: "CmdOrCtrl+Option+N",
  newNote: "CmdOrCtrl+Option+Shift+N",
};

export const defaultShortcuts: ShortcutConfig = windowsDefaultShortcuts;

export const defaultAppearance: AppearanceSettings = { theme: "system", centerShadow: "standard", noteShadow: "standard", reduceMotion: false };
export const defaultBehavior: BehaviorSettings = { edgeSnap: true, hoverPreview: true, restoreSession: true, hideFromCapture: false };

export const defaultSettings: AppSettings = {
  autoStart: false,
  shortcuts: { ...platformDefaultShortcuts() },
  appearance: { ...defaultAppearance },
  behavior: { ...defaultBehavior },
  defaultNote: {
    alwaysOnTop: true,
    opacity: 0.96,
    theme: "paper",
    customColor: "#2d7d74",
  },
};

export async function loadSettings() {
  if (!browser) return createDefaultSettings();

  try {
    const raw = await invoke<string | null>("load_settings");
    if (raw) {
      return normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
    }
  } catch {
    // Browser preview or first versions used localStorage.
  }

  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return createDefaultSettings();

    const settings = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
    // Migrate settings from early versions; a failure leaves them readable here.
    void saveSettings(settings).catch(() => undefined);
    return settings;
  } catch {
    return createDefaultSettings();
  }
}

/** True inside the Tauri app; false in a plain browser preview of the frontend. */
export const isNativeApp = () => browser && "__TAURI_INTERNALS__" in window;

/**
 * Persist settings natively. A failure is thrown so the caller can show it and retry;
 * only a plain browser preview (no native app) keeps them in localStorage.
 */
export async function saveSettings(settings: AppSettings): Promise<"saved" | "preview"> {
  if (!browser) return "preview";
  const json = JSON.stringify(settings);
  if (!isNativeApp()) { localStorage.setItem(settingsKey, json); return "preview"; }
  await invoke("save_settings", { json });
  return "saved";
}

function normalizeSettings(settings: Partial<AppSettings>) {
  const shortcuts = normalizeShortcuts(settings.shortcuts);
  const legacy = settings as Partial<AppSettings> & {
    alwaysOnTop?: boolean;
    opacity?: number;
    theme?: NoteTheme;
    customColor?: string;
  };

  return {
    ...createDefaultSettings(),
    ...settings,
    shortcuts,
    appearance: normalizeAppearance(settings.appearance),
    behavior: { ...defaultBehavior, ...pickBooleans(settings.behavior, defaultBehavior) },
    defaultNote: {
      ...defaultSettings.defaultNote,
      ...settings.defaultNote,
      alwaysOnTop: legacy.alwaysOnTop ?? settings.defaultNote?.alwaysOnTop ?? defaultSettings.defaultNote.alwaysOnTop,
      opacity: legacy.opacity ?? settings.defaultNote?.opacity ?? defaultSettings.defaultNote.opacity,
      theme: legacy.theme ?? settings.defaultNote?.theme ?? defaultSettings.defaultNote.theme,
      customColor: legacy.customColor ?? settings.defaultNote?.customColor ?? defaultSettings.defaultNote.customColor,
    },
  };
}

function pickBooleans<T extends Record<string, boolean>>(value: unknown, fallback: T): T {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(fallback).map(([k, v]) => [k, typeof source[k] === "boolean" ? source[k] : v])) as T;
}

export function normalizeAppearance(value: unknown): AppearanceSettings {
  const a = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const shadow = (v: unknown, d: ShadowLevel) => (v === "off" || v === "light" || v === "standard" ? v : d);
  return {
    theme: a.theme === "light" || a.theme === "dark" || a.theme === "system" ? a.theme : defaultAppearance.theme,
    centerShadow: shadow(a.centerShadow, defaultAppearance.centerShadow),
    noteShadow: shadow(a.noteShadow, defaultAppearance.noteShadow),
    reduceMotion: typeof a.reduceMotion === "boolean" ? a.reduceMotion : defaultAppearance.reduceMotion,
  };
}

export function createDefaultSettings(): AppSettings {
  return {
    ...defaultSettings,
    appearance: { ...defaultAppearance },
    behavior: { ...defaultBehavior },
    shortcuts: { ...platformDefaultShortcuts() },
    defaultNote: { ...defaultSettings.defaultNote },
  };
}

export function platformDefaultShortcuts() {
  return isMacPlatform() ? macDefaultShortcuts : windowsDefaultShortcuts;
}

export function isMacPlatform() {
  if (!browser) return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

export function shortcutKeyFromEvent(event: Pick<KeyboardEvent, "key" | "code">) {
  // Native global shortcuts use physical keys, even when Option produces a dead key.
  if (/^(Key[A-Z]|Digit[0-9])$/.test(event.code)) return formatShortcutKey(event.code);
  if (["Dead", "Process", "Unidentified"].includes(event.key)) return "";
  return formatShortcutKey(event.key);
}

export function normalizeShortcut(value: string) {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const modifiers: string[] = [];
  let key = "";

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (["CTRL", "CONTROL"].includes(upper)) addModifier(modifiers, "Ctrl");
    else if (["ALT", "OPTION"].includes(upper)) addModifier(modifiers, altModifierName());
    else if (["CMD", "COMMAND", "SUPER"].includes(upper)) addModifier(modifiers, "Cmd");
    else if (["CMDORCTRL", "CMDORCONTROL", "COMMANDORCTRL", "COMMANDORCONTROL"].includes(upper)) {
      addModifier(modifiers, "CmdOrCtrl");
    } else if (upper === "SHIFT") addModifier(modifiers, "Shift");
    else key = formatShortcutKey(part);
  }

  return [...modifiers, key].filter(Boolean).join("+");
}

export function shortcutIdentity(value: string) {
  const normalized = normalizeShortcut(value);
  const modifiers = new Set<string>();
  let key = "";

  for (const part of normalized.split("+")) {
    const upper = part.toUpperCase();
    if (upper === "CMDORCTRL") modifiers.add(isMacPlatform() ? "CMD" : "CTRL");
    else if (upper === "CMD") modifiers.add("CMD");
    else if (upper === "CTRL") modifiers.add("CTRL");
    else if (upper === "OPTION" || upper === "ALT") modifiers.add("ALT");
    else if (upper === "SHIFT") modifiers.add("SHIFT");
    else key = upper;
  }

  return ["CTRL", "ALT", "SHIFT", "CMD"].filter((modifier) => modifiers.has(modifier)).concat(key).join("+");
}

function normalizeShortcuts(shortcuts?: Partial<ShortcutConfig>) {
  const defaults = platformDefaultShortcuts();
  const loaded = {
    toggleWindow: shortcuts?.toggleWindow ?? defaults.toggleWindow,
    newNote: shortcuts?.newNote ?? defaults.newNote,
  };

  if (isMacPlatform()) {
    if (loaded.toggleWindow === windowsDefaultShortcuts.toggleWindow) {
      loaded.toggleWindow = defaults.toggleWindow;
    }
    if (loaded.newNote === windowsDefaultShortcuts.newNote) {
      loaded.newNote = defaults.newNote;
    }
  }

  return {
    toggleWindow: normalizeShortcut(loaded.toggleWindow),
    newNote: normalizeShortcut(loaded.newNote),
  };
}

function addModifier(modifiers: string[], modifier: string) {
  if (!modifiers.includes(modifier)) modifiers.push(modifier);
}

function altModifierName() {
  return isMacPlatform() ? "Option" : "Alt";
}

function formatShortcutKey(key: string) {
  const aliases: Record<string, string> = {
    " ": "Space",
    ARROWUP: "ArrowUp",
    ARROWDOWN: "ArrowDown",
    ARROWLEFT: "ArrowLeft",
    ARROWRIGHT: "ArrowRight",
    ESC: "Escape",
  };
  const upper = key.toUpperCase();
  if (/^KEY[A-Z]$/.test(upper)) return upper.slice(3);
  if (/^DIGIT[0-9]$/.test(upper)) return upper.slice(5);
  return aliases[upper] ?? (key.length === 1 ? upper : key);
}
