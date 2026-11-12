// List organisation (stars, tags, quick filters, search highlighting), the statistics
// shown in the center's overview, and the file layout of "export all". Pure functions.
import { sanitizeFilename } from './filename';

type Listed = { id: string; title: string; lifecycle: string; placement: string; starredAt?: number | null; tags?: string[]; reminder?: { state: string } | null };

/** Starred notes first (in their current order), then the rest. */
export function starredFirst<T extends Pick<Listed, 'starredAt'>>(items: T[]): T[] {
  return [...items.filter(n => n.starredAt), ...items.filter(n => !n.starredAt)];
}

export type QuickFilters = { starred: boolean; reminder: boolean; todo: boolean; tag: string };
export const noQuickFilters = (): QuickFilters => ({ starred: false, reminder: false, todo: false, tag: '' });
export const quickFilterCount = (f: QuickFilters) => Number(f.starred) + Number(f.reminder) + Number(f.todo) + Number(Boolean(f.tag));

/** `openTodos`: unfinished checklist items in the note. Every active filter must match. */
export function passesQuickFilters(note: Listed, f: QuickFilters, openTodos: number) {
  if (f.starred && !note.starredAt) return false;
  if (f.reminder && !(note.reminder && note.reminder.state !== 'paused')) return false;
  if (f.todo && openTodos === 0) return false;
  if (f.tag && !(note.tags ?? []).some(t => t.toLowerCase() === f.tag.toLowerCase())) return false;
  return true;
}

/** Tags in use, most used first, counted over notes that are not in the trash. */
export function tagCounts(notes: Listed[]) {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const note of notes) {
    if (note.lifecycle === 'trash') continue;
    for (const tag of note.tags ?? []) {
      const key = tag.toLowerCase();
      const entry = counts.get(key) ?? { tag, count: 0 };
      entry.count++; counts.set(key, entry);
    }
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));
}

/** Split `text` into plain and matching runs (case-insensitive, every occurrence). */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase(), parts: Array<{ text: string; hit: boolean }> = [];
  let from = 0;
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + q.length)) {
    if (at > from) parts.push({ text: text.slice(from, at), hit: false });
    parts.push({ text: text.slice(at, at + q.length), hit: true });
    from = at + q.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), hit: false });
  return parts;
}

/**
 * A one-line excerpt that shows the first match. List rows show only about 20 characters,
 * so a match further in starts the excerpt a few characters before it.
 */
export function matchSnippet(plain: string, query: string, max = 100) {
  const line = plain.replace(/\s*\n+\s*/g, ' ');
  const at = query.trim() ? line.toLowerCase().indexOf(query.trim().toLowerCase()) : -1;
  if (at < 12) return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
  const start = at - 6;
  const text = line.slice(start, start + max);
  return `…${text}${start + max < line.length ? '…' : ''}`;
}

// ---- Statistics --------------------------------------------------------------------------

export type Activity = { since?: number; b?: Record<string, number[]> };
export type Day = { edits: number; created: number; done: number };
const BUCKET = 30 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = (at: number) => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const addDays = (at: number, days: number) => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime(); };

type Dated = { createdAt: number; editedAt?: number; updatedAt: number; lifecycle: string };
/**
 * Activity per local day. The log only exists from `since` (when this version first ran);
 * earlier days are filled in from each note's creation and last edit time.
 */
export function dailyActivity(activity: Activity, notes: Dated[]) {
  const days = new Map<string, Day>();
  const add = (at: number, d: Partial<Day>) => {
    const key = dayKey(at), day = days.get(key) ?? { edits: 0, created: 0, done: 0 };
    day.edits += d.edits ?? 0; day.created += d.created ?? 0; day.done += d.done ?? 0;
    days.set(key, day);
  };
  for (const [bucket, [edits = 0, created = 0, done = 0]] of Object.entries(activity.b ?? {})) add(Number(bucket) * BUCKET, { edits, created, done });
  const since = activity.since ?? Infinity;
  for (const note of notes) {
    if (note.createdAt < since) add(note.createdAt, { created: 1 });
    const edited = note.editedAt ?? note.updatedAt;
    if (edited < since && dayKey(edited) !== dayKey(note.createdAt)) add(edited, { edits: 1 });
  }
  return days;
}

const active = (d?: Day) => Boolean(d && d.edits + d.created + d.done > 0);

/** Consecutive days with activity: ending today (or yesterday, if today is still empty), and the longest run. */
export function streaks(days: Map<string, Day>, now: number) {
  let current = 0;
  let at = active(days.get(dayKey(now))) ? startOfDay(now) : addDays(now, -1);
  while (active(days.get(dayKey(at)))) { current++; at = addDays(at, -1); }
  const keys = Array.from(days.keys()).filter(k => active(days.get(k))).sort();
  let longest = 0, run = 0, previous = '';
  for (const key of keys) {
    const [y, m, d] = key.split('-').map(Number);
    run = previous && dayKey(addDays(new Date(y, m - 1, d).getTime(), -1)) === previous ? run + 1 : 1;
    longest = Math.max(longest, run); previous = key;
  }
  return { current, longest: Math.max(longest, current) };
}

export type HeatCell = { key: string; at: number; day: Day; level: 0 | 1 | 2 | 3 | 4; future: boolean };
/** `weeks` columns of Monday–Sunday cells ending with the current week; level 0–4 by share of the busiest day. */
export function heatmap(days: Map<string, Day>, now: number, weeks = 20): HeatCell[][] {
  const today = startOfDay(now);
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7));
  const first = addDays(monday, -7 * (weeks - 1));
  const score = (d?: Day) => (d ? d.edits + d.created + d.done : 0);
  let max = 0;
  for (let i = 0; i < weeks * 7; i++) max = Math.max(max, score(days.get(dayKey(addDays(first, i)))));
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const at = addDays(first, w * 7 + d), key = dayKey(at), day = days.get(key) ?? { edits: 0, created: 0, done: 0 };
    const s = score(day), share = max ? s / max : 0;
    const level = (s === 0 ? 0 : share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4) as HeatCell['level'];
    return { key, at, day, level, future: at > today };
  }));
}

/** Sum of a day field over the `count` days ending today. */
export function recent(days: Map<string, Day>, now: number, count: number, field: keyof Day) {
  let total = 0;
  for (let i = 0; i < count; i++) total += days.get(dayKey(addDays(now, -i)))?.[field] ?? 0;
  return total;
}

/** Whole days left before a trashed note is emptied (at least 1), or null when the trash is kept. */
export function trashDaysLeft(trashedAt: number | undefined, days: number, now: number) {
  if (!days) return null;
  const left = Math.ceil(((trashedAt ?? now) + days * 86400000 - now) / 86400000);
  return Math.max(1, left);
}

// ---- Export all ----------------------------------------------------------------------------

export const exportFolderName = (now = Date.now()) => {
  const d = new Date(now);
  return `PinNote 导出 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
};

/** One Markdown file per note: active notes at the top level, archived ones in 归档/. The trash is left out. */
export function exportFiles(notes: Array<Pick<Listed, 'title' | 'lifecycle'> & { content: string }>) {
  const used = new Set<string>();
  const files: Array<{ path: string; content: string }> = [];
  for (const note of notes) {
    if (note.lifecycle === 'trash') continue;
    const dir = note.lifecycle === 'archived' ? '归档/' : '';
    const base = sanitizeFilename(note.title || '未命名便签');
    let name = `${dir}${base}.md`;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${dir}${base} (${i}).md`;
    used.add(name.toLowerCase());
    files.push({ path: name, content: note.content });
  }
  return files;
}
