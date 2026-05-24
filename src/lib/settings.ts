import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

export type NoteTheme = "paper" | "mint" | "rose" | "sky" | "grape" | "ink" | "custom";

export type ShortcutConfig = {
  toggleWindow: string;
  newNote: string;
};

export type AppSettings = {
  autoStart: boolean;
  shortcuts: ShortcutConfig;
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

export const defaultSettings: AppSettings = {
  autoStart: false,
  shortcuts: { ...platformDefaultShortcuts() },
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
    void saveSettings(settings);
    return settings;
  } catch {
    return createDefaultSettings();
  }
}

export async function saveSettings(settings: AppSettings) {
  if (!browser) return;

  const json = JSON.stringify(settings);
  try {
    await invoke("save_settings", { json });
  } catch {
    localStorage.setItem(settingsKey, json);
  }
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

export function createDefaultSettings(): AppSettings {
  return {
    ...defaultSettings,
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
  if (key.length === 1) return key.toUpperCase();
  return aliases[upper] ?? key;
}
