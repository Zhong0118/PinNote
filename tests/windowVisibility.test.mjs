import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const flush = () => new Promise(setImmediate);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

// Only substitute Tauri's event boundary and the timeout clock.
function setup() {
  const listeners = new Set();
  const timers = new Map();
  const sent = [];
  let timerId = 0;
  let now = 10000;
  let failSend = false;
  function deliver(target, event, payload) {
    for (const entry of [...listeners]) {
      if (entry.event === event && (target == null || entry.target === target)) entry.handler({ payload });
    }
  }
  function load(label) {
    const exports = {};
    const source = readFileSync('src/lib/windowVisibility.ts', 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, {
      exports, crypto: globalThis.crypto, Error, Date: { now: () => now },
      setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay, at: now + delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      require(name) {
        if (name === '@tauri-apps/api/window') return { getCurrentWindow: () => ({ label }) };
        if (name === '@tauri-apps/api/event') return {
          async listen(event, handler, options) {
            const target = typeof options?.target === 'string' ? options.target : options?.target?.label;
            const entry = { event, handler, target };
            listeners.add(entry);
            return () => listeners.delete(entry);
          },
          async emitTo(target, event, payload) {
            if (failSend) throw new Error('window unavailable');
            sent.push({ target, event, payload });
            deliver(typeof target === 'string' ? target : target.label, event, payload);
          },
          async emit(event, payload) { sent.push({ event, payload }); deliver(null, event, payload); },
        };
        throw new Error(`Unexpected import: ${name}`);
      },
    });
    return exports;
  }
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  }
  return { load, sent, listeners, timers, deliver, advance, failSend: () => { failSend = true; } };
}

test('visibility request waits for the target operation, not event delivery', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  const operation = deferred();
  let visible = true, completed = false;
  const unlisten = await receiver.listenWindowVisibility(async next => { await operation.promise; visible = next; });
  const request = sender.requestWindowVisibility('note-a', false).then(() => { completed = true; });
  await flush();
  assert.equal(completed, false);
  assert.equal(visible, true);
  operation.resolve();
  await request;
  assert.equal(visible, false);
  await bus.advance(5000);
  assert.equal(bus.timers.size, 0);
  assert.equal(bus.listeners.size, 1);
  unlisten();
  assert.equal(bus.listeners.size, 0);
});

test('failed operation rejects the request and the next operation still succeeds', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  let visible = true;
  await receiver.listenWindowVisibility(async next => {
    if (!next) throw new Error('disk full');
    visible = next;
  });
  await assert.rejects(sender.requestWindowVisibility('note-a', false), /disk full/);
  await sender.requestWindowVisibility('note-a', true);
  assert.equal(visible, true);
  assert.equal(bus.listeners.size, 1);
  await bus.advance(5000);
  assert.equal(bus.timers.size, 0);
});

test('a window executes hide and show in request order without overlap', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  const hidden = deferred(), operations = [];
  let visible = true;
  await receiver.listenWindowVisibility(async next => {
    operations.push(next);
    if (!next) await hidden.promise;
    visible = next;
  });
  const hide = sender.requestWindowVisibility('note-a', false);
  const show = sender.requestWindowVisibility('note-a', true);
  await flush();
  assert.deepEqual(operations, [false]);
  hidden.resolve();
  await Promise.all([hide, show]);
  assert.deepEqual(operations, [false, true]);
  assert.equal(visible, true);
});

test('requests target one window and unrelated acknowledgements cannot complete them', async () => {
  const bus = setup(), sender = bus.load('main'), a = bus.load('note-a'), b = bus.load('note-b');
  const aDone = deferred();
  let aComplete = false, bCalls = 0;
  await a.listenWindowVisibility(async () => { await aDone.promise; });
  await b.listenWindowVisibility(async () => { bCalls += 1; });
  const first = sender.requestWindowVisibility('note-a', false).then(() => { aComplete = true; });
  await sender.requestWindowVisibility('note-b', true);
  assert.equal(bCalls, 1);
  assert.equal(aComplete, false);
  const ids = bus.sent.filter(item => item.target).map(item => item.payload.requestId);
  assert.equal(new Set(ids).size, 2);
  aDone.resolve();
  await first;
});

test('an unresponsive window times out and removes its acknowledgement listener', async () => {
  const bus = setup(), sender = bus.load('main');
  const request = sender.requestWindowVisibility('missing', false);
  const rejected = assert.rejects(request, /超时|timed out/i);
  await flush();
  await bus.advance(5000);
  await rejected;
  assert.equal(bus.listeners.size, 0);
  assert.equal(bus.timers.size, 0);
});

test('event delivery failure rejects immediately and cleans up resources', async () => {
  const bus = setup(), sender = bus.load('main');
  bus.failSend();
  await assert.rejects(sender.requestWindowVisibility('note-a', false), /window unavailable/);
  assert.equal(bus.listeners.size, 0);
  assert.equal(bus.timers.size, 0);
});


test('an early request is retried when the window listener becomes ready and executes once', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  let calls = 0;
  const request = sender.requestWindowVisibility('note-a', true);
  await flush();
  await bus.advance(250);
  const unlisten = await receiver.listenWindowVisibility(async () => { calls += 1; });
  await bus.advance(250);
  assert.equal(calls, 1);
  await request;
  const requests = bus.sent.filter(item => item.target);
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests.map(item => item.payload.requestId)).size, 1);
  const first = requests[0];
  bus.deliver(first.target, first.event, first.payload);
  await flush();
  assert.equal(calls, 1);
  assert.equal(bus.sent.filter(item => !item.target).length, 2);
  // Only the result cache remains; dispose also cleans its retention timer.
  assert.equal(bus.timers.size, 1);
  unlisten();
  assert.equal(bus.timers.size, 0);
  assert.equal(bus.listeners.size, 0);
});

test('slow in-flight requests stay deduplicated even beyond the caller timeout', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  const done = deferred();
  let calls = 0, deadline;
  const unlisten = await receiver.listenWindowVisibility(async (_visible, expiresAt) => {
    calls += 1; deadline = expiresAt; await done.promise;
  });
  const rejected = assert.rejects(sender.requestWindowVisibility('note-a', true), /超时/);
  await flush();
  await bus.advance(6000);
  await rejected;
  assert.equal(calls, 1);
  assert.equal(deadline, 15000);
  const first = bus.sent.find(item => item.target);
  bus.deliver(first.target, first.event, first.payload);
  await flush();
  assert.equal(calls, 1);
  done.resolve();
  await flush();
  assert.equal(calls, 1);
  unlisten();
  assert.equal(bus.timers.size, 0);
});

test('a request that expires in the queue never invokes its handler', async () => {
  const bus = setup(), sender = bus.load('main'), receiver = bus.load('note-a');
  const done = deferred(), calls = [];
  await receiver.listenWindowVisibility(async visible => { calls.push(visible); await done.promise; });
  const first = assert.rejects(sender.requestWindowVisibility('note-a', false), /超时/);
  const second = assert.rejects(sender.requestWindowVisibility('note-a', true), /超时/);
  await flush();
  await bus.advance(5000);
  await Promise.all([first, second]);
  done.resolve();
  await flush();
  assert.deepEqual(calls, [false]);
  const secondId = bus.sent.find(item => item.target && item.payload.visible).payload.requestId;
  const ack = bus.sent.find(item => !item.target && item.payload.requestId === secondId).payload;
  assert.equal(ack.success, false);
  assert.match(ack.message, /超时/);
});
