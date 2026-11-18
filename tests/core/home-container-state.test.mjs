import test from 'node:test';
import assert from 'node:assert/strict';
import { containerLocalPose, containerWorldPose, containerDescendants, containerWouldCycle,
  checkContainerPlacement, findContainerPlacement } from '../../src/home/container-state.ts';

const box = { id: 'cardboard-open', name: 'box', category: 'small', mount: 'small', pack: 'boxes', node: 'cardboard-open',
  size: { width: .3746, depth: .3778, height: .3094 } };
const mug = { id: 'mug', name: 'mug', category: 'small', mount: 'small', pack: 'test', node: 'mug',
  size: { width: .1, depth: .1, height: .1 } };
const pose = (id, x, y, z) => ({ id, item: 'mug', x, y, z, yaw: 0 });

test('container transforms round-trip a tilted item and keep its instance metadata', () => {
  const container = { x: 4, y: 1, z: -3, yaw: 0, tilt: [Math.SQRT1_2, 0, 0, Math.SQRT1_2] };
  const original = { ...pose('fish-123', 4.1, 1.2, -2.9), item: 'fish', yaw: Math.PI / 2, quality: 'gold' };
  const local = containerLocalPose(container, original);
  const restored = containerWorldPose(container, local);
  for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(restored[key] - original[key]) < 1e-8, key);
  assert.equal(restored.id, 'fish-123'); assert.equal(restored.quality, 'gold');
  assert.ok(Math.abs(restored.tilt[1] - Math.SQRT1_2) < 1e-8);
  assert.ok(Math.abs(restored.tilt[3] - Math.SQRT1_2) < 1e-8);
});

test('container ancestry rejects self and nested cycles without treating shelf support as ownership', () => {
  const items = [
    { ...pose('a', 0, 0, 0), location: { kind: 'home' } },
    { ...pose('b', 0, 0, 0), location: { kind: 'container', containerId: 'a' } },
    { ...pose('c', 0, 0, 0), location: { kind: 'container', containerId: 'b' } },
    { ...pose('nearby', 0, 0, 0), location: { kind: 'home' } },
  ];
  assert.deepEqual(containerDescendants('a', items), ['b', 'c']);
  assert.equal(containerWouldCycle('a', 'a', items), true);
  assert.equal(containerWouldCycle('a', 'c', items), true);
  assert.equal(containerWouldCycle('c', 'a', items), false);
});

test('packing uses interior geometry and existing item positions rather than a slot count', () => {
  const contents = [];
  for (let i = 0; i < 4; i++) {
    const placement = findContainerPlacement(box, mug, `owned-mug-${i}`, contents);
    assert.ok(placement, `mug ${i} fits`);
    assert.equal(placement.id, `owned-mug-${i}`);
    contents.push({ definition: mug, placement });
  }
  assert.equal(findContainerPlacement(box, mug, 'too-many-on-floor', contents), undefined);
  assert.equal(checkContainerPlacement(box, mug, { ...contents[0].placement, id: 'another' }, contents).problem, 'overlap');
  const wide = { ...mug, size: { ...mug.size, width: .4 } };
  assert.equal(findContainerPlacement(box, wide, 'wide', []), undefined);
  assert.equal(checkContainerPlacement(box, mug, pose('outside', .15, .02, 0), []).problem, 'outside-container');
  assert.equal(checkContainerPlacement(mug, mug, pose('inside-mug', 0, 0, 0), []).problem, 'not-container');
});
