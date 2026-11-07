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
const { panelBounds, handleBounds, barBounds, offscreenPanel, nearestSide } = load('centerLayout');
const display = {scaleFactor:2,workArea:{position:{x:0,y:50},size:{width:3000,height:1800}}};
test('side panel is flush with the edge and spans the work area',()=>{
  const right=panelBounds(display,'right');
  assert.equal(right.x+right.width*2,3000); assert.equal(right.y,50); assert.equal(right.height,900);
  assert.equal(panelBounds(display,'left').x,0);
  assert.equal(panelBounds(display,'left',100).width,360,'never narrower than the usable minimum');
  assert.equal(offscreenPanel(right,'right').x,3000);
  const beside=panelBounds(display,'right',440,28);
  assert.equal(beside.x+(beside.width+28)*2,3000,'leaves the note tab rail visible');
  assert.equal(offscreenPanel(beside,'right',28).x,3000);
});
test('handle sits on the edge below note tabs, bar keeps the top-left corner',()=>{
  const h=handleBounds(display,'right');
  assert.equal(h.x+h.width*2,3000); assert.ok(h.y>50+900);
  const bar=barBounds({x:400,y:300,width:960,height:660,scaleFactor:2},[display]);
  assert.deepEqual([bar.x,bar.y,bar.width,bar.height],[400,300,320,40]);
  assert.equal(nearestSide({x:2000,y:0,width:500,height:400,scaleFactor:2},display),'right');
});
