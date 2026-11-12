import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports = {};
const require = () => ({ motionReduced: () => false, MOTION: 220 });
runInNewContext(ts.transpileModule(readFileSync('src/lib/sortable.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require });
const { targetIndex, slideFor, moveAmong, arrange } = exports;

test('the lifted item lands after every other item whose midpoint it has passed', () => {
  const mids = [10, 30, 50, 70];
  assert.equal(targetIndex(mids, 1, 5), 0);
  assert.equal(targetIndex(mids, 1, 30), 1, 'its own midpoint never counts');
  assert.equal(targetIndex(mids, 1, 51), 2);
  assert.equal(targetIndex(mids, 1, 99), 3);
});

test('only the items between the old and new place slide, toward the gap', () => {
  // Item 1 lifted and hovering at position 3: items 2 and 3 move up one step.
  assert.deepEqual([0, 1, 2, 3].map(i => slideFor(i, 1, 3, 40)), [0, 0, -40, -40]);
  // Item 3 lifted and hovering at position 0: items 0..2 move down one step.
  assert.deepEqual([0, 1, 2, 3].map(i => slideFor(i, 3, 0, 40)), [40, 40, 40, 0]);
  assert.deepEqual([0, 1, 2].map(i => slideFor(i, 1, 1, 40)), [0, 0, 0]);
});

test('moving within the full list', () => {
  const all = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveAmong(all, all, 'a', 3), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveAmong(all, all, 'a', 4), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveAmong(all, all, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.equal(moveAmong(all, all, 'b', 1), all, 'dropping on its own slot changes nothing');
  assert.equal(moveAmong(all, all, 'b', 2), all, 'the slot right after itself is also its own place');
});

test('moving within a filtered view keeps hidden items in place', () => {
  const order = ['a', 'x', 'b', 'y', 'c'];
  const shown = ['a', 'b', 'c'];
  assert.deepEqual(moveAmong(order, shown, 'c', 0), ['c', 'a', 'x', 'b', 'y']);
  assert.deepEqual(moveAmong(order, shown, 'a', 3), ['x', 'b', 'y', 'c', 'a']);
  assert.deepEqual(moveAmong(order, shown, 'a', 2), ['x', 'b', 'y', 'a', 'c'], 'lands right before the shown item it was dropped above');
});

test('notes without a manual place come first, newest edit first; stale ids are ignored', () => {
  const notes = [{ id: 'new' }, { id: 'b' }, { id: 'a' }, { id: 'c' }];
  assert.deepEqual(Array.from(arrange(notes, []), n => n.id), ['new', 'b', 'a', 'c']);
  assert.deepEqual(Array.from(arrange(notes, ['a', 'gone', 'c', 'b']), n => n.id), ['new', 'a', 'c', 'b']);
});
