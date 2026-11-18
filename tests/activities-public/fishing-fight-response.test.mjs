import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFightResponse } from '../../src/activities-public/fishing/fight-response.ts';

const base = { behavior: 'small-dart', telegraph: false, pullDirection: 1, rodDirection: -1, rodAngle: 0, tension: .4, drag: .4 };

test('each attack supplies the exact steering, tip and reel response used for a counter', () => {
  for (const pullDirection of [-1, 1]) {
    for (const behavior of ['small-dart', 'perch-pause', 'grass-run', 'deep-run', 'dive', 'jump', 'switchback', 'last-run']) {
      const angle = behavior === 'jump' ? -1 : behavior === 'dive' ? 1 : 0;
      const state = { ...base, behavior, pullDirection, rodDirection: -pullDirection, rodAngle: angle };
      const result = evaluateFightResponse(state, behavior === 'perch-pause');
      assert.equal(result.eligible, true, behavior); assert.equal(result.correct, true, behavior);
      assert.equal(result.sideTarget, behavior === 'jump' ? 0 : -pullDirection);
      assert.equal(result.angleTarget, angle);
      assert.equal(result.reelTarget, behavior === 'perch-pause' ? 'hold' : 'release');
      assert.equal(result.reason, 'controlled');
      const warning = evaluateFightResponse({ ...state, telegraph: true }, behavior === 'perch-pause');
      assert.deepEqual({ ...warning, eligible: true, correct: true, reason: 'controlled' }, result);
      assert.equal(warning.eligible, false); assert.equal(warning.correct, false); assert.equal(warning.reason, 'warning');
    }
  }
});

test('valid steering alone never paints an incorrect reel, tip, contact or drag response as successful', () => {
  const rejected = [
    [{ tension: .179 }, false, 'tension-low'], [{ tension: .861 }, false, 'tension-high'],
    [{ drag: .199 }, false, 'drag-too-loose'], [{ drag: .651 }, false, 'drag-too-tight'],
    [{}, true, 'release-reel'], [{ behavior: 'perch-pause' }, false, 'hold-reel'],
    [{ behavior: 'jump', rodAngle: -.35 }, false, 'lower-tip'],
    [{ behavior: 'dive', rodAngle: .35 }, false, 'raise-tip'],
    [{ rodDirection: -.5 }, false, 'steer-left'],
    [{ pullDirection: -1, rodDirection: .5 }, false, 'steer-right'],
  ];
  for (const [patch, reeling, reason] of rejected) {
    const result = evaluateFightResponse({ ...base, ...patch }, reeling);
    assert.equal(result.eligible, true); assert.equal(result.correct, false, reason); assert.equal(result.reason, reason);
  }
  for (const tension of [.18, .86]) for (const drag of [.2, .65]) assert.equal(evaluateFightResponse({ ...base, tension, drag }, false).correct, true);
  assert.equal(evaluateFightResponse({ ...base, behavior: 'jump', rodDirection: 0, rodAngle: -1, drag: .75 }, false).correct, true);
  assert.equal(evaluateFightResponse({ ...base, behavior: 'dive', rodAngle: 1, drag: .75 }, false).correct, true);
  assert.equal(evaluateFightResponse({ ...base, behavior: 'perch-pause', drag: .75 }, true).correct, true);
});

test('quiet fish and invalid samples cannot become a counter or emit nonfinite HUD targets', () => {
  for (const behavior of ['steady', 'recover', 'unknown']) {
    const result = evaluateFightResponse({ ...base, behavior }, false);
    assert.equal(result.eligible, false); assert.equal(result.correct, false); assert.equal(result.reelTarget, null);
  }
  for (const field of ['pullDirection', 'rodDirection', 'rodAngle', 'tension', 'drag']) {
    const result = evaluateFightResponse({ ...base, [field]: NaN }, false);
    assert.equal(result.eligible, false); assert.equal(result.correct, false);
    assert.ok([-1, 0, 1].includes(result.sideTarget)); assert.ok([-1, 0, 1].includes(result.angleTarget));
  }
  assert.equal(evaluateFightResponse({ ...base, pullDirection: 0 }, false).eligible, false);
});
