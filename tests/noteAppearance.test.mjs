import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const exports = {};
runInNewContext(
  ts.transpileModule(readFileSync('src/lib/noteAppearance.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports },
);

const { displayTitle, noteAccent, noteColors, noteBackground } = exports;

test('displayTitle prefers explicit title and otherwise derives from first content line', () => {
  assert.equal(displayTitle('周会记录', '- [ ] 待办'), '周会记录');
  assert.equal(displayTitle('', '# 产品评审\n\n- [ ] 确认细节'), '产品评审');
  assert.equal(displayTitle('   ', '\n- [ ] 买咖啡豆\n- [ ] 整理书架'), '买咖啡豆');
  assert.equal(displayTitle('', '```ts\nconst x = 1;\n```\n实际第一行'), 'const x = 1;');
  assert.equal(displayTitle('', '   \n---\n\n'), '未命名便签');
  const long = '一'.repeat(60);
  assert.equal(displayTitle('', long), `${'一'.repeat(48)}…`);
});

test('noteAppearance includes warm cream palette and harmonious per-theme accents', () => {
  assert.ok(noteColors.some(c => c.theme === 'cream'));
  assert.equal(noteBackground('cream', '#000000'), '#fffcf0');
  assert.equal(noteAccent('paper', '#2563eb', false), undefined);
  assert.equal(noteAccent('ink', '#2563eb', true), undefined);
  assert.ok(noteAccent('mint', '#2563eb', false));
  assert.ok(noteAccent('cream', '#2563eb', true));
  assert.equal(noteAccent('custom', '#2d7d74', false), '#2d7d74');
});
