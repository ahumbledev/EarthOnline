import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bikeInputFromKeys } from '../../src/exploration/bike-controls.ts';
import { createBikeCamera } from '../../src/exploration/bike-camera.ts';

test('bike keys brake on lost focus, cancel opposites, and steer toward the displayed left', () => {
  assert.deepEqual(bikeInputFromKeys(new Set(['KeyW','KeyA'])), {throttle:1,steering:1,brake:0});
  assert.deepEqual(bikeInputFromKeys(new Set(['ArrowDown','ArrowRight'])), {throttle:-1,steering:-1,brake:0});
  assert.deepEqual(bikeInputFromKeys(new Set(['KeyW','KeyS','KeyA','KeyD'])), {throttle:0,steering:0,brake:1});
  assert.deepEqual(bikeInputFromKeys(new Set(['KeyW']), false), {throttle:0,steering:0,brake:1});
  assert.equal(bikeInputFromKeys(new Set(['KeyW','Space'])).brake, 1);
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0,2,-4);camera.lookAt(0,1,0);
  const turn = new THREE.Vector3(0,0,1).applyAxisAngle(new THREE.Vector3(0,1,0), .2).project(camera);
  assert.ok(turn.x < 0, 'A turns toward the left side of the chase camera');
});

test('bike chase camera stays level during lean and retracts immediately behind an obstacle', () => {
  const follow = createBikeCamera(), camera = new THREE.PerspectiveCamera(62,1.6,.1,500);
  const pose = {position:new THREE.Vector3(),quaternion:new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),.4)};
  follow.update(camera,pose,7,1/60,(_,desired)=>desired);
  assert.ok(camera.position.z < -3);
  const clearPosition = camera.position.clone();
  follow.update(camera,pose,7,1/60,(target,desired)=>target.clone().lerp(desired,.2));
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0,1.25,.45)) < 1.2);
  assert.ok(camera.position.distanceTo(clearPosition) > 2);
  const right = new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
  assert.ok(Math.abs(right.y) < 1e-8, 'visual bicycle lean must not roll the horizon');
});
