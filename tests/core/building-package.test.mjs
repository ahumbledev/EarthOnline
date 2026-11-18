import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectUgcGlb, UGC_PARCELS, validateUgcPackage } from '../../server/buildings/validate.mjs';
import { createUgcFixture, makeUgcGlb } from './fixtures/building.mjs';

const parcel = UGC_PARCELS[0];
const codeIs = code => error => error.status === 400 && error.code === code;


test('valid textured GLB and editable texture files satisfy the building package format (source header stub only)', async () => {
  const { manifest, report } = await validateUgcPackage(createUgcFixture(), parcel.id);
  assert.equal(manifest.target.parcelId, parcel.id);
  assert.equal(report.metrics.render.triangles, 12);
  assert.equal(report.metrics.render.materials, 1);
  assert.ok(report.metrics.render.textureResidentEstimateBytes > 0);
  assert.deepEqual(report.metrics.render.bounds, { min: [0, 0, 0], max: [2, 2, 2] });
  assert.equal(report.metrics.collision.triangles, 12);
});

test('GLB inspection applies nested node transforms to actual local geometry', () => {
  const nested = [{ translation: [2, 1, 3], children: [1] }, { translation: [1, 2, 1], mesh: 0 }];
  const result = inspectUgcGlb(makeUgcGlb({ nodes: nested }), parcel);
  assert.deepEqual(result.bounds, { min: [3, 3, 4], max: [5, 5, 6] });
  assert.throws(() => inspectUgcGlb(makeUgcGlb({ nodes: [{ translation: [9, 0, 0], children: [1] }, { mesh: 0 }] }), parcel), codeIs('ugc_outside_parcel'));
});

test('GLB matrix transforms are checked and singular transforms are rejected', () => {
  const transform = [1,0,0,0, 0,1,0,0, 0,0,1,0, 3,2,4,1];
  assert.deepEqual(inspectUgcGlb(makeUgcGlb({ nodes: [{ matrix: transform, mesh: 0 }] }), parcel).bounds,
    { min: [3, 2, 4], max: [5, 4, 6] });
  assert.throws(() => inspectUgcGlb(makeUgcGlb({ nodes: [{ scale: [0, 1, 1], mesh: 0 }] }), parcel), /节点变换不可用/);
});

test('textured visible geometry requires matching UV coordinates', () => {
  const noUv = makeUgcGlb({ mutateJson: gltf => { delete gltf.meshes[0].primitives[0].attributes.TEXCOORD_0; } });
  assert.throws(() => inspectUgcGlb(noUv, parcel), /accessor/);
  const mismatchedUv = makeUgcGlb({ mutateJson: gltf => { gltf.accessors[2].count = 7; } });
  assert.throws(() => inspectUgcGlb(mismatchedUv, parcel), /UV 数量/);
});

test('visible GLB must carry an actual base-color texture rather than plain color only', () => {
  const colorOnly = makeUgcGlb({ mutateJson: gltf => { delete gltf.materials[0].pbrMetallicRoughness.baseColorTexture; } });
  assert.throws(() => inspectUgcGlb(colorOnly, parcel), codeIs('ugc_material_missing'));
});

test('collision budget counts actual indexed triangles', () => {
  const allowedIndices = Array.from({ length: 5000 * 3 }, (_, index) => index % 3);
  assert.equal(inspectUgcGlb(makeUgcGlb({ collision: true, indices: allowedIndices }), parcel, true).triangles, 5000);
  const tooMany = [...allowedIndices, 0, 1, 2];
  assert.throws(() => inspectUgcGlb(makeUgcGlb({ collision: true, indices: tooMany }), parcel, true), codeIs('ugc_geometry_budget'));
});

test('package identity and parcel contract version must match the requested plot', async () => {
  await assert.rejects(validateUgcPackage(createUgcFixture(), UGC_PARCELS[1].id), codeIs('ugc_target_mismatch'));
  await assert.rejects(validateUgcPackage(createUgcFixture({ mutateManifest: manifest => { manifest.target.parcelId = UGC_PARCELS[1].id; } }), parcel.id), codeIs('ugc_target_mismatch'));
  await assert.rejects(validateUgcPackage(createUgcFixture({ mutateManifest: manifest => { manifest.target.parcelRevision = '0.0.0'; } }), parcel.id), codeIs('ugc_target_mismatch'));
});

test('missing editable textures, previews and LFS pointer source fail package checks', async () => {
  const noTextures = createUgcFixture(); noTextures.delete('textures/base-color.png');
  await assert.rejects(validateUgcPackage(noTextures, parcel.id), codeIs('ugc_material_missing'));
  const noPreview = createUgcFixture(); noPreview.delete('previews/front-day.png');
  await assert.rejects(validateUgcPackage(noPreview, parcel.id), /预览不存在/);
  const lfsSource = createUgcFixture(); lfsSource.set('source/building.blend', Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:stub\nsize 4096\n'));
  await assert.rejects(validateUgcPackage(lfsSource, parcel.id), /不能使用 LFS 指针/);
});
