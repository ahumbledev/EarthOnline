import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollowCameraMotion, FOLLOW_CAMERA_LIMITS, followCameraAlpha } from '../../src/exploration/camera-motion.ts';

const walking = { enabled: true, reducedMotion: false, speed: 2.8, grounded: true, sprinting: false };
const near = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);

test('hover has the requested direction and remains a bounded offset during a long walk', () => {
  const motion = createFollowCameraMotion();
  motion.setPointer(-1, -1);
  let offset;
  for (let step = 0; step < 36000; step++) {
    // Repeated events at the screen edge must never accumulate into a full orbit.
    motion.setPointer(-100, -100);
    offset = motion.update(1 / 60, { ...walking, sprinting: true, speed: 5.2 });
    assert.ok(Math.abs(offset.yaw) <= FOLLOW_CAMERA_LIMITS.pointerYaw + FOLLOW_CAMERA_LIMITS.driftYaw + 1e-12);
    assert.ok(Math.abs(offset.pitch) <= FOLLOW_CAMERA_LIMITS.pointerPitch + FOLLOW_CAMERA_LIMITS.driftPitch + 1e-12);
    assert.ok(Math.abs(offset.roll) <= FOLLOW_CAMERA_LIMITS.roll + 1e-12);
    assert.ok(Math.abs(offset.lateral) <= FOLLOW_CAMERA_LIMITS.lateral + 1e-12);
    assert.ok(Math.abs(offset.vertical) <= FOLLOW_CAMERA_LIMITS.vertical + 1e-12);
  }
  assert.ok(offset.yaw > 0, 'screen left adds clockwise azimuth');
  assert.ok(offset.pitch > 0, 'screen top adds a small elevated view');
  motion.setPointer(1, 1);
  for (let i = 0; i < 120; i++) offset = motion.update(1 / 60, walking);
  assert.ok(offset.yaw < 0 && offset.pitch < 0, 'opposite edges produce opposite offsets');
});

test('hover damping, gait phase, and follow lag are consistent at 30, 60, and 144 Hz', () => {
  const sample = (fps) => {
    const motion = createFollowCameraMotion();
    motion.setPointer(.8, -.5);
    let offset;
    let camera = 0;
    for (let i = 0; i < fps * 3; i++) {
      offset = motion.update(1 / fps, walking);
      camera += (1 - camera) * followCameraAlpha(1 / fps);
    }
    return { ...offset, camera };
  };
  const baseline = sample(60);
  for (const fps of [30, 144]) for (const [field, value] of Object.entries(sample(fps))) near(value, baseline[field]);
});

test('leaving the canvas returns hover to centre and reset clears all motion immediately', () => {
  const motion = createFollowCameraMotion();
  motion.setPointer(-1, .5);
  for (let i = 0; i < 60; i++) motion.update(1 / 60, walking);
  motion.clearPointer();
  let returned;
  for (let i = 0; i < 180; i++) returned = motion.update(1 / 60, { ...walking, speed: 0 });
  assert.ok(Math.abs(returned.yaw) < FOLLOW_CAMERA_LIMITS.driftYaw + 1e-6);
  assert.ok(Math.abs(returned.pitch) < FOLLOW_CAMERA_LIMITS.driftPitch + 1e-6);
  motion.reset();
  assert.deepEqual(motion.update(0, walking), { yaw: 0, pitch: 0, roll: 0, lateral: 0, vertical: 0 });
});

test('pause, a different camera mode, and reduced motion clear stale pointer and step motion', () => {
  for (const state of [{ enabled: false }, { reducedMotion: true }]) {
    const motion = createFollowCameraMotion();
    motion.setPointer(1, 1);
    for (let i = 0; i < 60; i++) motion.update(1 / 60, walking);
    assert.deepEqual(motion.update(1 / 60, { ...walking, ...state }), { yaw: 0, pitch: 0, roll: 0, lateral: 0, vertical: 0 });
    const resumed = motion.update(1 / 60, walking);
    assert.ok(Math.abs(resumed.yaw) <= FOLLOW_CAMERA_LIMITS.driftYaw, 'hover is not restored until the mouse moves on the canvas again');
    assert.ok(Math.abs(resumed.pitch) <= FOLLOW_CAMERA_LIMITS.driftPitch);
  }
});

test('standing against a wall has no step sway; invalid input cannot poison camera transforms', () => {
  const motion = createFollowCameraMotion();
  motion.setPointer(Number.NaN, Number.POSITIVE_INFINITY);
  for (let i = 0; i < 120; i++) {
    const offset = motion.update(1 / 60, { ...walking, speed: 0 });
    assert.equal(offset.lateral, 0);
    assert.ok(Math.abs(offset.vertical) <= FOLLOW_CAMERA_LIMITS.vertical * .2);
    assert.ok(Object.values(offset).every(Number.isFinite));
  }
  for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.ok(Object.values(motion.update(delta, { ...walking, speed: Number.NaN })).every(Number.isFinite));
    assert.equal(followCameraAlpha(delta), 0);
  }
});
