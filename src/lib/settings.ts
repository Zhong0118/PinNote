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

export const defaultShortcuts: ShortcutConfig = {
  toggleWindow: "Alt+N",
  newNote: "Alt+Shift+N",
};

export const defaultSettings: AppSettings = {
  autoStart: false,
  shortcuts: { ...defaultShortcuts },
  defaultNote: {
    alwaysOnTop: true,
    opacity: 0.96,
    theme: "paper",
    customColor: "#2d7d74",
  },
};

export async function loadSettings() {
  if (!browser) return { ...defaultSettings };

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
    if (!raw) return { ...defaultSettings };

    const settings = normalizeSettings(JSON.parse(raw) as Partial<AppSettings>);
    void saveSettings(settings);
    return settings;
  } catch {
    return { ...defaultSettings };
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
  const legacy = settings as Partial<AppSettings> & {
    alwaysOnTop?: boolean;
    opacity?: number;
    theme?: NoteTheme;
    customColor?: string;
  };

  return {
    ...defaultSettings,
    ...settings,
    shortcuts: {
      ...defaultShortcuts,
      ...settings.shortcuts,
    },
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
