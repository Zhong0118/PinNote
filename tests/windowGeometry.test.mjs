import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports = {};
runInNewContext(ts.transpileModule(readFileSync('src/lib/windowGeometry.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
const { fitBounds, switchBounds, rememberBounds, restoreBounds, normalizeBounds, normalizeDisplays } = exports;
const displays = [
  { scaleFactor: 2, workArea: { position: {x:0,y:50}, size: {width:3024,height:1800} } },
  { scaleFactor: 1, workArea: { position: {x:-1920,y:0}, size: {width:1920,height:1040} } },
];
const normal = { x:400,y:100,width:420,height:560,scaleFactor:2 };
test('capsule round-trip keeps the right edge and expanded size', () => {
  const capsule = switchBounds(normal, normal, true, displays);
  assert.equal(capsule.width, 180); assert.equal(capsule.height, 40); assert.equal(capsule.x, 880);
  const restored = switchBounds(capsule, normal, false, displays);
  assert.equal(restored.x, normal.x); assert.equal(restored.width,420); assert.equal(restored.height,560);
});
test('moving a capsule never overwrites editing dimensions', () => {
  const state = rememberBounds({...normal, collapsed:true}, {...normal,x:800,width:180,height:40});
  assert.equal(state.width,420); assert.equal(state.height,560); assert.equal(state.capsulePosition.x,800);
});
test('negative desktop coordinates survive mixed-DPI restore', () => {
  const state = {width:420,height:560,position:{x:-1600,y:100},x:-800,y:50};
  const restored = restoreBounds(state,normal,displays);
  assert.equal(restored.x,-1600); assert.equal(restored.y,100); assert.equal(restored.scaleFactor,1);
});
test('disconnected display recovers inside the remaining work area', () => {
  const restored = restoreBounds({width:420,height:560,position:{x:-1600,y:100}},normal,[displays[0]]);
  assert.equal(restored.x,0); assert.equal(restored.y,100);
});
test('clamps below menu bar and above dock/taskbar', () => {
  assert.equal(fitBounds({...normal,y:0},displays).y,50);
  assert.equal(fitBounds({...normal,y:1800},displays).y,730);
});
test('restart restores capsule position and old files still use logical positions', () => {
  const restored = restoreBounds({width:420,height:560,collapsed:true,capsulePosition:{x:800,y:100}},normal,displays);
  assert.equal(restored.x,800); assert.equal(restored.width,180);
  const legacy = restoreBounds({width:420,height:560,x:70,y:90},normal,displays);
  assert.equal(legacy.x,140); assert.equal(legacy.y,180);
});

test('expanding at a display boundary stays on the capsule display', () => {
  const expanded = switchBounds({x:10,y:100,width:180,height:40,scaleFactor:2},normal,false,displays);
  assert.equal(expanded.x,0); assert.equal(expanded.scaleFactor,2);
});

const macNativeDisplays = [
  { scaleFactor: 2, workArea: { position: { x: 0, y: 50 }, size: { width: 3024, height: 1800 } } },
  { scaleFactor: 1, workArea: { position: { x: 1512, y: 0 }, size: { width: 1920, height: 1040 } } },
];

test('macOS mixed-DPI coordinates normalize into adjoining global logical displays', () => {
  const screens = normalizeDisplays(macNativeDisplays, true);
  assert.equal(screens[0].workArea.size.width, 1512);
  assert.equal(screens[1].workArea.position.x, 1512);
  const bounds = normalizeBounds({ ...normal, x: 2000, y: 200 }, true);
  assert.equal(bounds.x, 1000);
  assert.equal(bounds.y, 100);
  assert.equal(bounds.width, 420);
  assert.equal(bounds.scaleFactor, 1);
  assert.equal(bounds.nativeScale, 2);
  assert.equal(bounds.space, 'logical');
  assert.equal(fitBounds({ ...bounds, x: 1800 }, screens).x, 1800);
});

test('Windows normalization preserves global physical origins and display scale', () => {
  const screens = normalizeDisplays(macNativeDisplays, false);
  assert.equal(screens[0].workArea.size.width, 3024);
  assert.equal(screens[1].workArea.position.x, 1512);
  const bounds = normalizeBounds(normal, false);
  assert.equal(bounds.x, 400);
  assert.equal(bounds.scaleFactor, 2);
});

const logicalCurrent = { x: 300, y: 100, width: 420, height: 560, scaleFactor: 1, space: 'logical', nativeScale: 2 };
const logicalDisplays = [
  { scaleFactor: 1, workArea: { position: { x: 0, y: 25 }, size: { width: 1512, height: 900 } } },
  { scaleFactor: 1, workArea: { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1040 } } },
];

test('macOS old editor positions prefer the legacy global logical x/y fields', () => {
  const restored = restoreBounds({ width: 420, height: 560, position: { x: -1600, y: 200 }, x: -800, y: 100 }, logicalCurrent, logicalDisplays);
  assert.equal(restored.x, -800);
  assert.equal(restored.y, 100);
});

test('macOS old capsule positions fall back to the current native screen scale', () => {
  const restored = restoreBounds({ width: 420, height: 560, collapsed: true, capsulePosition: { x: 1600, y: 200 } }, logicalCurrent, logicalDisplays);
  assert.equal(restored.x, 800);
  assert.equal(restored.y, 100);
});

test('logical saved coordinates restore unchanged when reopening on another DPI', () => {
  const state = rememberBounds({ width: 420, height: 560 }, { ...logicalCurrent, x: -800 });
  assert.equal(state.positionSpace, 'logical');
  const restored = restoreBounds(state, { ...logicalCurrent, nativeScale: 1 }, logicalDisplays);
  assert.equal(restored.x, -800);
  assert.equal(restored.y, 100);
});

test('first logical capsule save also migrates the old editor position', () => {
  const state = rememberBounds({ width: 420, height: 560, collapsed: true, position: { x: 1600, y: 200 }, x: 800, y: 100 }, logicalCurrent);
  assert.equal(state.positionSpace, 'logical');
  assert.equal(state.position.x, 800);
  assert.equal(state.position.y, 100);
  const expanded = restoreBounds({ ...state, collapsed: false }, logicalCurrent, logicalDisplays);
  assert.equal(expanded.x, 800);
});

test('first logical editor save also migrates the old capsule position', () => {
  const state = rememberBounds({ width: 420, height: 560, capsulePosition: { x: 1600, y: 200 } }, logicalCurrent);
  assert.equal(state.positionSpace, 'logical');
  assert.equal(state.capsulePosition.x, 800);
  assert.equal(state.capsulePosition.y, 100);
});

test('a capsule mostly across a boundary expands on the display containing most of it', () => {
  const capsule = { x: -30, y: 100, width: 180, height: 40, scaleFactor: 1 };
  const expanded = switchBounds(capsule, normal, false, displays);
  assert.equal(expanded.scaleFactor, 2);
  assert.equal(expanded.x, 0);
});

test('switching uses the target display scale while keeping the existing right edge', () => {
  const screens = [
    { scaleFactor: 2, workArea: { position: { x: 0, y: 0 }, size: { width: 1000, height: 1600 } } },
    { scaleFactor: 1, workArea: { position: { x: 1000, y: 0 }, size: { width: 2000, height: 1600 } } },
  ];
  const expanded = switchBounds({ x: 1200, y: 100, width: 180, height: 40, scaleFactor: 2 }, normal, false, screens);
  assert.equal(expanded.scaleFactor, 1);
  assert.equal(expanded.x, 1140);
  assert.equal(expanded.x + expanded.width * expanded.scaleFactor, 1560);
});
