import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports = {};
runInNewContext(ts.transpileModule(readFileSync('src/lib/excerpt.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
const { plainExcerpt } = exports;

test('excerpts drop Markdown markers but keep the words', () => {
  const md = '# 今天\n\n- [ ] 阅读源码\n- [x] 整理思路\n\n**重点** 见 [文档](https://x.y) 和 `code`\n\n```js\nconst a = 1;\n```';
  assert.equal(plainExcerpt(md), '今天\n\n○ 阅读源码\n✓ 整理思路\n\n重点 见 文档 和 code\n\nconst a = 1;');
});

test('long text is cut with an ellipsis', () => {
  assert.equal(plainExcerpt('a'.repeat(20), 5), 'aaaaa…');
});

test('reminder times are short and relative to today', () => {
  const { shortTime } = exports;
  const now = new Date(2026, 10, 8, 9, 0).getTime();
  assert.equal(shortTime(new Date(2026, 10, 8, 16, 5).getTime(), now), '今天 16:05');
  assert.equal(shortTime(new Date(2026, 10, 9, 8, 30).getTime(), now), '明天 08:30');
  assert.equal(shortTime(new Date(2026, 11, 24, 20, 0).getTime(), now), '12月24日 20:00');
  assert.equal(shortTime(new Date(2027, 0, 2, 7, 0).getTime(), now), '2027年1月2日 07:00');
});

test('a first line that repeats the title is left out, and the preview can skip code', () => {
  const md = '# 周会要点\n\n- [x] 确认时间\n- [ ] 整理清单\n\n```bash\npnpm test\n```\n\n下周二前发出。';
  assert.equal(plainExcerpt(md, 160, { title: '周会要点', code: false }), '✓ 确认时间\n○ 整理清单\n\n下周二前发出。');
  assert.equal(plainExcerpt(md, 160, { title: '别的标题' }).split('\n')[0], '周会要点', 'a different first line stays');
  assert.equal(plainExcerpt('# 只有标题', 160, { title: '只有标题' }), '');
  assert.equal(plainExcerpt('正文\n```js\nconst a = 1;', 160, { code: false }), '正文', 'an unclosed fence is left out to the end');
});
