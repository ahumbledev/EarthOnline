import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCharacterFollow } from '../../src/exploration/camera-follow.ts';

test('third-person follow softens jump height without moving the avatar and settles consistently across frame rates', () => {
  for (const hz of [30, 60, 144, 240]) {
    const follow = createCharacterFollow(), target = new THREE.Vector3(0, 1.3, 0);
    follow.update(target);
    target.set(1, 2.1, 0);
    for (let i = 0; i < hz / 2; i++) follow.update(target, 1 / hz);
    const pivot = follow.update(target, 0.001);
    assert.ok(Math.abs(pivot.x - (1 - Math.exp(-14 * .501))) < 1e-10);
    assert.ok(Math.abs(pivot.y - (2.1 - .8 * Math.exp(-8 * .501))) < 1e-10);
    assert.deepEqual(target.toArray(), [1, 2.1, 0], 'camera smoothing cannot change the displayed player');
  }
});

test('travel, view switches and large server corrections snap without a camera sweep', () => {
  const follow = createCharacterFollow(), target = new THREE.Vector3();
  follow.update(target);
  target.set(250, 5, -400);
  assert.deepEqual(follow.update(target, 1 / 60).toArray(), target.toArray());
  target.add(new THREE.Vector3(0, 1, 0));
  assert.deepEqual(follow.update(target).toArray(), target.toArray());
});
