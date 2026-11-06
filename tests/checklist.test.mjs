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
