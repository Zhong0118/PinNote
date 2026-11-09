import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// The real store against a small model of the native side: revisions, the
// per-note draft flag, and agent writes refused while a draft is flagged
// (EDITOR_BUSY), exactly as src-tauri/src/notes.rs does.
function setup() {
  const notes = { a: note('a', 'base', 1), b: note('b', 'other', 1) };
  const drafts = new Set();
  const draftCalls = [];
  let gate = null;
  const backend = {
    notes, drafts, draftCalls,
    /** Hold the next note_operation until the returned function is called with (error?). */
    holdNextWrite() {
      let release; const held = new Promise(r => { release = r; });
      let started; const begun = new Promise(r => { started = r; });
      gate = async () => { gate = null; started(); const error = await held; if (error) throw error; };
      return { begun, release };
    },
    failNextWrite(message) { gate = async () => { gate = null; throw new Error(message); }; },
    agentWrite(id, content) {
      if (drafts.has(id)) throw new Error('EDITOR_BUSY: 用户有未保存草稿');
      const n = notes[id]; n.content = content; n.revision++;
      return { id, op: 'save', source: 'agent', note: structuredClone(n) };
    },
  };
  async function invoke(cmd, args) {
    if (cmd === 'note_draft') { draftCalls.push(`${args.id}:${args.dirty}`); args.dirty ? drafts.add(args.id) : drafts.delete(args.id); return; }
    if (cmd === 'perf_enabled') return { enabled: false };
    if (cmd === 'load_notes') return JSON.stringify({ version: 2, notes, history: [], lastActiveNoteId: 'a', lastClosedNoteId: 'a' });
    if (cmd === 'note_operation') {
      const r = args.request;
      if (gate) await gate(r);
      if (r.op === 'create') { notes[r.id] = { ...r.note, revision: 1 }; return structuredClone(notes[r.id]); }
      const n = notes[r.id];
      if (r.op !== 'window' && r.expectedRevision !== n.revision) throw new Error(`VERSION_CONFLICT: 便签已更改（版本 ${n.revision}）`);
      Object.assign(n, r.patch ?? {});
      if (r.op === 'reminder') n.reminder = { at: r.at, state: 'pending' };
      if (r.op !== 'window') n.revision++;
      return structuredClone(n);
    }
    throw new Error(`Unexpected command ${cmd}`);
  }
  const timers = new Map(); let timerId = 0;
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports, console, crypto: globalThis.crypto, structuredClone,
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: (id) => timers.delete(id),
      require: (name) => {
        if (name === '@tauri-apps/api/core') return { invoke };
        if (name === '@tauri-apps/api/window') return { getCurrentWindow: () => ({ label: 'main' }) };
        if (name === '$app/environment') return { browser: false };
        if (name.startsWith('.')) return load(resolve(dirname(path), `${name}.ts`));
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return exports;
  }
  const store = load(resolve('src/lib/notesStore.ts'));
  return { store, backend };
}
function note(id, content, revision) {
  return { id, title: id, content, revision, lifecycle: 'active', placement: 'center', theme: 'paper', customColor: '#2563eb', opacity: 1, alwaysOnTop: false, window: { width: 420, height: 560 }, createdAt: 1, updatedAt: 1, lastFocusedAt: 1 };
}
const local = (n, content = n.content) => ({ label: 'main', revision: n.revision, title: n.title, content });

test('typing protects the draft at once, before the 250 ms serialization, so an agent write is refused', async () => {
  const { store, backend } = setup();
  await store.loadNotes();
  // Keystrokes only bump the edit state; no Markdown is serialized yet.
  store.markEdited('a'); store.markEdited('a'); store.markEdited('a');
  assert.deepEqual(backend.draftCalls, ['a:true'], 'one flag for a burst of keystrokes');
  assert.throws(() => backend.agentWrite('a', 'agent text'), /EDITOR_BUSY/);
  assert.equal(backend.notes.a.content, 'base');
  assert.equal(store.hasLocalEdits('a'), true);
});

test('an agent write that lands before the flag becomes a conflict, never a silent replacement', async () => {
  const { store, backend } = setup();
  const file = await store.loadNotes();
  const open = file.notes.a;
  const change = backend.agentWrite('a', 'agent text'); // raced ahead of the first keystroke
  store.markEdited('a');                                 // the user is mid-typing, nothing serialized
  assert.equal(store.classifyChange(change, local(open)), 'conflict');
  assert.equal(store.noteConflict('a').content, 'agent text');
  // The debounced serialization then queues the draft: it must not be written blind.
  store.scheduleNoteSave({ ...open, content: 'base + typing' }, undefined, 'body');
  await assert.rejects(store.flushNoteSave('a'), /VERSION_CONFLICT/);
  assert.equal(backend.notes.a.content, 'agent text');
  assert.ok(backend.drafts.has('a'), 'the draft stays flagged while the user decides');
  // Keeping mine overwrites the version the user has now seen.
  await store.keepLocalVersion('a');
  assert.equal(backend.notes.a.content, 'base + typing');
  assert.equal(store.hasLocalEdits('a'), false);
  assert.ok(!backend.drafts.has('a'));
});

test('taking the other version keeps the local draft as a new note', async () => {
  const { store, backend } = setup();
  const open = (await store.loadNotes()).notes.a;
  const change = backend.agentWrite('a', 'agent text');
  store.markEdited('a');
  assert.equal(store.classifyChange(change, local(open)), 'conflict');
  const { remote, copy } = await store.takeRemoteVersion('a', { title: 'a', content: 'my draft' });
  assert.equal(remote.content, 'agent text');
  assert.equal(backend.notes[copy.id].content, 'my draft');
  assert.equal(backend.notes.a.content, 'agent text');
  assert.equal(store.hasLocalEdits('a'), false);
  assert.ok(!backend.drafts.has('a'));
});

test('typing while a save is in flight keeps the note dirty until that newer text is saved', async () => {
  const { store, backend } = setup();
  const open = (await store.loadNotes()).notes.a;
  store.markEdited('a');
  store.scheduleNoteSave({ ...open, content: 'v1' }, undefined, 'body');
  const write = backend.holdNextWrite();
  const first = store.flushNoteSave('a');
  await write.begun;
  store.markEdited('a'); // more typing, not yet serialized
  write.release();
  await first;
  assert.equal(backend.notes.a.content, 'v1');
  assert.equal(store.hasLocalEdits('a'), true, 'the old save must not clear newer input');
  assert.ok(backend.drafts.has('a'));
  assert.throws(() => backend.agentWrite('a', 'agent'), /EDITOR_BUSY/);
  store.scheduleNoteSave({ ...open, content: 'v2' }, undefined, 'body');
  await store.flushNoteSave('a');
  assert.equal(backend.notes.a.content, 'v2');
  assert.equal(store.hasLocalEdits('a'), false);
  assert.ok(!backend.drafts.has('a'));
});

test('a failed save keeps the draft protected; switching to another note is not blocked by it, and retry saves it', async () => {
  const { store, backend } = setup();
  const open = (await store.loadNotes()).notes.a;
  store.scheduleNoteSave({ ...open, content: 'unsaved' }, undefined, 'body');
  backend.failNextWrite('disk full');
  await assert.rejects(store.flushNoteSave('a'), /disk full/);
  assert.equal(store.hasLocalEdits('a'), true);
  assert.ok(backend.drafts.has('a'), 'still flagged after the failure');
  // Leaving to note b: its own (empty) flush does not inherit a's failure.
  await store.flushNoteSave('b');
  // Closing or switching away from a retries a's pending text, which is still there.
  await store.flushNoteSave('a');
  assert.equal(backend.notes.a.content, 'unsaved');
  assert.equal(store.hasLocalEdits('a'), false);
});

test('one conflicted note does not hold back saving the others', async () => {
  const { store, backend } = setup();
  const file = await store.loadNotes();
  // Note a has unsaved typing and a remote change arrives for it.
  store.markEdited('a');
  const remote = { id: 'a', op: 'save', source: 'agent', note: { ...file.notes.a, revision: 5, content: 'remote' } };
  assert.equal(store.classifyChange(remote, local(file.notes.a)), 'conflict');
  store.scheduleNoteSave({ ...file.notes.a, content: 'mine' }, undefined, 'body');
  store.scheduleNoteSave({ ...file.notes.b, content: 'b draft' }, undefined, 'body');
  await assert.rejects(store.flushNoteSave(), /VERSION_CONFLICT/);
  assert.equal(backend.notes.b.content, 'b draft');
});

test('own save echoes and other notes are not conflicts; a reminder elsewhere moves the base revision', async () => {
  const { store, backend } = setup();
  const open = (await store.loadNotes()).notes.a;
  store.markEdited('a');
  const echo = { id: 'a', op: 'save', by: 'main', note: { ...open, revision: 2, content: 'older text of mine' } };
  assert.equal(store.classifyChange(echo, local(open, 'newer text')), 'ignore');
  const other = { id: 'b', op: 'save', source: 'agent', note: { ...backend.notes.b, revision: 2, content: 'x' } };
  assert.equal(store.classifyChange(other, local(backend.notes.b)), 'apply', 'b has no local edits');
  assert.equal(store.noteConflict('a'), undefined);
  // A reminder set from another window bumps the revision but keeps the text.
  backend.notes.a.revision = 2;
  const reminder = { id: 'a', op: 'reminder', by: 'note-a', note: { ...open, revision: 2 } };
  assert.equal(store.classifyChange(reminder, local(open)), 'apply');
  store.scheduleNoteSave({ ...open, content: 'typed' }, undefined, 'body');
  await store.flushNoteSave('a');
  assert.equal(backend.notes.a.content, 'typed', 'saved on the new base, no false conflict');
});

test('serialization that finds nothing new releases the draft flag', async () => {
  const { store, backend } = setup();
  await store.loadNotes();
  store.markEdited('a'); // e.g. typed a letter and deleted it again
  assert.ok(backend.drafts.has('a'));
  store.markSettled('a');
  assert.equal(store.hasLocalEdits('a'), false);
  assert.ok(!backend.drafts.has('a'));
});

test('a late archive or trash with the same text still protects typing that was not serialized yet', async () => {
  for (const lifecycle of ['archived', 'trashed']) {
    const { store, backend } = setup();
    const open = (await store.loadNotes()).notes.a;
    store.markEdited('a'); // typed, still inside the 250 ms serialization window
    // Another window archives/trashes the note: same title and text, new lifecycle.
    const n = backend.notes.a; n.lifecycle = lifecycle; n.revision++;
    const change = { id: 'a', op: lifecycle === 'archived' ? 'archive' : 'trash', by: 'note-a', note: structuredClone(n) };
    const mine = { ...local(open), lifecycle: 'active', placement: 'center' };
    assert.equal(store.classifyChange(change, mine), 'conflict', `${lifecycle} must not drop the input`);
    const { copy } = await store.takeRemoteVersion('a', { title: 'a', content: 'base typed more' });
    assert.equal(backend.notes[copy.id].content, 'base typed more', 'the input survives as a new note');
    assert.equal(backend.notes[copy.id].lifecycle, 'active');
    assert.equal(store.hasLocalEdits('a'), false);
  }
  // Without local input the same event simply applies.
  const { store, backend } = setup();
  const open = (await store.loadNotes()).notes.a;
  const n = backend.notes.a; n.lifecycle = 'archived'; n.revision++;
  assert.equal(store.classifyChange({ id: 'a', op: 'archive', by: 'note-a', note: structuredClone(n) }, { ...local(open), lifecycle: 'active', placement: 'center' }), 'apply');
});
