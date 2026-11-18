import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { EXPLORATION_CLIP, setExplorationClip } from '../../src/rendering/camera-depth.ts';

const depthStep = (camera, distance) => distance ** 2 * (camera.far - camera.near) / (camera.far * camera.near * (2 ** 24 - 1));

test('walking precision separates thin authored surfaces without clipping the walkable city', () => {
  const camera = new PerspectiveCamera(62, 1, .06, 800);
  assert.ok(depthStep(camera, 100) > .006, 'old clip range could not reliably separate 6mm city layers');
  setExplorationClip(camera, false);
  assert.ok(depthStep(camera, 50) < .001, '2mm surfaces have at least two depth intervals at 50m');
  assert.ok(depthStep(camera, 100) < .004, '6mm city layers exceed one depth interval at 100m');
  assert.ok(new Vector3(0, 0, -320).project(camera).z < 1, 'full street remains inside the camera range');
  assert.ok(camera.near < .24, 'a first-person camera still sees a wall at capsule clearance');
});

test('overview obtains its own precision range and returning restores the walking projection', () => {
  const camera = new PerspectiveCamera(62, 1, .06, 800);
  setExplorationClip(camera, false);
  const walking = camera.projectionMatrix.clone();
  setExplorationClip(camera, true);
  assert.deepEqual({ near: camera.near, far: camera.far }, EXPLORATION_CLIP.overview);
  assert.ok(depthStep(camera, 200) < .003);
  assert.ok(new Vector3(0, 0, -730).project(camera).z < 1);
  setExplorationClip(camera, false);
  assert.ok(camera.projectionMatrix.equals(walking));
});
