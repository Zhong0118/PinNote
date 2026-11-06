import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(file) {
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(`src/lib/${file}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:()=>load('windowGeometry')});
  return exports;
}
const {edgeTarget,edgeLayout} = load('edgeQueue');
const display = {scaleFactor:2,workArea:{position:{x:2000,y:40},size:{width:2400,height:200}}};
const note = (id,order) => ({id,lifecycle:'active',placement:'desktop',window:{collapsed:true,edge:{display:'2000:40',side:'right',order}}});
test('edge queue uses work area, DPI, stable ordering and overflow',()=>{
  const result = edgeLayout([note('b',200),note('a',100),note('c',300)],[display]);
  assert.equal(result.get('a').bounds.x,4040);
  assert.equal(result.get('a').bounds.y,40);
  assert.equal(result.get('b').bounds.y,136);
  assert.equal(result.get('b').extra,1);
  assert.equal(result.get('c').overflow,true);
  assert.equal(edgeTarget({x:4040,y:50,width:180,height:40,scaleFactor:2},[display]).side,'right');
  assert.equal(edgeTarget({x:3000,y:50,width:180,height:40,scaleFactor:2},[display]),null);
});
test('disconnected display queues recover and lifecycle filters exclude removed notes',()=>{
  const a=note('a',1); a.window.edge.display='gone';
  const b=note('b',2); b.lifecycle='trash';
  const result=edgeLayout([a,b],[display]);
  assert.equal(result.size,1); assert.equal(result.get('a').bounds.y,40);
});
