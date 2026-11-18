import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldClock, sampleDaylight } from '../../src/exploration/time.ts';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('the default clock starts at golden hour and a full day lasts 12 real minutes', () => {
  const clock = createWorldClock();
  close(clock.hour, 17.2);
  assert.equal(clock.day, 1);
  assert.equal(clock.paused, false);
  assert.equal(clock.speed, 1);
  clock.update(30);
  close(clock.hour, 18.2);
  clock.update(720);
  close(clock.hour, 18.2);
  assert.equal(clock.day, 2);
});

test('clock advance is independent of frame rate, including exact midnight and long frames', () => {
  const oneFrame = createWorldClock(0);
  const sixtyFps = createWorldClock(0);
  const fifteenFps = createWorldClock(0);
  oneFrame.update(720 * 3);
  for (let frame = 0; frame < 60 * 720 * 3; frame++) sixtyFps.update(1 / 60);
  for (let frame = 0; frame < 15 * 720 * 3; frame++) fifteenFps.update(1 / 15);
  for (const clock of [oneFrame, sixtyFps, fifteenFps]) {
    close(clock.hour, 0);
    assert.equal(clock.day, 4);
  }

  const clock = createWorldClock(23.5);
  clock.update(720 * 21 + 60);
  close(clock.hour, 1.5);
  assert.equal(clock.day, 23);
});

test('pause, zero speed and speed changes preserve the current instant until resumed', () => {
  const clock = createWorldClock(12);
  clock.setPaused(true);
  clock.update(1000);
  close(clock.hour, 12);
  assert.equal(clock.day, 1);
  clock.setPaused(false);
  clock.setSpeed(0);
  clock.update(1000);
  close(clock.hour, 12);
  clock.setSpeed(4);
  clock.update(30);
  close(clock.hour, 16);
  clock.setSpeed(0.25);
  clock.update(120);
  close(clock.hour, 17);
});

test('scrubbing wraps the hour and keeps the current day, including at 24 and negative hours', () => {
  const clock = createWorldClock(48);
  close(clock.hour, 0);
  assert.equal(clock.day, 1);
  clock.update(720);
  assert.equal(clock.day, 2);
  clock.setHour(24);
  close(clock.hour, 0);
  clock.setHour(-1.5);
  close(clock.hour, 22.5);
  clock.setHour(49.25);
  close(clock.hour, 1.25);
  assert.equal(clock.day, 2);
});

test('invalid numeric inputs fail without corrupting an existing clock', () => {
  for (const duration of [0, -10, NaN, Infinity]) {
    assert.throws(() => createWorldClock(12, duration), RangeError);
  }
  for (const hour of [NaN, Infinity, -Infinity]) {
    assert.throws(() => createWorldClock(hour), RangeError);
    assert.throws(() => sampleDaylight(hour), RangeError);
  }
  const clock = createWorldClock(12);
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => clock.update(value), RangeError);
    assert.throws(() => clock.setSpeed(value), RangeError);
  }
  assert.throws(() => clock.setHour(NaN), RangeError);
  clock.setSpeed(Number.MAX_VALUE);
  assert.throws(() => clock.update(Number.MAX_VALUE), RangeError);
  close(clock.hour, 12);
  assert.equal(clock.day, 1);
});

test('daylight produces a unit sun direction, golden hours and distinct night lighting', () => {
  for (let hour = 0; hour < 24; hour += 0.125) {
    const sample = sampleDaylight(hour);
    close(Math.hypot(...sample.sunDirection), 1);
    close(sample.sunDirection[1], sample.sunHeight);
    for (const key of ['daylight', 'twilight', 'night', 'warmth']) {
      assert.ok(sample[key] >= 0 && sample[key] <= 1, `${key} out of range at ${hour}`);
    }
    close(sample.daylight + sample.night, 1);
  }
  assert.ok(sampleDaylight(6).sunDirection[0] > 0.99, 'sun rises in +X');
  assert.ok(sampleDaylight(18).sunDirection[0] < -0.99, 'sun sets in -X');
  assert.ok(sampleDaylight(12).daylight > 0.99);
  assert.ok(sampleDaylight(0).night > 0.99);
  assert.ok(sampleDaylight(17.2).warmth > 0.75);
  assert.ok(sampleDaylight(6).twilight > 0.9);
  assert.ok(sampleDaylight(12).warmth < 0.01);
  assert.deepEqual(sampleDaylight(0), sampleDaylight(24));
  assert.deepEqual(sampleDaylight(-6), sampleDaylight(18));
  assert.equal(sampleDaylight(5).phase, 'Dawn');
  assert.equal(sampleDaylight(7).phase, 'Morning');
  assert.equal(sampleDaylight(12).phase, 'Day');
  assert.equal(sampleDaylight(17.2).phase, 'Dusk');
  assert.equal(sampleDaylight(20).phase, 'Evening');
  assert.equal(sampleDaylight(0).phase, 'Night');
});

test('lighting stays continuous across dawn, dusk, phase boundaries and midnight', () => {
  for (let boundary = 0; boundary <= 24; boundary += 0.01) {
    const before = sampleDaylight(boundary - 1e-5);
    const after = sampleDaylight(boundary + 1e-5);
    for (const key of ['sunHeight', 'daylight', 'twilight', 'night', 'warmth']) {
      close(before[key], after[key], 0.0001);
    }
    for (let axis = 0; axis < 3; axis++) {
      close(before.sunDirection[axis], after.sunDirection[axis], 0.0001);
    }
  }
});
