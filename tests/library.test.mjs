import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const load = (file, context = {}) => {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Date, ...context });
  return exports;
};
const filename = load('src/lib/filename.ts');
const lib = load('src/lib/library.ts', { require: () => filename });
const plain = value => JSON.parse(JSON.stringify(value));

test('starred notes come first and keep their order', () => {
  const list = [{ id: 'a' }, { id: 'b', starredAt: 5 }, { id: 'c' }, { id: 'd', starredAt: 9 }];
  assert.deepEqual(plain(lib.starredFirst(list).map(n => n.id)), ['b', 'd', 'a', 'c']);
});

test('quick filters combine: star, live reminder, open to-dos and a tag', () => {
  const f = { ...lib.noQuickFilters(), reminder: true, tag: '工作' };
  const note = { tags: ['工作'], reminder: { state: 'pending' } };
  assert.equal(lib.passesQuickFilters(note, f, 0), true);
  assert.equal(lib.passesQuickFilters({ ...note, reminder: { state: 'paused' } }, f, 0), false, 'archived reminders are paused');
  assert.equal(lib.passesQuickFilters({ ...note, tags: ['读书'] }, f, 0), false);
  assert.equal(lib.passesQuickFilters(note, { ...f, todo: true }, 0), false);
  assert.equal(lib.passesQuickFilters(note, { ...f, todo: true }, 2), true);
  assert.equal(lib.quickFilterCount(f), 2);
});

test('tags are counted case-insensitively outside the trash', () => {
  const notes = [
    { lifecycle: 'active', tags: ['Work', '读书'] }, { lifecycle: 'archived', tags: ['work'] }, { lifecycle: 'trash', tags: ['读书', '读书'] },
  ];
  assert.deepEqual(plain(lib.tagCounts(notes)), [{ tag: 'Work', count: 2 }, { tag: '读书', count: 1 }]);
});

test('search matches are split out for highlighting and shown in the excerpt', () => {
  assert.deepEqual(plain(lib.highlightParts('Plan the plan', 'plan')), [{ text: 'Plan', hit: true }, { text: ' the ', hit: false }, { text: 'plan', hit: true }]);
  assert.deepEqual(plain(lib.highlightParts('abc', '')), [{ text: 'abc', hit: false }]);
  const long = `${'前'.repeat(120)}关键字在这里`;
  const snippet = lib.matchSnippet(long, '关键字', 40);
  assert.ok(snippet.startsWith('…') && snippet.includes('关键字'));
  assert.equal(lib.matchSnippet('开头就有关键字', '关键字', 40), '开头就有关键字');
  assert.equal(lib.matchSnippet('○ 整理需求 ✓ 发版 下周继续讨论侧栏排序。', '排序', 100), '…继续讨论侧栏排序。');
});

test('daily activity merges the log with what notes tell about earlier days', () => {
  const day = new Date(2026, 10, 10, 9).getTime(), since = new Date(2026, 10, 11).getTime();
  const activity = { since, b: { [Math.floor(new Date(2026, 10, 12, 10).getTime() / 1800000)]: [2, 1, 3] } };
  const days = lib.dailyActivity(activity, [
    { createdAt: day, updatedAt: day, editedAt: new Date(2026, 10, 10, 20).getTime(), lifecycle: 'active' },
    { createdAt: since + 1000, updatedAt: since + 1000, lifecycle: 'active' },
  ]);
  assert.deepEqual(plain(days.get('2026-11-10')), { edits: 0, created: 1, done: 0 }, 'same-day edit is part of creating it');
  assert.deepEqual(plain(days.get('2026-11-12')), { edits: 2, created: 1, done: 3 });
  assert.equal(days.has('2026-11-11'), false, 'logged days are not filled in twice');
});

test('streaks count back from today, or from yesterday before today has activity', () => {
  const day = { edits: 1, created: 0, done: 0 };
  const days = new Map([['2026-11-08', day], ['2026-11-09', day], ['2026-11-10', day], ['2026-11-11', day], ['2026-11-01', day], ['2026-11-02', day]]);
  assert.deepEqual(plain(lib.streaks(days, new Date(2026, 10, 12, 8).getTime())), { current: 4, longest: 4 });
  assert.deepEqual(plain(lib.streaks(days, new Date(2026, 10, 14, 8).getTime())), { current: 0, longest: 4 });
});

test('the heatmap ends with this week, Monday first, and scales to the busiest day', () => {
  const now = new Date(2026, 10, 12, 12).getTime(); // a Thursday
  const days = new Map([['2026-11-12', { edits: 4, created: 0, done: 0 }], ['2026-11-11', { edits: 1, created: 0, done: 0 }]]);
  const grid = lib.heatmap(days, now, 3);
  assert.equal(grid.length, 3);
  const week = grid.at(-1);
  assert.equal(week[0].key, '2026-11-09');
  assert.equal(week[3].level, 4);
  assert.equal(week[2].level, 1);
  assert.equal(week[4].future, true);
  assert.equal(lib.recent(days, now, 7, 'edits'), 5);
});

test('export puts archived notes in a folder, skips the trash and never reuses a name', () => {
  const files = lib.exportFiles([
    { title: '周会', lifecycle: 'active', content: 'a' }, { title: '周会', lifecycle: 'active', content: 'b' },
    { title: 'a/b', lifecycle: 'archived', content: 'c' }, { title: '旧', lifecycle: 'trash', content: 'd' }, { title: '', lifecycle: 'active', content: 'e' },
  ]);
  assert.deepEqual(plain(files.map(f => f.path)), ['周会.md', '周会 (2).md', '归档/a-b.md', '未命名便签.md']);
  assert.match(lib.exportFolderName(new Date(2026, 0, 2, 3, 4).getTime()), /^PinNote 导出 2026-01-02 0304$/);
});

test('trash countdown rounds up, never shows zero, and is off when the trash is kept', () => {
  const day = 86400000, now = 100 * day;
  assert.equal(lib.trashDaysLeft(now - 10 * day, 30, now), 20);
  assert.equal(lib.trashDaysLeft(now - 10.5 * day, 30, now), 20);
  assert.equal(lib.trashDaysLeft(now - 40 * day, 30, now), 1);
  assert.equal(lib.trashDaysLeft(undefined, 60, now), 60);
  assert.equal(lib.trashDaysLeft(now, 0, now), null);
});

test('a day lists the notes created or last edited on it, newest first', () => {
  const at = (d, h) => new Date(2026, 10, d, h).getTime();
  const notes = [
    { id: 'a', lifecycle: 'active', createdAt: at(10, 9), updatedAt: at(12, 9), editedAt: at(12, 9) },
    { id: 'b', lifecycle: 'active', createdAt: at(12, 8), updatedAt: at(12, 8) },
    { id: 'c', lifecycle: 'trash', createdAt: at(12, 7), updatedAt: at(12, 7) },
    { id: 'd', lifecycle: 'archived', createdAt: at(11, 7), updatedAt: at(11, 7) },
  ];
  assert.deepEqual(plain(lib.notesOnDay(notes, '2026-11-12').map(h => [h.note.id, h.created])), [['a', false], ['b', true]]);
  assert.deepEqual(plain(lib.notesOnDay(notes, '2026-11-10').map(h => h.note.id)), ['a']);
  const grid = lib.heatmap(new Map([['2026-11-12', { edits: 2, created: 1, done: 0 }], ['2026-11-10', { edits: 0, created: 0, done: 3 }]]), at(12, 12), 2);
  assert.deepEqual(plain(lib.heatTotals(grid)), { days: 2, edits: 2, created: 1, done: 3 });
});
