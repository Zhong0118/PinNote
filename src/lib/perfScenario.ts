// Debug-only scripted scenario for before/after comparisons. It drives the same
// events and functions a user triggers; it is loaded only when PINNOTE_PERF_SCENARIO is set.
import { emit, emitTo } from '@tauri-apps/api/event';
import { loadNotes } from './notesStore';
import { perfMark } from './perf';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export type ScenarioHooks = {
  select: (id: string) => Promise<void>;
};

async function typeInto(count: number) {
  const host = document.querySelector<HTMLElement>('.work .ProseMirror');
  if (!host) return;
  host.focus();
  const sel = window.getSelection(); sel?.selectAllChildren(host); sel?.collapseToEnd();
  for (let i = 0; i < count; i++) { document.execCommand('insertText', false, i % 12 === 11 ? ' ' : 'x'); await wait(60); }
}

export async function runScenario(hooks: ScenarioHooks) {
  await wait(8000);
  await perfMark('idle-start');
  const notes = Object.values((await loadNotes()).notes);
  const capsules = notes.filter(n => n.lifecycle === 'active' && n.placement === 'desktop' && n.window.collapsed);
  const center = notes.filter(n => n.lifecycle === 'active' && n.placement === 'center');
  await wait(10000);
  await perfMark('hover-start');
  for (const note of capsules) {
    await emitTo(`note-${note.id}`, 'perf-hover', { inside: true }); await wait(900);
    await emitTo(`note-${note.id}`, 'perf-hover', { inside: false }); await wait(500);
  }
  await wait(3000);
  await perfMark('edit-start');
  const short = capsules[0], long = capsules.find(n => n.content.length > 5000) ?? capsules[1];
  for (const target of [short, long]) {
    if (!target) continue;
    await hooks.select(target.id); await wait(800);
    await typeInto(60); await wait(1200);
  }
  await perfMark('switch-start');
  const ids = [short?.id, long?.id, center[0]?.id].filter(Boolean) as string[];
  for (let i = 0; i < 18; i++) { await hooks.select(ids[i % ids.length]); await wait(250); await hooks.select(ids[i % ids.length]); await wait(250); }
  await perfMark('collapse-start');
  for (const note of capsules.slice(0, 3)) {
    for (let i = 0; i < 2; i++) {
      await emit('expand-note-requested', { id: note.id }); await wait(1400);
      await emitTo(`note-${note.id}`, 'collapse-note-requested', { id: note.id }); await wait(1400);
    }
  }
  await perfMark('final-idle-start');
  await wait(20000);
  await perfMark('done');
}

type FormLike = {
  collapse: (side?: 'left' | 'right') => Promise<void>;
  expand: () => Promise<void>;
  collapseToBar: () => Promise<void>;
  dockAction: (a: { action: 'moved' | 'detach' | 'drag' | 'drop'; pointer?: { x: number; y: number } }) => Promise<void>;
  handleFrame: () => Promise<{ x: number; y: number; width: number; height: number }>;
  readOuter: () => Promise<{ bounds: { x: number; y: number; width: number; height: number } }>;
  mode: string;
};

/** Debug-only native check of the center window state machine (PINNOTE_UI_CHECK). */
export async function runWindowCheck(form: FormLike) {
  const log = async (name: string) => {
    const outer = (await form.readOuter()).bounds;
    await perfMark(`${name} mode=${form.mode} outer=${Math.round(outer.x)},${Math.round(outer.y)},${Math.round(outer.width)}x${Math.round(outer.height)}`);
  };
  await wait(4000); await log('start');
  await form.collapse('right'); await wait(1200); await log('collapsed-right');
  const h = await form.handleFrame(); await perfMark(`handle ${h.x},${h.y},${h.width}x${h.height}`);
  await form.expand(); await wait(1200); await log('expanded');
  await form.collapse('left'); await wait(1200); await log('collapsed-left');
  await form.dockAction({ action: 'moved', pointer: { x: 10, y: 260 } }); await wait(800);
  const moved = await form.handleFrame(); await perfMark(`handle-moved ${moved.x},${moved.y}`);
  await form.dockAction({ action: 'detach', pointer: { x: 120, y: 300 } }); await wait(400);
  for (let i = 1; i <= 10; i++) { await form.dockAction({ action: 'drag', pointer: { x: 120 + i * 30, y: 300 + i * 10 } }); await wait(30); }
  await form.dockAction({ action: 'drop', pointer: { x: 420, y: 400 } }); await wait(800); await log('dragged-out');
  await form.collapse('right'); await wait(900); await form.expand(); await wait(900); await log('expanded-after-dragout');
  // Rapid repeated actions must settle in a consistent state.
  void form.collapse('right'); void form.expand(); void form.collapse('left'); await wait(1500); await log('rapid');
  if (form.mode !== 'window') { await form.expand(); await wait(900); }
  await form.collapseToBar(); await wait(900); await log('bar');
  await form.expand(); await wait(900); await log('done');
}

/** Debug-only visual tour (PINNOTE_UI_TOUR): steps through states so each can be captured. */
export async function runTour(hooks: { openSettings: () => Promise<void>; closeSettings: () => void; form: FormLike; select: (id: string) => Promise<void>; reminder?: (open: boolean) => void }) {
  const { emit } = await import('@tauri-apps/api/event');
  const { appearance } = await import('./theme');
  const base = appearance();
  const step = async (name: string, ms = 3500) => { await perfMark(`tour:${name}`); await wait(ms); };
  await wait(5000);
  const notes = Object.values((await loadNotes()).notes).filter(n => n.lifecycle === 'active');
  const capsule = notes.find(n => n.placement === 'desktop' && n.window.collapsed);
  if (capsule) { await hooks.select(capsule.id); await wait(800); }
  await step('center-light');
  if (capsule) { await emitTo(`note-${capsule.id}`, 'perf-hover', { inside: true }); await wait(1200); await step('preview-light'); await emitTo(`note-${capsule.id}`, 'perf-hover', { inside: false }); await wait(600); }
  await hooks.openSettings(); await step('settings-light');
  await emit('appearance-preview', { ...base, theme: 'dark' }); await step('settings-dark');
  hooks.closeSettings(); await step('center-dark');
  if (capsule) { await emitTo(`note-${capsule.id}`, 'perf-hover', { inside: true }); await wait(1200); await step('preview-dark'); await emitTo(`note-${capsule.id}`, 'perf-hover', { inside: false }); await wait(600); }
  if (hooks.reminder) { hooks.reminder(true); await step('reminder-dark'); hooks.reminder(false); await wait(400); }
  await hooks.form.collapse('right'); await step('handle-dark');
  await hooks.form.expand(); await wait(800);
  await emit('appearance-preview', base); await step('restored-light');
  await perfMark('done');
}
