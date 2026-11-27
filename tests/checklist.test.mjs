import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync('src/lib/checklist.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});
test('mixed markdown task progress excludes code examples',()=>{
  const p=exports.checklistProgress('正文\n- [ ] 未完成\n- [X] 完成\n```md\n- [x] 示例\n```\n1. [x] 有序任务\n~~~\n- [ ] 示例\n~~~');
  assert.equal(p.total,3);assert.equal(p.done,2);
});

test('moveCompletedToBottom sinks checked items per list while skipping fenced code blocks', () => {
  const input = [
    '# 清单',
    '- [x] 已完成 A',
    '- [ ] 未完成 1',
    '  续行说明',
    '- [X] 已完成 B',
    '- [ ] 未完成 2',
    '',
    '```md',
    '- [x] 代码示例不动',
    '- [ ] 代码示例2',
    '```',
  ].join('\n');
  const out = exports.moveCompletedToBottom(input);
  assert.equal(out, [
    '# 清单',
    '- [ ] 未完成 1',
    '  续行说明',
    '- [ ] 未完成 2',
    '- [x] 已完成 A',
    '- [X] 已完成 B',
    '',
    '```md',
    '- [x] 代码示例不动',
    '- [ ] 代码示例2',
    '```',
  ].join('\n'));
});

test('extractOpenTasks gathers only unchecked items outside code fences', () => {
  const res = exports.extractOpenTasks('说明\n* [ ] 任务一\n- [x] 已完成\n1. [ ] 任务二\n```\n- [ ] 示例代码\n```');
  assert.equal(res.count, 2);
  assert.equal(res.openMarkdown, '- [ ] 任务一\n- [ ] 任务二');
});

test('listTasks and toggleTaskAtLine preserve exact line indexes and ignore fenced blocks', () => {
  const md = ['标题', '- [ ] 第一项', '```md', '- [ ] 示例', '```', '- [x] 第二项'].join('\n');
  const items = JSON.parse(JSON.stringify(exports.listTasks(md)));
  assert.deepEqual(items, [
    { lineIndex: 1, checked: false, text: '第一项' },
    { lineIndex: 5, checked: true, text: '第二项' },
  ]);
  const toggled = exports.toggleTaskAtLine(md, 1);
  assert.equal(toggled.split('\n')[1], '- [x] 第一项');
  // Attempting to toggle inside a code fence leaves markdown untouched.
  assert.equal(exports.toggleTaskAtLine(md, 3), md);
});

test('extractCodeBlocks collects fenced blocks with language labels', () => {
  const md = '正文\n```ts\nconst a = 1;\n```\n中间\n~~~bash\necho hi\n~~~';
  const blocks = JSON.parse(JSON.stringify(exports.extractCodeBlocks(md)));
  assert.deepEqual(blocks, [
    { lang: 'ts', code: 'const a = 1;' },
    { lang: 'bash', code: 'echo hi' },
  ]);
});
