import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';

// Runs the real CenterForm state machine (Svelte runes compiled as in the app) against
// a model of one native window, the dock proxy and a 1512×957 work area. Only the
// Tauri boundary and the native animation are substituted.
const out = resolve('node_modules/.pinnote-test');
mkdirSync(out, { recursive: true });
const esm = (file) => ts.transpileModule(readFileSync(`src/lib/${file}`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
}).outputText.replace(/from '\.\/(\w+)'/g, "from './$1.mjs'");
for (const name of ['windowGeometry', 'edgeQueue', 'centerLayout']) writeFileSync(`${out}/${name}.mjs`, esm(`${name}.ts`));
writeFileSync(`${out}/notesStore.mjs`, 'export {};');
writeFileSync(`${out}/settings.mjs`, 'export const isMacPlatform = () => true;');
writeFileSync(`${out}/nativeMotion.mjs`, `
export const canAnimateWindow = () => true;
export async function animateWindow(o) { globalThis.native.animations.push(o); if (o.bounds) globalThis.native.frame = { ...o.bounds }; }`);
writeFileSync(`${out}/tauri.mjs`, `
const n = () => globalThis.native;
export const invoke = async (cmd) => cmd === 'pointer_state' ? n().pointer() : undefined;
export const emitTo = async () => {};
export class LogicalPosition { constructor(x, y) { Object.assign(this, { x, y }); } }
export class PhysicalPosition extends LogicalPosition {}
export class LogicalSize { constructor(width, height) { Object.assign(this, { width, height }); } }
const size = (w, h) => ({ width: w, height: h, toLogical: () => ({ width: w, height: h }) });
export const getCurrentWindow = () => ({
  outerPosition: async () => ({ x: n().frame.x, y: n().frame.y }),
  outerSize: async () => size(n().frame.width, n().frame.height),
  innerSize: async () => size(n().frame.width, n().frame.height),
  scaleFactor: async () => 1,
  show: async () => { n().visible = true; }, hide: async () => { n().visible = false; },
  setFocus: async () => {}, setAlwaysOnTop: async () => {}, setMinSize: async () => {},
  setPosition: async (p) => { n().frame.x = p.x; n().frame.y = p.y; },
  setSize: async () => {},
});
export const availableMonitors = async () => { if (n().displayDelay) await n().displayDelay(); return n().monitors.map(m => ({ ...m, position: m.workArea.position, size: m.workArea.size })); };
const dock = { setAlwaysOnTop: async () => {}, setSize: async () => {}, show: async () => { n().dockVisible = true; },
  hide: async () => { n().dockVisible = false; }, setPosition: async (p) => { n().dock = { x: p.x, y: p.y }; } };
export class WebviewWindow { static async getByLabel() { return dock; } }`);
let form = compileModule(esm('centerForm.svelte.ts'), { generate: 'client', filename: 'centerForm.svelte.js' }).js.code
  .replace(/from '@tauri-apps\/api\/[\w]+'/g, "from './tauri.mjs'");
writeFileSync(`${out}/centerForm.mjs`, form);
const { CenterForm } = await import(pathToFileURL(`${out}/centerForm.mjs`).href);

const work = { position: { x: 0, y: 25 }, size: { width: 1512, height: 957 } };
const second = { position: { x: 1512, y: 0 }, size: { width: 1920, height: 1080 } };
function setup({ monitors = [work], persist = async () => {} } = {}) {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const native = globalThis.native = {
    frame: { x: 300, y: 200, width: 900, height: 600 }, visible: true, dockVisible: false, dock: null,
    animations: [], monitors: monitors.map((workArea, i) => ({ name: `D${i}`, scaleFactor: 1, workArea })),
    press: [], pointer: async () => native.press.shift() ?? { pressed: false },
  };
  const statuses = [];
  const form = new CenterForm({ persist, notes: () => [], title: () => '', status: s => statuses.push(s), edgeSnap: () => true });
  form.normal = { x: 300, y: 200, width: 900, height: 600, scaleFactor: 1 };
  return { form, native, statuses };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('drag-to-edge collapse fades out from where it was released, not back toward the old frame', async () => {
  const { form, native } = setup();
  // The user drags the window from (300,200) to the right edge and releases there.
  native.frame = { x: 1512 - 900 + 40, y: 420, width: 900, height: 600 };
  native.press = [{ pressed: true, x: 1508, y: 440 }, { pressed: true, x: 1510, y: 440 }, { pressed: false, x: 1510, y: 440 }];
  form.windowChanged('moved');
  await new Promise(r => setTimeout(r, 250));
  assert.equal(form.mode, 'handle');
  const exit = native.animations.find(a => a.alpha === 0 && a.duration > 0);
  assert.ok(exit, 'an exit animation ran');
  assert.ok(exit.bounds.x >= 1512 - 900 + 40, `exit starts at the release point and moves outward (x=${exit.bounds.x})`);
  assert.equal(exit.bounds.y, 420, 'no vertical travel toward the old frame');
  assert.deepEqual({ ...form.normal }, { x: 300, y: 200, width: 900, height: 600, scaleFactor: 1 }, 'the frame to come back to is the one before the drag');
  assert.equal(native.frame.x, 300, 'the hidden window is parked back at the normal frame');
  await form.expand();
  assert.equal(form.mode, 'window');
  assert.equal(native.frame.x, 300); assert.equal(native.frame.y, 200);
});

test('the collapse button keeps the window in place for its exit and restores it exactly', async () => {
  const { form, native } = setup();
  await form.collapse('left');
  const exit = native.animations.find(a => a.alpha === 0 && a.duration > 0);
  assert.equal(exit.bounds.y, 200); assert.ok(exit.bounds.x < 300 && exit.bounds.x > 250, 'a short nudge, not a flight');
  await form.expand();
  assert.deepEqual([native.frame.x, native.frame.y], [300, 200]);
});

test('resizing a border at the screen edge never snaps', async () => {
  const { form, native } = setup();
  native.frame = { x: 600, y: 200, width: 900, height: 600 };
  const grow = () => { native.frame.width += 6; return { pressed: true, x: 1509, y: 400 }; };
  native.pointer = async () => native.press.length ? native.press.shift()() : { pressed: false };
  native.press = [grow, grow, grow, () => ({ pressed: false, x: 1510, y: 400 })];
  form.windowChanged('moved'); // a left/top resize also moves the origin
  await new Promise(r => setTimeout(r, 300));
  assert.equal(form.mode, 'window');
  form.windowChanged('resized');
  await tick();
  assert.equal(form.mode, 'window');
});

test('one pull-out gesture can end on the other edge and docks there', async () => {
  const { form, native } = setup();
  await form.collapse('right');
  assert.equal(form.mode, 'handle');
  await form.dockAction({ action: 'detach', pointer: { x: 1400, y: 500 } });
  await form.dockAction({ action: 'drag', pointer: { x: 800, y: 500 } });
  assert.equal(form.snapHint, null, 'no hint in the open');
  await form.dockAction({ action: 'drag', pointer: { x: 2, y: 300 } });
  assert.equal(form.snapHint, 'left');
  await form.dockAction({ action: 'drop', pointer: { x: 2, y: 300 } });
  await tick();
  assert.equal(form.mode, 'handle');
  assert.equal(form.dock.side, 'left');
  assert.deepEqual([form.normal.x, form.normal.y], [300, 200], 'expanding later still returns to the original frame');
});

test('a pull-out dropped in the open stays a free window there; a cancelled one returns to its handle', async () => {
  const { form, native } = setup();
  await form.collapse('right');
  await form.dockAction({ action: 'detach', pointer: { x: 1400, y: 500 } });
  await form.dockAction({ action: 'drop', pointer: { x: 900, y: 400 } });
  assert.equal(form.mode, 'window');
  assert.equal(native.dockVisible, false);
  assert.notEqual(form.normal.x, 300, 'the drop point becomes the normal frame');

  await form.collapse('right');
  const dock = { ...form.dock };
  await form.dockAction({ action: 'detach', pointer: { x: 1400, y: 300 } });
  await form.dockAction({ action: 'drag', pointer: { x: 1000, y: 700 } });
  await form.dockAction({ action: 'cancel' });
  await tick();
  assert.equal(form.mode, 'handle');
  assert.deepEqual({ ...form.dock }, dock, 'back on the same edge, same place');
});

test('a dock and a remembered frame on an unplugged display come back on the remaining one', async () => {
  const { form, native } = setup({ monitors: [work, second] });
  form.normal = { x: 2000, y: 300, width: 900, height: 600, scaleFactor: 1 };
  native.frame = { ...form.normal };
  await form.collapse('right');
  native.monitors.pop(); // the external display is unplugged while collapsed
  await form.relayoutHandle();
  assert.ok(form.normal.x + form.normal.width <= 1512, 'the hidden frame was moved onto the built-in display');
  await form.expand();
  assert.ok(native.frame.x >= 0 && native.frame.x + native.frame.width <= 1512);
  // A lost remembered frame falls back to the hidden one, still fitted.
  await form.collapse('left');
  form.normal = undefined; native.frame = { x: 5000, y: 5000, width: 900, height: 600 };
  await form.expand();
  assert.ok(native.frame.x + native.frame.width <= 1512 && native.frame.y + native.frame.height <= 982, 'fallback branch is fitted too');
});

test('rapid collapse/expand requests settle on the last intent', async () => {
  const { form } = setup();
  const a = form.collapse('right'); const b = form.expand(); const c = form.collapse('left'); const d = form.expand();
  await Promise.all([a, b, c, d]);
  assert.equal(form.mode, 'window');
});

test('a delayed drag step from a released or cancelled pull-out never moves the window afterwards', async () => {
  for (const end of ['drop', 'cancel']) {
    const { form, native } = setup();
    await form.collapse('right');
    await form.dockAction({ action: 'detach', pointer: { x: 1400, y: 500 } });
    // The next drag step stalls while measuring displays (a slow IPC round trip).
    let resume; native.displayDelay = () => new Promise(r => { resume = r; });
    const stale = form.dockAction({ action: 'drag', pointer: { x: 4, y: 300 } });
    await tick();
    native.displayDelay = undefined;
    await form.dockAction(end === 'drop' ? { action: 'drop', pointer: { x: 900, y: 400 } } : { action: 'cancel' });
    await tick();
    const settled = { mode: form.mode, frame: { ...native.frame }, side: form.dock.side };
    resume(); await stale; await tick();
    assert.deepEqual({ mode: form.mode, frame: { ...native.frame }, side: form.dock.side }, settled, `${end}: the late step changed nothing`);
    assert.equal(form.snapHint, null, `${end}: no edge hint left behind`);
    if (end === 'drop') assert.equal(form.mode, 'window', 'dropped in the open, not snapped to the stale left edge');
  }
});

test('collapsing waits for the draft to save; a failed save keeps the center expanded', async () => {
  let fail = true;
  const { form, native, statuses } = setup({ persist: async () => { if (fail) throw new Error('磁盘已满'); } });
  await form.collapse('right');
  assert.equal(form.mode, 'window');
  assert.equal(native.visible, true);
  assert.match(statuses.at(-1), /未保存/);
  await form.collapseToBar();
  assert.equal(form.mode, 'window', 'the bar is refused too');
  fail = false; // retry succeeds
  await form.collapse('right');
  assert.equal(form.mode, 'handle');
});
