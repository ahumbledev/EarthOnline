import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGroundSurfaceSampler } from '../../src/exploration/footstep-surface.ts';

const material = name => Object.assign(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), { name });
function slab(name, { x = 0, z = 0, top = 0, width = 4, depth = 4, parent, metadata } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, .1, depth), material(name));
  mesh.position.set(x, top - .05, z);
  if (metadata) Object.assign(mesh.userData, metadata);
  parent?.add(mesh);
  return mesh;
}
const feet = (x = 0, y = .04, z = 0) => new THREE.Vector3(x, y, z);
const rectangle = (left, north, right, south) => [[left, north], [right, north], [right, south], [left, south]];
const woodland = () => ({ landcover: [{ kind: 'forest', polygons: [[rectangle(-10, -10, 10, 10), rectangle(-2, -2, 2, 2)]] }] });

test('actual ray hits distinguish five authored ground materials and keep unrecognised ground neutral', () => {
  const root = new THREE.Group();
  const names = ['weathered concrete pavement', 'geographic paths', 'meadow grass', 'pebble gravel', 'oak timber floor', 'unclassified surface'];
  names.forEach((name, index) => slab(name, { parent: root, x: index * 8 }));
  const sample = createGroundSurfaceSampler(root);
  assert.deepEqual(names.map((_, index) => sample(feet(index * 8))), ['concrete', 'dirt', 'grass', 'gravel', 'wood', 'concrete']);
});

test('the actual struck triangle selects its material slot and explicit mesh metadata wins', () => {
  const root = new THREE.Group();
  const box = slab('unused');
  // BoxGeometry uses +Y for material slot 2; naming another face must not override the floor.
  box.material = ['grass', 'gravel', 'timber', 'dirt', 'concrete', 'concrete'].map(material);
  root.add(box);
  assert.equal(createGroundSurfaceSampler(root)(feet()), 'wood');
  box.userData.footstepSurface = 'gravel';
  assert.equal(createGroundSurfaceSampler(root)(feet()), 'gravel');
  const unknown = slab('no recognised material', { x: 8, parent: root, metadata: { footstepSurface: 'wood' } });
  assert.equal(createGroundSurfaceSampler(root)(feet(8)), 'wood');
  assert.equal(unknown.userData.footstepSurface, 'wood');
});

test('an elevated bridge sounds like boards while the ground below keeps its own surface', () => {
  const root = new THREE.Group();
  slab('geographic paths', { parent: root });
  slab('bridge timber', { top: 3, parent: root });
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet(0, 3.04)), 'wood');
  assert.equal(sample(feet()), 'dirt', 'The bridge three metres overhead is not the walking surface');
  assert.equal(sample(feet(0, 4)), 'concrete', 'A surface beyond the short foot ray is not mistaken for support');
});

test('world transforms are applied before bounds filtering and ray intersection', () => {
  const root = new THREE.Group(), moved = new THREE.Group();
  moved.position.set(20, 3, -15); moved.rotation.y = .7; moved.scale.set(2, 1, .7); root.add(moved);
  slab('timber', { parent: moved });
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet(20, 3.04, -15)), 'wood');
  assert.equal(sample(feet()), 'concrete');
});

test('a close steep face cannot replace the horizontal support beneath the feet', () => {
  const root = new THREE.Group();
  slab('concrete', { parent: root });
  const steep = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material('wood'));
  steep.rotation.x = .2; steep.position.y = .1; root.add(steep);
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet()), 'concrete', 'The nearer wooden face has a nearly horizontal normal and is not walkable');
});

test('terrain reads the mapped forest with holes and defaults to grass outside source woodland', () => {
  const root = new THREE.Group(); slab('geographic terrain', { width: 30, depth: 30, parent: root });
  const region = woodland(), original = JSON.stringify(region);
  const sample = createGroundSurfaceSampler(root, region);
  assert.equal(sample(feet(5)), 'dirt');
  assert.equal(sample(feet(0)), 'grass', 'The courtyard hole is not forest merely because it lies in the outer ring');
  assert.equal(sample(feet(12)), 'grass');
  assert.equal(JSON.stringify(region), original, 'Sampling cannot edit source geometry');
});

test('wooden bridge geometry overrides mapped woodland and unknown surfaces use the geographic fallback', () => {
  const root = new THREE.Group();
  slab('geographic terrain', { width: 30, depth: 30, parent: root });
  slab('timber', { x: 5, top: 2, parent: root });
  const sample = createGroundSurfaceSampler(root, woodland());
  assert.equal(sample(feet(5, 2.04)), 'wood');
  assert.equal(sample(feet(5)), 'dirt');
  assert.equal(createGroundSurfaceSampler(new THREE.Group(), woodland())(feet(5)), 'dirt');
  assert.equal(createGroundSurfaceSampler(new THREE.Group())(feet()), 'concrete');
});

test('decorative tree bark and leaf cards are neither candidates nor raycast work', () => {
  const root = new THREE.Group(); slab('geographic paths', { parent: root });
  const tree = slab('oak bark', { top: .15, parent: root });
  const leaves = slab('grass foliage leaves', { top: .2, parent: root });
  for (const mesh of [tree, leaves]) mesh.raycast = () => assert.fail('Decorative materials must be filtered before raycast');
  assert.equal(createGroundSurfaceSampler(root)(feet()), 'dirt');
});

test('hidden ancestors and explicitly silent decorative subtrees never become supports', () => {
  for (const kind of ['hidden', 'silent']) {
    const root = new THREE.Group(), decorative = new THREE.Group();
    slab('geographic paths', { parent: root }); root.add(decorative);
    const deck = slab('timber', { top: .15, parent: decorative });
    deck.raycast = () => assert.fail(`${kind} subtree was raycast`);
    if (kind === 'hidden') decorative.visible = false; else decorative.userData.footstepSurface = 'silent';
    assert.equal(createGroundSurfaceSampler(root)(feet()), 'dirt');
  }
});

test('instanced ground applies per-instance translation to the support bounds', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(3, .1, 3);
  const instances = new THREE.InstancedMesh(geometry, material('timber'), 2);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, -.05, 0));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(20, 1.95, 0)); root.add(instances);
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet(10)), 'wood'); assert.equal(sample(feet(20, 2.04)), 'wood');
  assert.equal(sample(feet(0)), 'concrete');
});

test('visibility and silence changes on the owning root and ancestors retire cached supports immediately', () => {
  const root = new THREE.Group(), bridge = new THREE.Group(); root.add(bridge);
  slab('geographic paths', { parent: root }); slab('timber', { top: .15, parent: bridge });
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet()), 'wood');
  bridge.visible = false; assert.equal(sample(feet()), 'dirt');
  bridge.visible = true; assert.equal(sample(feet()), 'wood');
  bridge.userData.footstepSurface = 'silent'; assert.equal(sample(feet()), 'dirt');
  delete bridge.userData.footstepSurface;
  root.visible = false; assert.equal(sample(feet()), 'concrete');
  root.visible = true; root.userData.footstepSurface = 'silent'; assert.equal(sample(feet()), 'concrete');
  delete root.userData.footstepSurface; assert.equal(sample(feet()), 'wood');
});

test('the instance transform determines the actual hit normal so a near-vertical board is not a floor', () => {
  const root = new THREE.Group(); slab('geographic paths', { width: 20, parent: root });
  const geometry = new THREE.PlaneGeometry(2,2); geometry.rotateX(-Math.PI/2);
  const instances = new THREE.InstancedMesh(geometry, material('timber'), 2);
  instances.setMatrixAt(0, new THREE.Matrix4().makeRotationZ(1.4).setPosition(0,.1,0));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5,.1,0)); root.add(instances);
  const sample = createGroundSurfaceSampler(root);
  assert.equal(sample(feet()), 'dirt', 'The local +Y normal is nearly horizontal after this individual instance rotates');
  assert.equal(sample(feet(5,.14)), 'wood', 'An unrotated board from the same batch remains valid support');
});
