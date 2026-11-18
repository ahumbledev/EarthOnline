import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { shareSkinnedBounds } from '../../src/avatar/skinned-bounds.ts';

function character(geometry) {
  const root = new THREE.Group(), hip = new THREE.Bone(), head = new THREE.Bone();
  head.position.y = 1; hip.add(head); root.add(hip);
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  root.add(mesh); mesh.bind(new THREE.Skeleton([hip, head]));
  return { root, mesh };
}
function body() {
  const geometry = new THREE.BoxGeometry(.4, 1.8, .3), count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4); for (let i = 0; i < count; i++) weights[i * 4] = 1;
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

test('a skinned geometry is measured once and every later clone receives its own copy of the sphere', () => {
  const geometry = body(), first = character(geometry), second = character(geometry);
  let measurements = 0;
  for (const { mesh } of [first, second]) { const measure = mesh.computeBoundingSphere.bind(mesh); mesh.computeBoundingSphere = () => { measurements++; measure(); }; }
  shareSkinnedBounds(first.root); shareSkinnedBounds(second.root); shareSkinnedBounds(first.root);
  assert.equal(measurements, 1);
  assert.ok(first.mesh.boundingSphere && second.mesh.boundingSphere);
  assert.notEqual(first.mesh.boundingSphere, second.mesh.boundingSphere);
  assert.ok(first.mesh.boundingSphere.equals(second.mesh.boundingSphere));
  // The posed box fits inside, with the margin for motion.
  const exact = new THREE.Sphere(); new THREE.Box3().setFromBufferAttribute(geometry.attributes.position).getBoundingSphere(exact);
  assert.ok(first.mesh.boundingSphere.radius >= exact.radius);
});

test('a mesh that already has bounds keeps them', () => {
  const { root, mesh } = character(body()), own = new THREE.Sphere(new THREE.Vector3(1, 2, 3), 9);
  mesh.boundingSphere = own; shareSkinnedBounds(root);
  assert.equal(mesh.boundingSphere, own);
});
