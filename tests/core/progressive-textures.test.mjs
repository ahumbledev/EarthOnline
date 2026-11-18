import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createProgressiveTextures, TEXTURE_BUDGETS } from '../../src/rendering/progressive-textures.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const bitmap = () => ({ width: 96, height: 96, closed: 0, close() { ++this.closed; } });
async function fixture(count = 1) {
  const preview = Array.from({ length: count }, bitmap);
  const hashes = Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, 'a'));
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: '2.0' }, extensionsUsed: ['KHR_texture_transform'], scene: 0,
    scenes: [{ nodes: Array.from({ length: count }, (_, i) => i) }],
    nodes: Array.from({ length: count }, (_, i) => ({ mesh: i, translation: [i * 100, 0, 0] })),
    buffers: [{ uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}`, byteLength: positions.byteLength }],
    bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: Array.from({ length: count }, (_, i) => ({ primitives: [{ attributes: { POSITION: 0 }, material: i }] })),
    materials: Array.from({ length: count }, (_, i) => ({ pbrMetallicRoughness: { baseColorTexture: {
      index: i, extensions: { KHR_texture_transform: { offset: [.2, .3], scale: [2, 3], rotation: .4 } },
    } } })),
    textures: Array.from({ length: count }, (_, i) => ({ source: i, sampler: 0 })),
    samplers: [{ wrapS: 33071, wrapT: 33648, magFilter: 9728 }],
    images: hashes.map((sha256, index) => ({ uri: `preview-${index}.png`, extras: { fullTexture: {
      sha256, bytes: 123, url: `/textures/stream/${sha256}.png`,
    } } })),
  };
  const loader = new GLTFLoader();
  loader.register(parser => {
    parser.loadBuffer = async () => positions.buffer;
    parser.loadImageSource = async index => new THREE.Texture(preview[index]);
    return { name: 'fixture-images-with-real-sampler-and-transform-parser' };
  });
  const gltf = await loader.parseAsync(JSON.stringify(json), '');
  return { gltf, preview, urls: json.images.map(image => image.extras.fullTexture.url) };
}
function network(decode = async () => bitmap()) {
  const requested = [];
  return { requested, decode, request: async url => {
    requested.push(url);
    return { ok: true, blob: async () => new Blob(['original-image']) };
  } };
}
function tiered(run, near = false) {
  run.gltf.parser.json.images.forEach((image, index) => {
    const full = image.extras.fullTexture;
    full.width = full.height = 2048;
    const variant = (size, offset) => {
      const sha256 = (index + offset).toString(16).padStart(64, 'b');
      return { url: `/textures/stream/${sha256}.webp`, sha256, bytes: size, width: size, height: size };
    };
    full.tiers = { smooth: variant(512, 100), standard: variant(1024, 200), high: { ...full } };
    if (near) run.gltf.scene.children[index].position.x = 0;
  });
  return run;
}
async function settleFrames(frames, stream) {
  for (let count = 0; count < 1000; ++count) {
    await tick();
    if (frames.length) frames.shift()();
    else if (!stream.report.active) return;
  }
  assert.fail('stream did not settle');
}

test('the actual GLTF preview scene is ready without fetching any full image', async () => {
  const { gltf } = await fixture(4);
  const io = network();
  const stream = createProgressiveTextures(gltf, io);
  await tick();
  assert.equal(stream.report.total, 4);
  assert.equal(io.requested.length, 0);
  stream.start();
  await stream.finished;
  assert.equal(io.requested.length, 4);
  assert.equal(stream.report.completed, 4);
  stream.dispose();
});

test('a delayed full image never blocks the parsed scene and concurrency is bounded', async () => {
  const { gltf } = await fixture(5);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const io = network(async () => { await gate; return bitmap(); });
  const stream = createProgressiveTextures(gltf, { ...io, concurrency: 2 });
  stream.update(new THREE.Vector3(400, 0, 0)); stream.start();
  await tick();
  assert.equal(gltf.scene.children.length, 5, 'scene is available while images remain delayed');
  assert.equal(io.requested.length, 2);
  assert.equal(stream.report.active, 2);
  const hashes = io.requested.map(url => url.match(/([a-f0-9]{64})\.png$/)[1]);
  assert.ok(hashes[0].endsWith('4'), 'closest material is streamed first');
  release();
  await stream.finished;
  assert.equal(stream.report.completed, 5);
  stream.dispose();
});

test('full image updates retain the authored UV transform, sampler and sRGB role', async () => {
  const { gltf, preview } = await fixture();
  const texture = gltf.scene.children[0].material.map;
  assert.deepEqual(texture.repeat.toArray(), [2, 3]);
  const original = { repeat: texture.repeat.toArray(), offset: texture.offset.toArray(), rotation: texture.rotation,
    wrapS: texture.wrapS, wrapT: texture.wrapT, magFilter: texture.magFilter, colorSpace: texture.colorSpace, flipY: texture.flipY };
  const full = bitmap(); full.width = full.height = 2048;
  const stream = createProgressiveTextures(gltf, network(async () => full));
  const version = texture.version;
  const source = texture.source;
  let released = 0;
  texture.addEventListener('dispose', () => { assert.equal(texture.source, source); ++released; });
  stream.start(); await stream.finished;
  assert.equal(texture.image, full);
  assert.equal(released, 1, 'immutable preview GPU storage must be released before resizing');
  assert.notEqual(texture.source, source, 'full dimensions get fresh GPU source storage');
  assert.ok(texture.version > version, 'already rendered map is invalidated for GPU upload');
  assert.deepEqual({ repeat: texture.repeat.toArray(), offset: texture.offset.toArray(), rotation: texture.rotation,
    wrapS: texture.wrapS, wrapT: texture.wrapT, magFilter: texture.magFilter, colorSpace: texture.colorSpace, flipY: texture.flipY }, original);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(preview[0].closed, 1);
  stream.dispose(); stream.dispose();
  assert.equal(full.closed, 1);
});

test('network errors retain usable previews and retry at most once', async () => {
  const { gltf, preview } = await fixture();
  let calls = 0;
  const stream = createProgressiveTextures(gltf, { request: async () => { ++calls; throw Error('offline'); } });
  stream.start(); await stream.finished;
  assert.equal(calls, 2); assert.equal(stream.report.failed, 1);
  assert.equal(gltf.scene.children[0].material.map.image, preview[0]);
  assert.equal(preview[0].closed, 0);
  stream.dispose();
});

test('dispose cancels requests and late decoded bitmaps cannot mutate a disposed model', async () => {
  const { gltf, preview } = await fixture();
  let release, requestSignal;
  const gate = new Promise(resolve => { release = resolve; });
  const full = bitmap();
  const stream = createProgressiveTextures(gltf, {
    request: async (_url, options) => { requestSignal = options.signal; return { ok: true, blob: async () => new Blob() }; },
    decode: async () => { await gate; return full; },
  });
  stream.start(); await tick(); stream.dispose();
  assert.equal(requestSignal.aborted, true);
  release(); await tick();
  assert.equal(full.closed, 1);
  assert.equal(preview[0].closed, 1);
  assert.equal(gltf.scene.children[0].material.map.image, preview[0]);
});

test('invalid external destinations are never fetched and an aborted owner never starts work', async () => {
  const { gltf } = await fixture();
  gltf.parser.json.images[0].extras.fullTexture.url = 'https://external.test/image.png';
  const io = network();
  const controller = new AbortController(); controller.abort();
  const stream = createProgressiveTextures(gltf, { ...io, signal: controller.signal });
  stream.start(); await stream.finished;
  assert.equal(io.requested.length, 0);
  assert.equal(stream.report.total, 0);
});

test('standard selects pre-resized delivery URLs and installs at most one image group per frame', async () => {
  const run = tiered(await fixture(4), true), frames = [], uploads = [], io = network();
  const stream = createProgressiveTextures(run.gltf, { ...io, schedule: callback => frames.push(callback), renderer: { initTexture(texture) { uploads.push(texture); } } });
  stream.start(); await tick();
  assert.equal(io.requested.length, 2);
  assert.ok(io.requested.every(url => url.endsWith('.webp')));
  assert.equal(uploads.length, 0, 'decode completion cannot mutate GPU bindings outside the frame budget');
  for (let count = 0; count < 100 && stream.report.completed < 4; ++count) {
    const before = stream.report.uploads;
    if (frames.length) frames.shift()();
    await tick();
    assert.ok(stream.report.uploads - before <= 1);
  }
  await stream.finished;
  assert.equal(stream.report.completed, 4); assert.equal(uploads.length, 4);
  assert.equal(run.preview[0].closed, 0, 'tiny preview remains available for eviction');
  stream.dispose(); assert.equal(run.preview[0].closed, 1);
});

test('normal image decoding is serial even when two network requests complete together', async () => {
  const run = tiered(await fixture(3), true);
  let concurrent = 0, greatest = 0;
  const stream = createProgressiveTextures(run.gltf, network(async () => {
    ++concurrent; greatest = Math.max(greatest, concurrent); await tick(); --concurrent; return bitmap();
  }));
  stream.start(); await stream.finished;
  assert.equal(greatest, 1); stream.dispose();
});

test('nearby selection defers other streets and releases old resident images back to previews after travel', async () => {
  const run = tiered(await fixture(3)), io = network();
  const stream = createProgressiveTextures(run.gltf, { ...io, quality: 'smooth' });
  stream.update(new THREE.Vector3()); stream.start(); await stream.finished;
  assert.equal(io.requested.length, 1); assert.equal(stream.report.deferred, 2);
  const oldFull = run.gltf.scene.children[0].material.map.image;
  stream.update(new THREE.Vector3(200, 0, 0));
  for (let i = 0; i < 100 && (stream.report.active || stream.report.completed !== 1 || io.requested.length < 2); ++i) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(io.requested.length, 2);
  assert.equal(run.gltf.scene.children[0].material.map.image, run.preview[0]);
  assert.equal(oldFull.closed, 1);
  assert.ok(stream.report.residentBytes <= TEXTURE_BUDGETS.smooth.residentBytes);
  stream.dispose();
});

test('a smooth city resident budget never downloads every nearby image merely because it is queued', async () => {
  const run = tiered(await fixture(60), true), io = network();
  const stream = createProgressiveTextures(run.gltf, { ...io, quality: 'smooth' });
  stream.start(); await stream.finished;
  assert.ok(io.requested.length < 60 && io.requested.length > 0);
  assert.ok(stream.report.residentBytes <= TEXTURE_BUDGETS.smooth.residentBytes);
  assert.ok(stream.report.deferred > 0); stream.dispose();
});

test('pausing a cached city lets bounded in-flight requests finish but starts no more until reactivated', async () => {
  const run = tiered(await fixture(4), true), io = network(), frames = [];
  const stream = createProgressiveTextures(run.gltf, { ...io, schedule: callback => frames.push(callback) });
  stream.start(); await tick(); stream.setActive(false);
  await settleFrames(frames, stream);
  assert.equal(io.requested.length, 2);
  stream.setActive(true); await settleFrames(frames, stream); await stream.finished;
  assert.equal(io.requested.length, 4); stream.dispose();
});

test('switching quality fences an old high-resolution decoder before the smaller map is installed', async () => {
  const run = tiered(await fixture()), old = bitmap(), next = bitmap();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = [];
  const stream = createProgressiveTextures(run.gltf, { quality: 'high', request: async url => {
    requested.push(url); return { ok: true, blob: async () => new Blob([url]) };
  }, decode: async blob => { if ((await blob.text()).endsWith('.png')) { await gate; return old; } return next; } });
  stream.start(); await tick(); stream.setQuality('smooth'); release();
  await stream.finished;
  assert.equal(run.gltf.scene.children[0].material.map.image, next);
  assert.equal(old.closed, 1);
  assert.equal(requested.length, 2); assert.ok(requested[1].endsWith('.webp'));
  assert.equal(stream.report.quality, 'smooth'); stream.dispose();
});

test('GPU upload failure retains a usable preview and finishes after one bounded retry', async () => {
  const run = tiered(await fixture()), io = network();
  let uploads = 0;
  const stream = createProgressiveTextures(run.gltf, { ...io, renderer: { initTexture() { ++uploads; throw Error('GPU unavailable'); } } });
  stream.start(); await stream.finished;
  assert.equal(uploads, 2); assert.equal(stream.report.failed, 1);
  assert.equal(run.gltf.scene.children[0].material.map.image, run.preview[0]);
  assert.equal(run.preview[0].closed, 0); stream.dispose();
});

test('switching down from an uploaded high tier releases it and restores a lower tier without changing authored transforms', async () => {
  const run = tiered(await fixture()), frames = [], requested = [], images = [];
  const texture = run.gltf.scene.children[0].material.map;
  const original = { repeat: texture.repeat.toArray(), offset: texture.offset.toArray(), rotation: texture.rotation, colorSpace: texture.colorSpace };
  const stream = createProgressiveTextures(run.gltf, { quality: 'high', schedule: callback => frames.push(callback),
    request: async url => { requested.push(url); return { ok: true, blob: async () => new Blob() }; },
    decode: async () => { const image = bitmap(); images.push(image); return image; } });
  stream.start(); await settleFrames(frames, stream); await stream.finished;
  assert.equal(texture.image, images[0]);
  stream.setQuality('smooth'); await settleFrames(frames, stream);
  assert.equal(images[0].closed, 1); assert.equal(texture.image, images[1]);
  assert.equal(requested.length, 2);
  assert.deepEqual({ repeat: texture.repeat.toArray(), offset: texture.offset.toArray(), rotation: texture.rotation, colorSpace: texture.colorSpace }, original);
  assert.ok(stream.report.residentBytes <= TEXTURE_BUDGETS.smooth.residentBytes); stream.dispose();
});

test('material replacement releases unused resident maps while the player stands still', async () => {
  const run = tiered(await fixture()), frames = [], io = network();
  const stream = createProgressiveTextures(run.gltf, { ...io, schedule: callback => frames.push(callback) });
  stream.start(); await settleFrames(frames, stream); await stream.finished;
  const texture = run.gltf.scene.children[0].material.map, full = texture.image;
  run.gltf.scene.children[0].material.map = new THREE.Texture();
  stream.refresh(); await settleFrames(frames, stream);
  assert.equal(full.closed, 1, 'replaced authored maps cannot keep their full image resident');
  assert.equal(texture.image, run.preview[0]);
  assert.equal(stream.report.residentBytes, 0);
  assert.equal(stream.report.deferred, 1);
  stream.dispose();
});

test('refresh cancels an unused pending map without treating culling as a network failure', async () => {
  const run = tiered(await fixture()), frames = [];
  const material = run.gltf.scene.children[0].material, original = material.map;
  let requests = 0, aborted = 0;
  const stream = createProgressiveTextures(run.gltf, { schedule: callback => frames.push(callback), decode: async () => bitmap(),
    request: async (_url, { signal }) => {
      if (++requests <= 2) return await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { ++aborted; reject(Error('culled')); }, { once: true });
      });
      return { ok: true, blob: async () => new Blob() };
    } });
  stream.start(); await tick();
  for (let count = 0; count < 2; ++count) {
    material.map = new THREE.Texture(); stream.refresh(); await settleFrames(frames, stream);
    assert.equal(stream.report.failed, 0);
    material.map = original; stream.refresh(); await tick();
  }
  await settleFrames(frames, stream);
  assert.equal(aborted, 2); assert.equal(requests, 3); assert.equal(stream.report.completed, 1);
  stream.dispose();
});

test('a transformed shared-image clone still in use remains resident when its associated map is replaced', async () => {
  const run = tiered(await fixture()), original = run.gltf.scene.children[0].material.map;
  const clone = original.clone(); clone.repeat.set(5, 6); clone.offset.set(.4, .7);
  const cloneMaterial = new THREE.MeshStandardMaterial({ map: clone });
  run.gltf.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(), cloneMaterial));
  const frames = [], io = network();
  const stream = createProgressiveTextures(run.gltf, { ...io, schedule: callback => frames.push(callback) });
  stream.start(); await settleFrames(frames, stream); await stream.finished;
  const full = clone.image;
  run.gltf.scene.children[0].material.map = new THREE.Texture();
  stream.refresh(); await settleFrames(frames, stream);
  assert.equal(clone.image, full); assert.equal(full.closed, 0);
  assert.ok(stream.report.residentBytes > 0);
  assert.deepEqual(clone.repeat.toArray(), [5, 6]);
  assert.deepEqual(clone.offset.toArray(), [.4, .7]);
  cloneMaterial.map = new THREE.Texture(); stream.refresh(); await settleFrames(frames, stream);
  assert.equal(full.closed, 1); assert.equal(stream.report.residentBytes, 0);
  stream.dispose();
});
