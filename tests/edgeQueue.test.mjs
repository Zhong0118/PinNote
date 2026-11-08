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
const {edgeTarget,edgeLayout,edgeOrder} = load('edgeQueue');
const display = {scaleFactor:2,workArea:{position:{x:2000,y:40},size:{width:2400,height:400}}};
const note = (id,order) => ({id,lifecycle:'active',placement:'desktop',window:{collapsed:true,edge:{display:'2000:40',side:'right',order}}});
test('edge queue uses work area, DPI, stable ordering and overflow',()=>{
  const result = edgeLayout([note('b',200),note('a',100),note('c',300)],[display]);
  assert.equal(result.get('a').bounds.x,4344);
  assert.equal(result.get('a').bounds.width,28);
  assert.equal(result.get('a').bounds.y,64);
  assert.equal(result.get('b').bounds.y,204);
  assert.equal(result.get('b').extra,1);
  assert.equal(result.get('c').overflow,true);
  assert.equal(edgeTarget({x:4040,y:50,width:180,height:40,scaleFactor:2},[display]).side,'right');
  assert.equal(edgeTarget({x:3000,y:50,width:180,height:40,scaleFactor:2},[display]),null);
});
test('disconnected display queues recover and lifecycle filters exclude removed notes',()=>{
  const a=note('a',1); a.window.edge.display='gone';
  const b=note('b',2); b.lifecycle='trash';
  const result=edgeLayout([a,b],[display]);
  assert.equal(result.size,1); assert.equal(result.get('a').bounds.y,64);
});
test('reordering uses neighbors rather than stale original drag coordinates',()=>{
  const peers=[note('a',1000),note('b',2000)];
  const edge={display:'2000:40',side:'right',order:0};
  const bounds={x:4344,y:204,width:28,height:64,scaleFactor:2};
  assert.equal(edgeOrder('c',edge,bounds,peers,[display]),1500);
});
test('dragging beyond the work area keeps the edge target',()=>{
  assert.equal(edgeTarget({x:1940,y:50,width:180,height:40,scaleFactor:2},[display]).side,'left');
  assert.equal(edgeTarget({x:4120,y:50,width:180,height:40,scaleFactor:2},[display]).side,'right');
});
test('an expanded docked note keeps its slot and opens flush with its edge',()=>{
  const open=note('a',1); open.window.collapsed=false;
  const result=edgeLayout([open,note('b',2)],[display]);
  assert.equal(result.get('b').bounds.y,204,'peer stays in its own slot');
  const {dockedEditorBounds}=load('edgeQueue');
  const editor=dockedEditorBounds(result.get('a'),{width:420,height:120},[display]);
  assert.equal(editor.x+editor.width*2,4400);
  assert.ok(editor.y>=40);
});
test('a single tab dragged down keeps that height instead of jumping to the top',()=>{
  const {edgePlacement}=load('edgeQueue');
  const edge={display:'2000:40',side:'right',order:0};
  const placed=edgePlacement('a',edge,{x:4344,y:240,width:28,height:64,scaleFactor:2},[],[display]);
  assert.ok(placed.top>0,'queue start remembered');
  const a=note('a',placed.order); a.window.edge={...placed};
  assert.equal(edgeLayout([a],[display]).get('a').bounds.y,240);
});
test('several tabs: the head sets the queue start, others reorder within it',()=>{
  const {edgePlacement}=load('edgeQueue');
  const a=note('a',1),b=note('b',2);
  a.window.edge={...a.window.edge,top:(100-40)/400,topAt:1};
  let layout=edgeLayout([a,b],[display]);
  assert.equal(layout.get('a').bounds.y,100); assert.equal(layout.get('b').bounds.y,240);
  const moved=edgePlacement('c',{display:'2000:40',side:'right',order:0},{x:4344,y:245,width:28,height:64,scaleFactor:2},[a,b],[display]);
  assert.equal(moved.top,undefined,'dropping inside the queue only reorders');
  assert.ok(moved.order>1&&moved.order<2||moved.order>2);
  const head=edgePlacement('c',{display:'2000:40',side:'right',order:0},{x:4344,y:60,width:28,height:64,scaleFactor:2},[a,b],[display]);
  assert.ok(head.order<1&&head.top>0,'dropping before the head moves the queue start');
});
test('stable display names match edges and the queue stays inside the work area',()=>{
  const named={...display,name:'Studio'};
  const a=note('a',1); a.window.edge={display:'Studio',side:'right',order:1,top:0.99,topAt:1};
  const y=edgeLayout([a],[named]).get('a').bounds.y;
  assert.ok(y+64*2<=40+400,'clamped inside the work area');
});
