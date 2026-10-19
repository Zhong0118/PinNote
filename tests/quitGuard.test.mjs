import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const exports = {};
runInNewContext(ts.transpileModule(readFileSync('src/lib/quitGuard.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports });
const { createQuitGuard } = exports;

test('a cancelled save cannot freeze a late window through a stale pending reply', () => {
  const guard = createQuitGuard();
  assert.equal(guard.cancel(1), true);
  assert.equal(guard.begin(1), false);
  assert.equal(guard.begin(2), true);
});
test('duplicate save events are ignored and an old cancellation cannot unfreeze a new save', () => {
  const guard = createQuitGuard();
  assert.equal(guard.begin(1), true);
  assert.equal(guard.begin(1), false);
  assert.equal(guard.begin(2), true);
  assert.equal(guard.cancel(1), false);
  assert.equal(guard.isCurrent(2), true);
  assert.equal(guard.cancel(2), true);
  assert.equal(guard.isCurrent(2), false);
});
