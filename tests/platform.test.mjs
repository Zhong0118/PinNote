import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Run the real settings and shortcut modules with browser/native boundaries stubbed.
function loadPlatform(platform, savedSettings = null, native = {}) {
  const cache = new Map();
  let listener;
  let registeredShortcuts;
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports, console, navigator: { platform },
      localStorage: { getItem: () => null },
      require: (name) => {
        if (name === '$app/environment') return { browser: true };
        if (name === '@tauri-apps/api/core') return {
          invoke: async () => savedSettings === null ? null : JSON.stringify(savedSettings),
        };
        if (name === '@tauri-apps/api/window') return {};
        if (name === '@tauri-apps/plugin-global-shortcut') return {
          register: async (shortcuts, callback) => {
            registeredShortcuts = [...shortcuts];
            listener = callback;
          },
          unregisterAll: async () => {},
          ...native,
        };
        if (name.startsWith('.')) return load(resolve(dirname(path), `${name}.ts`));
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return exports;
  }
  return {
    settings: load(resolve('src/lib/settings.ts')),
    shortcuts: load(resolve('src/lib/shortcuts.ts')),
    registered: () => registeredShortcuts,
    emit: (shortcut, state = 'Pressed') => listener({ shortcut, state }),
  };
}

for (const [platform, alt, modifier, defaults] of [
  ['Win32', 'Alt', 'CTRL', ['Alt+N', 'Alt+Shift+N']],
  ['MacIntel', 'Option', 'CMD', ['CmdOrCtrl+Option+N', 'CmdOrCtrl+Option+Shift+N']],
]) {
  test(`${platform}: fresh settings use platform defaults and independent objects`, async () => {
    const { settings } = loadPlatform(platform);
    const fresh = await settings.loadSettings();
    assert.deepEqual(Object.values(fresh.shortcuts), defaults);
    fresh.shortcuts.toggleWindow = 'Ctrl+X';
    fresh.defaultNote.opacity = 0.5;
    const next = settings.createDefaultSettings();
    assert.equal(next.shortcuts.toggleWindow, defaults[0]);
    assert.equal(next.defaultNote.opacity, 0.96);
  });

  test(`${platform}: modifier aliases and hardware key names normalize consistently`, () => {
    const { settings } = loadPlatform(platform);
    assert.equal(settings.normalizeShortcut(' control + option + Alt + KeyN '), `Ctrl+${alt}+N`);
    assert.equal(settings.normalizeShortcut('Shift+Digit1'), 'Shift+1');
    assert.equal(settings.shortcutIdentity('CmdOrCtrl+Option+Shift+N'),
      modifier === 'CMD' ? 'ALT+SHIFT+CMD+N' : 'CTRL+ALT+SHIFT+N');
  });

  test(`${platform}: persisted custom shortcuts keep their meaning`, async () => {
    const { settings } = loadPlatform(platform, {
      shortcuts: { toggleWindow: 'Ctrl+Alt+P', newNote: 'Ctrl+Shift+P' },
    });
    const saved = await settings.loadSettings();
    assert.equal(saved.shortcuts.toggleWindow, `Ctrl+${alt}+P`);
    assert.equal(saved.shortcuts.newNote, 'Ctrl+Shift+P');
  });

  test(`${platform}: native shortcut aliases dispatch only pressed matching actions`, async () => {
    const runtime = loadPlatform(platform);
    const actions = [];
    const result = await runtime.shortcuts.registerGlobalShortcuts({
      toggleWindow: 'CmdOrCtrl+Alt+N', newNote: 'CmdOrCtrl+Alt+Shift+N',
    }, {
      toggleWindow: () => actions.push('toggle'), newNote: () => actions.push('new'),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(runtime.registered(), [`CmdOrCtrl+${alt}+N`, `CmdOrCtrl+${alt}+Shift+N`]);
    const nativeModifier = modifier === 'CMD' ? 'Super' : 'Control';
    runtime.emit(`Alt+${nativeModifier}+KeyN`);
    runtime.emit(`Shift+Alt+${nativeModifier}+KeyN`);
    runtime.emit(`Alt+${nativeModifier}+KeyN`, 'Released');
    runtime.emit(`Alt+${nativeModifier}+KeyP`);
    assert.deepEqual(actions, ['toggle', 'new']);
  });
}

test('macOS migrates legacy Windows defaults while Windows preserves them', async () => {
  for (const platform of ['MacIntel', 'Win32']) {
    const { settings } = loadPlatform(platform, {
      shortcuts: { toggleWindow: 'Alt+N', newNote: 'Alt+Shift+N' },
    });
    const saved = await settings.loadSettings();
    assert.deepEqual(Object.values(saved.shortcuts), Object.values(settings.platformDefaultShortcuts()));
  }
});

for (const platform of ['MacIntel', 'Win32']) {
  test(`${platform}: shortcut recording preserves physical letters and digits under modifiers`, () => {
    const { settings } = loadPlatform(platform);
    assert.equal(typeof settings.shortcutKeyFromEvent, 'function');
    for (const [key, code, expected] of [
      ['Dead', 'KeyN', 'N'], ['π', 'KeyP', 'P'], ['¡', 'Digit1', '1'],
      ['!', 'Digit1', '1'], ['z', 'KeyY', 'Y'], ['ArrowUp', 'ArrowUp', 'ArrowUp'],
      [' ', 'Space', 'Space'], ['F2', 'F2', 'F2'], ['n', '', 'N'],
      ['Dead', '', ''], ['Unidentified', '', ''],
    ]) {
      assert.equal(settings.shortcutKeyFromEvent({ key, code }), expected);
    }
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const firstShortcuts = { toggleWindow: 'Ctrl+N', newNote: 'Ctrl+Shift+N' };
const nextShortcuts = { toggleWindow: 'Ctrl+P', newNote: 'Ctrl+Shift+P' };
const noActions = { toggleWindow() {}, newNote() {} };

function shortcutRuntime({ blockFirst = false, failFirst = false, failCleanup = false } = {}) {
  const started = deferred();
  const finish = deferred();
  const registrations = new Map();
  const listeners = [];
  let registerCalls = 0;
  let cleanupCalls = 0;
  const runtime = loadPlatform('Win32', null, {
    register: async (shortcuts, listener) => {
      const first = ++registerCalls === 1;
      listeners.push(listener);
      if (first) {
        started.resolve();
        if (blockFirst) await finish.promise;
      }
      for (const shortcut of shortcuts) {
        if (registrations.has(shortcut)) throw new Error('Already registered');
        registrations.set(shortcut, listener);
        if (first && failFirst) throw new Error('Shortcut occupied');
      }
    },
    unregisterAll: async () => {
      if (++cleanupCalls === 1 && failCleanup) throw new Error('Native cleanup failed');
      registrations.clear();
    },
  });
  return { ...runtime, started, finish, registrations, listeners };
}

test('concurrent shortcut updates leave only the newest bindings active', async () => {
  const runtime = shortcutRuntime({ blockFirst: true });
  const first = runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions);
  await runtime.started.promise;
  const next = runtime.shortcuts.registerGlobalShortcuts(nextShortcuts, noActions);
  runtime.finish.resolve();
  const [oldResult, newResult] = await Promise.all([first, next]);
  assert.equal(newResult.ok, true);
  assert.deepEqual([...runtime.registrations.keys()], ['Ctrl+P', 'Ctrl+Shift+P']);
  assert.equal(oldResult.cancelled, true);
});

test('teardown removes a registration that is still in flight', async () => {
  const runtime = shortcutRuntime({ blockFirst: true });
  const pending = runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions);
  await runtime.started.promise;
  const teardown = runtime.shortcuts.unregisterGlobalShortcuts();
  runtime.finish.resolve();
  await Promise.all([pending, teardown]);
  assert.equal(runtime.registrations.size, 0);
});

test('superseding registration disables old shortcut callbacks immediately', async () => {
  const runtime = shortcutRuntime();
  let toggles = 0;
  await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, {
    ...noActions, toggleWindow: () => toggles++,
  });
  const next = runtime.shortcuts.registerGlobalShortcuts(nextShortcuts, noActions);
  runtime.listeners[0]({ shortcut: 'Ctrl+N', state: 'Pressed' });
  await next;
  assert.equal(toggles, 0);
});

test('holding a shortcut triggers once until Released, independently for each action', async () => {
  const runtime = loadPlatform('Win32');
  const actions = [];
  await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, {
    toggleWindow: () => actions.push('toggle'), newNote: () => actions.push('new'),
  });
  runtime.emit('Control+KeyN');
  runtime.emit('Ctrl+N');
  runtime.emit('Ctrl+Shift+N');
  runtime.emit('Shift+Control+KeyN');
  runtime.emit('Ctrl+N', 'Released');
  runtime.emit('Control+KeyN');
  assert.deepEqual(actions, ['toggle', 'new', 'toggle']);
});

test('partial registration failure cleans native bindings and allows retry', async () => {
  const runtime = shortcutRuntime({ failFirst: true });
  assert.equal((await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions)).ok, false);
  assert.equal(runtime.registrations.size, 0);
  assert.equal((await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions)).ok, true);
  assert.deepEqual([...runtime.registrations.keys()], ['Ctrl+N', 'Ctrl+Shift+N']);
});

test('failed partial cleanup is retried before the next registration', async () => {
  const runtime = shortcutRuntime({ failFirst: true, failCleanup: true });
  assert.equal((await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions)).ok, false);
  assert.equal((await runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions)).ok, true);
  assert.deepEqual([...runtime.registrations.keys()], ['Ctrl+N', 'Ctrl+Shift+N']);
});

test('an older partial failure cannot unregister newer bindings', async () => {
  const runtime = shortcutRuntime({ blockFirst: true, failFirst: true });
  const first = runtime.shortcuts.registerGlobalShortcuts(firstShortcuts, noActions);
  await runtime.started.promise;
  const next = runtime.shortcuts.registerGlobalShortcuts(nextShortcuts, noActions);
  runtime.finish.resolve();
  await Promise.all([first, next]);
  assert.deepEqual([...runtime.registrations.keys()], ['Ctrl+P', 'Ctrl+Shift+P']);
});
