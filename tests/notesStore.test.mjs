import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Execute the real store with only the native IPC boundary substituted.
function loadStore(invoke) {
  const cache = new Map();
  const timers = new Map();
  let timerId = 0;
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports, console, crypto: globalThis.crypto,
      setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; },
      clearTimeout: (id) => timers.delete(id),
      require: (name) => {
        if (name === '@tauri-apps/api/core') return { invoke: (cmd,args) => cmd === 'note_draft' ? Promise.resolve() : invoke(cmd,args) };
        if (name === '$app/environment') return { browser: false };
        if (name.startsWith('.')) return load(resolve(dirname(path), `${name}.ts`));
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return exports;
  }
  return load(resolve('src/lib/notesStore.ts'));
}

test('failed older save cannot replace a newer pending draft', async () => {
  let rejectWrite;
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const stored = [];
  let fail = true;
  const store = loadStore(async (command, args) => {
    assert.equal(command, 'note_operation');
    if (fail) {
      fail = false;
      started();
      await new Promise((_, reject) => { rejectWrite = reject; });
    }
    stored.push(args.request.note);
  });
  const note = store.createNote({ id: 'a', content: 'old' });
  const first = store.saveNoteNow(note);
  await writing;
  store.scheduleNoteSave({ ...note, content: 'newest' });
  rejectWrite(new Error('disk full'));
  await assert.rejects(first, /disk full/);
  await store.flushNoteSave('a');
  assert.equal(stored.at(-1).content, 'newest');
});

test('a failed save followed by a queued successful save does not retry stale data', async () => {
  let rejectWrite;
  let started;
  const writing = new Promise(resolve => { started = resolve; });
  const stored = [];
  let fail = true;
  const store = loadStore(async (_command, args) => {
    if (fail) {
      fail = false;
      started();
      await new Promise((_, reject) => { rejectWrite = reject; });
    }
    stored.push(args.request.note);
  });
  const first = store.saveNoteNow(store.createNote({ id: 'a', content: 'old' }));
  await writing;
  const second = store.saveNoteNow(store.createNote({ id: 'a', content: 'newest' }));
  rejectWrite(new Error('disk full'));
  await assert.rejects(first, /disk full/);
  await second;
  await store.flushNoteSave('a');
  assert.equal(stored.at(-1).content, 'newest');
});

test('queued save takes a snapshot of the draft', async () => {
  let saved;
  const store = loadStore(async (_command, args) => { saved = args.request.note; });
  const note = store.createNote({ id: 'a', content: 'original' });
  store.scheduleNoteSave(note);
  const saving = store.flushNoteSave('a');
  note.content = 'mutated outside the save queue';
  await saving;
  assert.equal(saved.content, 'original');
});
test('changing color cannot promote a stale draft to a newer content revision',async()=>{
  let expected;
  const store=loadStore(async(command,args)=>{
    if(args.request.op==='appearance')return {id:'a',revision:9,theme:'sky',customColor:'#2563eb',opacity:1,alwaysOnTop:true};
    expected=args.request.expectedRevision;
    throw new Error('VERSION_CONFLICT');
  });
  const draft=store.createNote({id:'a',revision:2,content:'local draft'});
  await store.noteOperation(draft,'appearance',{patch:{theme:'sky'}});
  assert.equal(draft.revision,2);assert.equal(draft.content,'local draft');
  await assert.rejects(store.saveNoteNow(draft),/VERSION_CONFLICT/);
  assert.equal(expected,2);
});

for (const raw of ['{broken', 'null', '{"notes":[]}']) {
  test(`invalid notes file is preserved instead of replaced: ${raw}`, async () => {
    const writes = [];
    const store = loadStore(async (command, args) => {
      if (command === 'load_notes') return raw;
      if (command === 'load_note') return null;
      writes.push(args);
    });
    await assert.rejects(store.loadNotes());
    assert.equal(writes.length, 0);
  });
}

test('read error is surfaced instead of migrating over existing notes', async () => {
  const store = loadStore(async command => {
    if (command === 'load_notes') throw new Error('permission denied');
    if (command === 'load_note') return null;
  });
  await assert.rejects(store.loadNotes(), /permission denied/);
});

test('deletion cannot replace concurrent edits to another note with a stale file', async () => {
  let file = { version: 1, notes: { b: { id: 'b', content: 'before' } }, lastActiveNoteId: 'b', lastClosedNoteId: 'b' };
  const store = loadStore(async (command, args) => {
    if (command === 'delete_note') return;
    if (command === 'load_notes') {
      const snapshot = JSON.stringify(file);
      file.notes.b.content = 'concurrent edit';
      return snapshot;
    }
    if (command === 'save_notes') file = JSON.parse(args.json);
  });
  await store.deleteNoteNow('a');
  assert.equal(file.notes.b.content, 'concurrent edit');
});

test('save scopes keep body and geometry writes apart', async () => {
  const requests = [];
  const store = loadStore(async (command, args) => { requests.push(args.request); return { ...args.request.note, revision: 3 }; });
  const note = store.createNote({ id: 'b', revision: 2, content: 'body' });
  await store.saveNoteNow(note, 'window');
  assert.equal(requests.at(-1).op, 'window');
  assert.deepEqual(Object.keys(requests.at(-1).patch), ['window']);
  await store.saveNoteNow({ ...note, content: 'center' }, 'body');
  assert.equal(requests.at(-1).op, 'save');
  assert.deepEqual(Object.keys(requests.at(-1).patch), ['title', 'content']);
  store.scheduleNoteSave({ ...note, content: 'mixed' }, undefined, 'body');
  store.scheduleNoteSave({ ...note, content: 'mixed' }, undefined, 'window');
  await store.flushNoteSave('b');
  assert.deepEqual(Object.keys(requests.at(-1).patch), ['title', 'content', 'window']);
});
