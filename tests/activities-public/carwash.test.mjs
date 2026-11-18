import test from 'node:test';
import assert from 'node:assert/strict';
import {PIXEL_DIRTY,WASHER_ORDER,NOZZLE_ORDER,LANCE_ORDER,angleDensity,combinedNozzle,countDirty,distanceFade,evaluateCurve,texelRate,partProgress,cleanWeight,totalProgress} from '../../src/activities-public/carwash/rules.ts';
import {generateDirt} from '../../src/activities-public/carwash/dirt.ts';
import {rasterizeUV,dilate} from '../../src/activities-public/carwash/bake.ts';
import {countBits} from '../../src/activities-public/carwash/gpu.ts';
test('a light washer handles dust while pressure and turbo improve hard dirt',()=>{
  const at=(nozzle,pressure,layer)=>texelRate(combinedNozzle(nozzle,pressure,false),layer,1.2,0,0,1);
  assert.ok(at('fan',false,0)>0);
  assert.ok(at('fan',false,1)<at('fan',true,1)/10,'light washer barely touches mud');
  assert.equal(at('fan',false,2),0,'light 25° has no stubborn power');
  assert.ok(at('turbo',true,2)>at('fan',true,2),'turbo beats the fan on grease');
  assert.ok(at('jet',true,1)>0&&at('turbo',true,1)>0);
});
test('range, spray footprint and surface facing bound removal',()=>{
  const c=combinedNozzle('jet',false,false);
  assert.equal(distanceFade(c,0),1);assert.equal(distanceFade(c,c.range*.5),1);assert.ok(distanceFade(c,c.range*.9)<distanceFade(c,c.range*.5));assert.equal(distanceFade(c,c.range+.01),0);
  assert.equal(evaluateCurve([{time:0,value:2,inSlope:0,outSlope:0}],5),2);
  let mean=0;for(let i=0;i<2000;i++)mean+=angleDensity((i+.5)/2000)/2000;assert.ok(Math.abs(mean-1)<.01,'ray distribution keeps total power');
  assert.equal(angleDensity(0),angleDensity(1),'uniform footprint avoids concentrated striping');
  const fan=combinedNozzle('fan',false,false);
  assert.ok(texelRate(fan,0,.8,0,0,1)>texelRate(fan,0,2.4,0,0,1),'closer is stronger');
  assert.equal(texelRate(fan,0,1,0,.2,1),0,'outside the thin fan');assert.equal(texelRate(fan,0,1,0,0,0),0,'back face');
  assert.equal(texelRate(fan,0,fan.range+.1,0,0,1),0);
});
test('part and total progress use the native formulas',()=>{
  assert.equal(partProgress(1000,100,.1),1);assert.ok(Math.abs(partProgress(1000,550,.1)-.5)<1e-12);assert.equal(partProgress(0,0,.2),1);
  assert.equal(cleanWeight(1000,.2),800);
  assert.equal(totalProgress([{progress:1,weight:900},{progress:0,weight:100}]),.9);assert.equal(totalProgress([{progress:0,weight:0}]),1);
  const state=new Float32Array([.3,0,0,0, .2,.2,.2,0, 0,0,.26,0, .9,0,0,0]),partOf=Uint8Array.from([0,0,1,129]);
  assert.deepEqual([...countDirty(state,partOf,2)],[1,1]);assert.equal(PIXEL_DIRTY,.25);
  const bits=new Uint8Array(4*32);bits[0]=0b101;assert.deepEqual([...countBits(bits,Uint8Array.from({length:32*32},(_,i)=>i%32===2?1:0),32,2)],[1,1]);
});
test('dirt sits where it does on real cars and repeats for a seed',()=>{
  // Six texels: roof, door (side, mid height), sill behind the front wheel, front hubcap, rear hubcap, rear bumper low.
  const pts=[[0,1.4,0,0,1,0,0],[.9,.9,.3,1,0,0,1],[.9,.25,.6,1,0,0,1],[.8,.3,1.3,1,0,0,2],[.8,.3,-1.3,1,0,0,3],[0,.3,-2.1,0,0,-1,0]];
  const size=4,position=new Float32Array(size*size*4),normal=new Float32Array(size*size*4),partOf=new Uint8Array(size*size).fill(255);
  pts.forEach(([x,y,z,nx,ny,nz,part],i)=>{position.set([x,y,z,1],i*4);normal.set([nx,ny,nz,1],i*4);partOf[i]=part;});
  const input={size,position,normal,partOf,kinds:['body','door','hubcap','hubcap'],access:new Uint8Array(4).fill(220),accessSize:2,dimensions:[1.8,1.45,4.4],wheels:[{x:.8,y:.31,z:1.3,radius:.31},{x:.8,y:.31,z:-1.3,radius:.31}]};
  const dirt=generateDirt(input,{dust:1,mud:1,grease:1,lowDust:.5},7),at=(i,c)=>dirt[i*4+c];
  assert.ok(at(0,0)>at(1,0),'dust thicker on the roof than on the door');
  assert.ok(at(2,1)>at(1,1)&&at(1,1)<.2,'mud low behind the wheel, little at door-handle height');assert.ok(at(5,1)>.3,'mud splashed up the back');
  assert.ok(at(3,2)>at(4,2),'front rim carries more brake dust');
  assert.ok(dirt.every((v,i)=>i%4===3||(v>=0&&v<=1)));
  assert.deepEqual(generateDirt(input,{dust:1,mud:1,grease:1,lowDust:.5},7),dirt);
  const clean=generateDirt(input,{dust:1,mud:0,grease:0,lowDust:0},7);assert.ok(clean.every((v,i)=>i%4!==1&&i%4!==2||v===0));
});
test('the wash map is unwrapped from the car itself and seams are padded',()=>{
  const mesh={positions:[0,0,0,1,0,0,1,1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1,0,0,1],uvs:[.25,.25,.75,.25,.75,.75,.25,.75],indices:[0,1,2,0,2,3]};
  const baked=rasterizeUV([mesh],16);const k=(8*16+8)*4;
  assert.equal(baked.normal[k+3],1);assert.ok(Math.abs(baked.position[k]-((8.5/16-.25)/.5))<1e-6);assert.equal(baked.face[8*16+8]>=0,true);
  dilate(baked,2);const g=(8*16+2)*4;assert.equal(baked.normal[g+3],.5);assert.equal(baked.position[g+3],1);assert.equal(baked.normal[(8*16)*4+3],0);
});
test('all nozzle, washer and lance combinations stay finite and preserve range ordering',()=>{
  for(const washer of WASHER_ORDER)for(const nozzle of NOZZLE_ORDER)for(const lance of LANCE_ORDER){
    const c=combinedNozzle(nozzle,washer,lance);assert.ok([c.horizontal,c.vertical,c.range,c.power,...c.tiers].every(Number.isFinite));
    assert.ok(c.range>0&&c.power>0&&c.tiers.every(value=>value>=0));
  }
  assert.ok(combinedNozzle('wide','basic','stubby').horizontal>combinedNozzle('fan','basic','stubby').horizontal);
  assert.ok(combinedNozzle('fan','basic','xlong').range>combinedNozzle('fan','basic','extension').range);
});
