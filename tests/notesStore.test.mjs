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
        if (name === '@tauri-apps/api/core') return { invoke };
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
    assert.equal(command, 'upsert_note');
    if (fail) {
      fail = false;
      started();
      await new Promise((_, reject) => { rejectWrite = reject; });
    }
    stored.push(JSON.parse(args.json));
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
    stored.push(JSON.parse(args.json));
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
  const store = loadStore(async (_command, args) => { saved = JSON.parse(args.json); });
  const note = store.createNote({ id: 'a', content: 'original' });
  store.scheduleNoteSave(note);
  const saving = store.flushNoteSave('a');
  note.content = 'mutated outside the save queue';
  await saving;
  assert.equal(saved.content, 'original');
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
