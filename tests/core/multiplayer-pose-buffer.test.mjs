import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createPoseBuffer } from '../../src/multiplayer/pose-buffer.ts';
import { createVisibilityPause } from '../../src/multiplayer/visibility-pause.ts';
const pose = (time, x, overrides = {}) => ({ x, y: 0, z: 0, yaw: 0, moving: true, sprinting: false, updatedAt: time, serverTime: time, ...overrides });
const output = () => ({ x: 0, y: 0, z: 0, yaw: 0, moving: false, sprinting: false });

test('timestamped poses interpolate 120ms behind the server despite uneven packet delivery', () => {
  const buffer = createPoseBuffer(), out = output();
  buffer.push(pose(10000, 0), 0); buffer.push(pose(10100, 1), 110); buffer.push(pose(10200, 2), 205);
  assert.equal(buffer.sample(270, out), true);
  assert.ok(out.x > 1.45 && out.x < 1.55, 'sample uses server times, not exponential pursuit of the newest packet');
  buffer.push(pose(10100, 99), 280); buffer.sample(270, out);
  assert.ok(out.x < 1.55, 'out-of-order packets cannot rewind the buffer');
});

test('packet loss extrapolates for at most 100ms then stops gait; teleport clears history', () => {
  const buffer = createPoseBuffer(), out = output();
  buffer.push(pose(10000, 0), 0); buffer.push(pose(10100, 1), 100);
  buffer.sample(270, out); assert.equal(out.x, 1.5); assert.equal(out.moving, true);
  buffer.sample(1000, out); assert.equal(out.x, 2); assert.equal(out.moving, false);
  buffer.push(pose(11000, 80, { moving: false }), 1000); buffer.sample(1000, out);
  assert.equal(out.x, 80, 'fast travel never interpolates across buildings');
});

test('rotation takes the short arc and stopped poses never extrapolate', () => {
  const buffer = createPoseBuffer(), out = output();
  buffer.push(pose(10000, 0, { yaw: Math.PI - .1 }), 0);
  buffer.push(pose(10100, 1, { yaw: -Math.PI + .1, moving: false }), 100);
  buffer.sample(170, out); assert.ok(Math.abs(out.yaw - Math.PI) < 1e-6);
  buffer.sample(500, out); assert.equal(out.x, 1); assert.equal(out.moving, false);
});

test('mount and dismount switch at their buffered timestamp and clear reused output state', () => {
  const buffer = createPoseBuffer(0), out = output();
  buffer.push(pose(1000, 0), 0);
  buffer.push(pose(1100, 0, { riding: 'electric-bike', moving: false }), 100);
  buffer.sample(50, out); assert.equal(out.riding, undefined);
  buffer.sample(100, out); assert.equal(out.riding, 'electric-bike');
  buffer.push(pose(1200, 0, { moving: false }), 200);
  buffer.sample(200, out); assert.equal(out.riding, undefined);
});

test('a hidden tab releases once after its grace period and resumes once, and disposal cancels it', async () => {
  const doc = new EventTarget(); doc.hidden = false;
  let paused = 0, resumed = 0;
  const visibility = createVisibilityPause(() => paused++, () => resumed++, doc, 10);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); await delay(25);
  assert.equal(paused, 1); assert.equal(visibility.paused, true);
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(resumed, 1);
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); visibility.dispose(); await delay(25);
  assert.equal(paused, 1);
});
