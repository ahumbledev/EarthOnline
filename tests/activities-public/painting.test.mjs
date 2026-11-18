import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDrawing, serializeDrawing, MAX_ARTWORK_CHARS, sprayDots, sprayTicks, steadyPoint} from '../../src/activities-public/painting/drawing.ts';

const stroke = {color:'#357fa6',width:40,points:[[.3,.4],[.6,.7]]};
const drawing = () => ({version:1,aspect:.7,strokes:[structuredClone(stroke)]});

test('existing item drawings remain readable without a tool or aspect field', () => {
  const legacy={version:1,strokes:[stroke]};assert.deepEqual(parseDrawing(JSON.stringify(legacy)),legacy);
});
test('all three tool strokes round-trip with deterministic spray metadata', () => {
  for(const tool of ['brush','steady','spray']){const value=drawing();value.strokes[0]={...stroke,tool,...(tool==='spray'?{seed:582550}:{})};assert.deepEqual(parseDrawing(JSON.stringify(value)),value);}
});
test('malformed tools, seeds, coordinates and canvas sizes are rejected', () => {
  for(const change of [{tool:'eraser'},{tool:'spray'},{tool:'spray',seed:-1},{tool:'spray',seed:1.5},{points:[[1.1,.2]]},{points:[null]},{width:0}]){const value=drawing();Object.assign(value.strokes[0],change);assert.throws(()=>parseDrawing(JSON.stringify(value)));}
  for(const aspect of [0,5,'1'])assert.throws(()=>parseDrawing(JSON.stringify({...drawing(),aspect})));
  assert.throws(()=>parseDrawing('null'));assert.throws(()=>parseDrawing('{broken'));
});
test('drawing budgets bound stored strokes and points', () => {
  assert.throws(()=>parseDrawing(JSON.stringify({version:1,strokes:Array.from({length:1001},()=>stroke)})));
  assert.throws(()=>parseDrawing(JSON.stringify({version:1,strokes:[{...stroke,points:Array.from({length:100001},()=>[.5,.5])}]})));
});
test('spray replay is identical after save/reload and different stamps remain distinct', () => {
  const spray={...stroke,tool:'spray',seed:1254};const replay=parseDrawing(JSON.stringify({version:1,strokes:[spray]})).strokes[0];
  assert.deepEqual(sprayDots(spray,42),sprayDots(replay,42));assert.notDeepEqual(sprayDots(spray,41),sprayDots(spray,42));assert.notDeepEqual(sprayDots(spray,42),sprayDots({...spray,seed:1255},42));
  for(const [x,y]of sprayDots(spray,42))assert.ok(x*x+y*y<=400+1e-9);
});
test('spray sampling produces the same one-second work at 30, 60 and 120 FPS', () => {
  for(const fps of [30,60,120]){let total=0,remainder=0;for(let frame=0;frame<fps;frame++){const next=sprayTicks(1/fps,remainder);total+=next.count;remainder=next.remainder;}assert.equal(total,60);assert.ok(remainder<1e-8);}
  assert.ok(sprayTicks(60,0).count<=6,'returning from a hidden tab cannot create a long spray burst');
});
test('steady input smooths a jump consistently across frame rates', () => {
  const results=[30,60,120].map(fps=>{let point=[0,0];for(let frame=0;frame<fps;frame++)point=steadyPoint(point,[1,.5],1/fps);return point;});
  assert.ok(results[0][0]<1&&results[0][0]>.99);assert.ok(Math.abs(results[0][0]-results[2][0])<1e-10);assert.deepEqual(steadyPoint([.2,.3],[1,1],0),[.2,.3]);
});
