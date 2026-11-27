import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(readFileSync('src/lib/quickCapture.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports },
);
const { parseQuickCapture } = exports;

test('extracts inline #tags and @relative reminders while keeping text clean', () => {
  const now = new Date(2026, 4, 10, 14, 0, 0).getTime();
  const res = parseQuickCapture('买牛奶 #生活 #待办 @30m', now);
  assert.equal(res.content, '买牛奶');
  assert.deepEqual(JSON.parse(JSON.stringify(res.tags)), ['生活', '待办']);
  assert.equal(res.reminderAt, now + 30 * 60_000);
  assert.equal(res.reminderLabel, '30 分钟后');
});

test('supports [] checklist shorthand, @clock times, and preserves hex colors and markdown headings', () => {
  const now = new Date(2026, 4, 10, 14, 0, 0).getTime();
  const res = parseQuickCapture('[] 配色使用 #2563eb @18:30 #设计', now);
  assert.equal(res.content, '- [ ] 配色使用 #2563eb');
  assert.deepEqual(JSON.parse(JSON.stringify(res.tags)), ['设计']);
  assert.equal(res.reminderAt, new Date(2026, 4, 10, 18, 30, 0).getTime());
  assert.equal(res.reminderLabel, '今天 18:30');

  const heading = parseQuickCapture('# 项目周报\n整理进度 @明天10:00', now);
  assert.equal(heading.content, '# 项目周报\n整理进度');
  assert.deepEqual(JSON.parse(JSON.stringify(heading.tags)), []);
  assert.equal(heading.reminderAt, new Date(2026, 4, 11, 10, 0, 0).getTime());
  assert.equal(heading.reminderLabel, '明天 10:00');
});
