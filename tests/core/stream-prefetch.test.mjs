import test from 'node:test';
import assert from 'node:assert/strict';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createStreamPrefetch } from '../../src/world/stream-prefetch.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const model = () => ({ asset: { version: '2.0' }, buffers: [{ uri: 'triangle.bin', byteLength: 36 }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0,0,0], max: [1,1,0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 });
const triangle = new Float32Array([0,0,0,1,0,0,0,1,0]);

test('prefetched external buffers are consumed by the real GLTFLoader without repeat network requests and release on the last lease', async () => {
  const calls = [], source = model();
  const pool = createStreamPrefetch({ fetch: async url => { calls.push(url); return url.endsWith('.gltf') ? Response.json(source) : new Response(triangle); } });
  const controller = new AbortController();
  const [a,b] = await Promise.all([pool.acquire('https://assets.test/cell/model.gltf',false,controller.signal),pool.acquire('https://assets.test/cell/model.gltf',false,controller.signal)]);
  assert.deepEqual(calls,['https://assets.test/cell/model.gltf','https://assets.test/cell/triangle.bin']);
  const uri = JSON.parse(a.data).buffers[0].uri;
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type=type;Object.assign(this,data); } };
  const gltf = await new GLTFLoader().parseAsync(a.data,a.path);
  assert.equal(gltf.scene.children[0].geometry.attributes.position.count,3);
  a.release(); assert.equal(pool.snapshot().models,1); assert.equal((await fetch(uri)).status,200);
  b.release(); await tick(); assert.equal(pool.snapshot().models,0); assert.equal(pool.snapshot().byteEntries,0);
  await assert.rejects(fetch(uri)); gltf.scene.children[0].geometry.dispose(); gltf.scene.children[0].material.dispose(); pool.dispose();
});

test('collision prefetch does not download images; embedded GLB buffers are retained until parsing finishes', async () => {
  const source=model();delete source.buffers[0].uri;source.images=[{uri:'expensive.png'}];
  let json=new TextEncoder().encode(JSON.stringify(source));const length=Math.ceil(json.length/4)*4, total=12+8+length+8+triangle.byteLength;
  const glb=new ArrayBuffer(total),view=new DataView(glb);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,length,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(glb,20,length).fill(32);new Uint8Array(glb,20,json.length).set(json);
  view.setUint32(20+length,triangle.byteLength,true);view.setUint32(24+length,0x004e4942,true);new Uint8Array(glb,28+length).set(new Uint8Array(triangle.buffer));
  const calls=[],pool=createStreamPrefetch({fetch:async url=>{calls.push(url);return new Response(glb);}}),controller=new AbortController();
  const prepared=await pool.acquire('https://assets.test/model.glb',true,controller.signal);
  // Nothing the collision loader reads lies outside the file: it receives the downloaded bytes untouched.
  assert.equal(calls.length,1); assert.ok(prepared.data instanceof ArrayBuffer); assert.equal(prepared.data.byteLength,total);
  globalThis.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type=type;Object.assign(this,data); } };
  const gltf=await new GLTFLoader().parseAsync(prepared.data,prepared.path);
  assert.equal(gltf.scene.children[0].geometry.attributes.position.count,3);
  gltf.scene.children[0].geometry.dispose(); gltf.scene.children[0].material.dispose();
  // The display loader does need the external image, so its copy is rewritten around object URLs.
  const visual=await pool.acquire('https://assets.test/model.glb',false,controller.signal);
  assert.equal(calls.length,2); const parsed=JSON.parse(visual.data);assert.match(parsed.images[0].uri,/^blob:/);
  assert.equal((await (await fetch(parsed.buffers[0].uri)).arrayBuffer()).byteLength,36);
  visual.release();prepared.release();await tick();assert.equal(pool.snapshot().byteEntries,0);pool.dispose();
});

test('network capacity reserves a collision request and aborting shared consumers does not cancel another owner', async () => {
  const gates=[],calls=[],pool=createStreamPrefetch({concurrency:10,fetch:async url=>{calls.push(url);const gate=deferred();gates.push(gate);await gate.promise;return Response.json({asset:{version:'2.0'}});}});
  const controllers=Array.from({length:13},()=>new AbortController());
  const pending=controllers.slice(0,12).map((controller,i)=>pool.acquire(`https://assets.test/${i}.gltf`,false,controller.signal).catch(error=>error));
  await tick();assert.equal(calls.length,9,'ordinary visual requests leave the tenth socket slot available');
  pending.push(pool.acquire('https://assets.test/floor.gltf',true,controllers[12].signal).catch(error=>error));
  await tick();assert.equal(calls.length,10);assert.ok(calls.at(-1).includes('floor'));
  for(const controller of controllers)controller.abort();for(const gate of gates)gate.resolve();await Promise.all(pending);await tick();
  assert.equal(pool.snapshot().active,0);assert.equal(pool.snapshot().queued,0);assert.equal(pool.snapshot().models,0);pool.dispose();
  const gate=deferred(),shared=createStreamPrefetch({fetch:async()=>{await gate.promise;return Response.json({asset:{version:'2.0'}});}}),a=new AbortController(),b=new AbortController();
  const first=shared.acquire('https://assets.test/a.gltf',false,a.signal).catch(error=>error),second=shared.acquire('https://assets.test/a.gltf',false,b.signal);
  a.abort();gate.resolve();assert.equal((await first).name,'AbortError');const result=await second;result.release();await tick();assert.equal(shared.snapshot().models,0);shared.dispose();
});

test('collision promotes a shared queued visual byte request into the reserved network slot',async()=>{
 const calls=[],gates=[],controller=new AbortController();
 const pool=createStreamPrefetch({fetch:async url=>{
  calls.push(url);
  if(url.endsWith('.bin')){const gate=deferred();gates.push(gate);await gate.promise;return new Response(new Uint8Array([0]));}
  return Response.json(url.endsWith('shared.gltf')?{asset:{version:'2.0'}}:{asset:{version:'2.0'},buffers:[{uri:url.replace('.gltf','.bin'),byteLength:1}]});
 }});
 const held=Array.from({length:9},(_,index)=>pool.acquire(`https://assets.test/${index}.gltf`,false,controller.signal).catch(error=>error));
 await tick();await tick();assert.equal(pool.snapshot().active,9);
 const visual=pool.acquire('https://assets.test/shared.gltf',false,controller.signal);await tick();
 assert.equal(calls.includes('https://assets.test/shared.gltf'),false,'the visual request initially waits behind the saturated visual capacity');
 const collision=pool.acquire('https://assets.test/shared.gltf',true,controller.signal);await tick();
 assert.equal(calls.filter(url=>url.endsWith('shared.gltf')).length,1,'the same queued request is promoted, not duplicated');
 const [a,b]=await Promise.all([visual,collision]);a.release();b.release();
 controller.abort();for(const gate of gates)gate.resolve();await Promise.all(held);await tick();
 assert.equal(pool.snapshot().active,0);assert.equal(pool.snapshot().models,0);pool.dispose();
});
