import { browser } from "$app/environment";

export type NoteTheme = "paper" | "mint" | "rose" | "sky" | "grape" | "ink" | "custom";

export type ShortcutConfig = {
  toggleWindow: string;
  newNote: string;
};

export type AppSettings = {
  alwaysOnTop: boolean;
  autoStart: boolean;
  opacity: number;
  theme: NoteTheme;
  customColor: string;
  shortcuts: ShortcutConfig;
};

const settingsKey = "pinnote.settings.v1";

export const defaultShortcuts: ShortcutConfig = {
  toggleWindow: "Alt+N",
  newNote: "Alt+Shift+N",
};

export const defaultSettings: AppSettings = {
  alwaysOnTop: true,
  autoStart: false,
  opacity: 0.96,
  theme: "paper",
  customColor: "#2d7d74",
  shortcuts: { ...defaultShortcuts },
};

export function loadSettings() {
  if (!browser) return { ...defaultSettings };

  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return { ...defaultSettings };

    return {
      ...defaultSettings,
      ...(JSON.parse(raw) as Partial<AppSettings>),
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: AppSettings) {
  if (!browser) return;
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}
