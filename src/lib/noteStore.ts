import { invoke } from "@tauri-apps/api/core";
import { defaultContent, defaultTitle } from "./defaultNote";

export type NoteData = {
  title: string;
  content: string;
};

const SAVE_DELAY = 600; // ms debounce
let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadNote(): Promise<NoteData> {
  try {
    const raw = await invoke<string | null>("load_note");
    if (raw) {
      const data = JSON.parse(raw) as Partial<NoteData>;
      return {
        title: data.title ?? defaultTitle,
        content: data.content ?? defaultContent,
      };
    }
  } catch {
    // First launch or read failure — use defaults
  }
  return { title: defaultTitle, content: defaultContent };
}

export function saveNote(data: NoteData) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await invoke("save_note", { json: JSON.stringify(data) });
    } catch {
      // Silent fail — next save will retry
    }
  }, SAVE_DELAY);
}
