import { UGC_DISTRICT_ID, UGC_PARCELS, UGC_PARCEL_REVISION } from '../../../server/buildings/parcels.mjs';

/** Valid 1x1 RGBA PNG, generated once with sharp and embedded in each GLB. */
export const UGC_FIXTURE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGPYkqLxHwAFUAJAbS/n8AAAAABJRU5ErkJggg==', 'base64');

/** This is intentionally ONLY a header-check stub, not an editable Blender model.
 * These automated protocol tests never claim Blender reopen/export acceptance. */
export const UGC_FIXTURE_SOURCE_STUB = Buffer.from('BLENDER-v500TEST_HEADER_ONLY_NOT_A_REAL_BLEND');

const cubePositions = [0,0,0, 2,0,0, 0,2,0, 2,2,0, 0,0,2, 2,0,2, 0,2,2, 2,2,2];
const cubeIndices = [0,2,1, 1,2,3, 4,5,6, 5,7,6, 0,4,2, 2,4,6, 1,3,5, 3,7,5, 0,1,4, 1,5,4, 2,6,3, 3,6,7];

/** A real GLB 2.0 with float geometry/UV data and an embedded PNG color map.
 * mutateJson/mutateBinary are for constructing adversarial protocol fixtures. */
export function makeUgcGlb({ collision = false, positions = cubePositions, indices = cubeIndices,
  nodes = [{ mesh: 0 }], sceneNodes = [0], mutateJson, mutateBinary } = {}) {
  const parts = [], views = [];
  let length = 0;
  const add = (bytes, target) => {
    const view = { buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) };
    views.push(view); parts.push(bytes); length += bytes.length;
    const padding = (4 - length % 4) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); length += padding; }
    return views.length - 1;
  };
  const count = positions.length / 3;
  const positionView = add(Buffer.from(new Float32Array(positions).buffer), 34962);
  const normals = Array.from({ length: count }, () => [0, 1, 0]).flat();
  const normalView = add(Buffer.from(new Float32Array(normals).buffer), 34962);
  const uv = Array.from({ length: count }, (_, index) => [index % 2, (index >> 1) % 2]).flat();
  const uvView = add(Buffer.from(new Float32Array(uv).buffer), 34962);
  const indexView = add(Buffer.from(new Uint16Array(indices).buffer), 34963);
  const imageView = collision ? undefined : add(UGC_FIXTURE_PNG);
  const gltf = {
    asset: { version: '2.0', generator: 'Building format fixture' },
    scene: 0, scenes: [{ nodes: sceneNodes }], nodes,
    buffers: [{ byteLength: length }], bufferViews: views,
    accessors: [
      { bufferView: positionView, componentType: 5126, count, type: 'VEC3', min: [0, 0, 0], max: [2, 2, 2] },
      { bufferView: normalView, componentType: 5126, count, type: 'VEC3' },
      { bufferView: uvView, componentType: 5126, count, type: 'VEC2' },
      { bufferView: indexView, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, ...(collision ? {} : { TEXCOORD_0: 2 }) }, indices: 3, ...(!collision ? { material: 0 } : {}) }] }],
    ...(!collision ? {
      images: [{ bufferView: imageView, mimeType: 'image/png' }],
      textures: [{ source: 0 }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: .8 } }],
    } : {}),
  };
  const binary = Buffer.concat(parts);
  mutateJson?.(gltf);
  mutateBinary?.(binary, gltf);
  const rawJson = Buffer.from(JSON.stringify(gltf));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 32)]);
  const bytes = Buffer.alloc(12 + 8 + json.length + 8 + binary.length);
  bytes.write('glTF', 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(bytes, 28 + json.length);
  return bytes;
}

export function createUgcFixture({ parcelId = UGC_PARCELS[0].id, revision = '1.0.0', render, collision, mutateManifest } = {}) {
  const parcel = UGC_PARCELS.find(candidate => candidate.id === parcelId);
  if (!parcel) throw new Error('Unknown test parcel');
  const manifest = {
    schemaVersion: 'city.building.v1', buildingId: parcel.buildingId, slotId: 'shell', revision,
    name: 'Protocol fixture building',
    target: { districtId: UGC_DISTRICT_ID, parcelId, parcelRevision: UGC_PARCEL_REVISION },
    authors: [{ displayName: 'Automated protocol fixture' }],
    coordinates: { units: 'metres', gameUp: '+Y', origin: 'parcel-local-origin' },
    files: { source: 'source/building.blend', render: 'runtime/shell.glb', collision: 'runtime/collision.glb', provenance: 'provenance.json' },
    dependencies: [], previews: ['previews/front-day.png'],
  };
  mutateManifest?.(manifest);
  return new Map([
    ['manifest.json', Buffer.from(JSON.stringify(manifest))],
    ['source/building.blend', Buffer.from(UGC_FIXTURE_SOURCE_STUB)],
    ['runtime/shell.glb', render ?? makeUgcGlb()],
    ['runtime/collision.glb', collision ?? makeUgcGlb({ collision: true })],
    ['textures/base-color.png', Buffer.from(UGC_FIXTURE_PNG)],
    ['previews/front-day.png', Buffer.from(UGC_FIXTURE_PNG)],
    ['provenance.json', Buffer.from(JSON.stringify({ origin: 'automated fixture', license: 'test-only', sourceIsHeaderStub: true }))],
    ['README.md', Buffer.from('Protocol test fixture. The BLENDER source is a header stub, not an editable asset or Blender acceptance evidence.\n')],
  ]);
}
