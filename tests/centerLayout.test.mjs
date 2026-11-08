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
const { handleBounds, dockAt, snapSide, detachedBounds, validWindow, migrateSession, avoidRanges, barBounds, nearestSide, CENTER_HANDLE } = load('centerLayout');
const main = {name:'Built-in',scaleFactor:1,workArea:{position:{x:0,y:25},size:{width:1512,height:920}}};
const side = {name:'DELL U2720Q',scaleFactor:1,workArea:{position:{x:1512,y:0},size:{width:1920,height:1080}}};
const both = [main, side];

test('handle sits flush on its edge at the remembered ratio of the work area',()=>{
  const right=handleBounds({display:'Built-in',side:'right',ratio:0.5},both);
  assert.equal(right.x+right.width,1512); assert.equal(right.y,Math.round(25+460-CENTER_HANDLE.height/2));
  const left=handleBounds({display:'DELL U2720Q',side:'left',ratio:0.5},both);
  assert.equal(left.x,1512,'stays on the display it was docked to');
});

test('handle is clamped inside the work area and falls back when its display is gone',()=>{
  const low=handleBounds({display:'Built-in',side:'left',ratio:1},both);
  assert.ok(low.y+low.height<=25+920);
  const gone=handleBounds({display:'Projector',side:'right',ratio:0.2},both);
  assert.equal(gone.x+gone.width,1512,'unplugged display falls back to the primary work area');
});

test('handle avoids the note tab queue on the same edge',()=>{
  const free=handleBounds({display:'Built-in',side:'right',ratio:0.2},both);
  const queue=[{top:free.y-20,bottom:free.y+120}];
  const moved=handleBounds({display:'Built-in',side:'right',ratio:0.2},both,queue);
  assert.ok(moved.y+moved.height<=queue[0].top||moved.y>=queue[0].bottom);
  assert.equal(avoidRanges(50,10,[],0,100),50);
});

test('dock position is a display id, edge and vertical ratio',()=>{
  const dock=dockAt({x:2000,y:540},'left',both);
  assert.deepEqual({...dock},{display:'DELL U2720Q',side:'left',ratio:0.5});
});

test('dragging snaps only when pushed past an edge or the pointer reaches it',()=>{
  const win={x:300,y:100,width:900,height:600,scaleFactor:1};
  assert.equal(snapSide(win,{x:600,y:120},both),null,'a window simply resting near the edge does not snap');
  assert.equal(snapSide({...win,x:-40},{x:200,y:120},both),'left');
  assert.equal(snapSide(win,{x:1508,y:120},[main]),'right','pointer at the outer edge');
  assert.equal(snapSide({...win,x:1512-900},{x:1300,y:120},both),null,'flush against an inner edge is not a snap');
});

test('drag-out places the pointer on the title bar toward the edge it came from',()=>{
  const b=detachedBounds({width:900,height:500},{x:1400,y:400},'right',[main]);
  assert.equal(b.width,900); assert.ok(1400-b.x>=900-120-1&&1400-b.x<=900); assert.equal(b.y,382);
});

test('saved window must be large enough and on a display',()=>{
  assert.ok(validWindow({x:100,y:100,width:900,height:600,scaleFactor:1},both));
  assert.ok(!validWindow({x:9000,y:100,width:900,height:600,scaleFactor:1},both),'off every display');
  assert.ok(!validWindow({x:100,y:100,width:40,height:30,scaleFactor:1},both),'a collapsed frame is not a window');
  assert.ok(!validWindow(undefined,both));
});

test('legacy panel maps to the normal window, legacy handle keeps its side',()=>{
  const panel=migrateSession({mode:'panel',side:'left',panelWidth:440,window:{x:1,y:2,width:900,height:600,scaleFactor:2},tabs:['a',3]});
  assert.equal(panel.mode,'window'); assert.equal(panel.dock.side,'left'); assert.deepEqual([...panel.tabs],['a']);
  assert.deepEqual({...panel.window},{x:1,y:2,width:900,height:600,scaleFactor:2},'valid normal geometry survives');
  const handle=migrateSession({mode:'handle',side:'right'});
  assert.equal(handle.mode,'handle'); assert.equal(handle.dock.side,'right'); assert.equal(handle.window,undefined);
  assert.equal(migrateSession('garbage').mode,'window');
});

test('bar keeps the top-left corner; nearest side follows the window centre',()=>{
  const b=barBounds({x:100,y:200,width:900,height:600,scaleFactor:1},[main]);
  assert.equal(b.x,100); assert.equal(b.y,200); assert.equal(b.width,320);
  assert.equal(nearestSide({x:900,y:0,width:500,height:400,scaleFactor:1},main),'right');
});
