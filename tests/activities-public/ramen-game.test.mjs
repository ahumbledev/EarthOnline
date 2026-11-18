import test from 'node:test';
import assert from 'node:assert/strict';
import { createRamenState, startRamen, advanceRamen, foldRamen } from '../../src/activities-public/ramen/game.ts';

const tick = (state, seconds, input = {}) => {
  for (let i = 0; i < Math.round(seconds * 100); i++) state = advanceRamen(state, { deltaSeconds: .01, knead: false, pull: false, ...input });
  return state;
};
function prepared(config) {
  let state = startRamen(createRamenState(config));
  state = tick(state, 3.01, { knead: true });
  assert.equal(state.stage, 'pulling');
  return state;
}
function doFold(state) {
  while (state.length < .71 && state.stage === 'pulling') {
    const pull = state.tension < state.config.tearThreshold * .58;
    state = advanceRamen(state, { deltaSeconds: .01, knead: false, pull });
  }
  while (state.tension > state.config.tearThreshold * .6 && state.stage === 'pulling') state = tick(state, .01);
  return foldRamen(state);
}

test('new gameplay requires kneading, measured stretching, releasing tension, and repeated folds', () => {
  const untouched = createRamenState();
  assert.equal(tick(untouched, 2, { knead: true }), untouched);
  let state = startRamen(untouched);
  state = tick(state, 2, { pull: true });
  assert.equal(state.kneaded, 0, 'pull cannot skip preparation');
  state = tick(state, 3.01, { knead: true });
  assert.equal(state.stage, 'pulling');
  const tooShort = foldRamen(state);
  assert.equal(tooShort.folds, 0);
  assert.equal(tooShort.notice, 'too-short');
  while (state.stage === 'pulling') {
    const foldsBefore = state.folds;
    state = doFold(state);
    assert.equal(state.folds, foldsBefore + 1);
  }
  assert.equal(state.stage, 'won');
  assert.equal(state.folds, 4);
  assert.ok(state.quality > 80);
  assert.equal(foldRamen(state), state, 'terminal result cannot be claimed again');
  assert.equal(tick(state, 2, { pull: true }), state);
  assert.equal(untouched.kneaded, 0, 'caller state is immutable');
});

test('uninterrupted force tears noodles and elapsed round time fails before completion', () => {
  const torn = tick(prepared(), 8, { pull: true });
  assert.equal(torn.stage, 'failed');
  assert.equal(torn.notice, 'torn');
  const timedOut = tick(startRamen(createRamenState({ roundSeconds: 30, targetFolds: 4, stretchSpeed: .32, tearThreshold: 1 })), 31);
  assert.equal(timedOut.stage, 'failed');
  assert.equal(timedOut.notice, 'timeout');
  assert.equal(timedOut.remaining, 0);
  const reset = createRamenState(torn.config);
  assert.equal(reset.stage, 'ready');
  assert.equal(reset.folds, 0);
  assert.equal(reset.tension, 0);
  assert.equal(reset.quality, 100);
});

test('release recovers tension; too long and stressed folds cannot advance', () => {
  let state = prepared();
  while (state.length < .65) state = tick(state, .01, { pull: true });
  assert.ok(state.tension > .72);
  assert.equal(foldRamen(state).notice, 'relax');
  const relaxed = tick(state, .5);
  assert.ok(relaxed.tension < state.tension);
  state = tick(relaxed, .03, { pull: true });
  assert.equal(foldRamen(state).folds, 1);
  let long = prepared({ roundSeconds: 90, targetFolds: 4, stretchSpeed: .32, tearThreshold: 2 });
  while (long.length < .9) long = tick(long, .01, { pull: true });
  assert.equal(foldRamen(long).notice, 'too-long');
  assert.equal(foldRamen(long).folds, 0);
});

test('invalid delta and suspended tabs never advance; bounded speed and tension settings remain playable with enough time', () => {
  const initial = prepared();
  for (const deltaSeconds of [NaN, Infinity, -1, 0, 1, 10000]) assert.equal(advanceRamen(initial, { deltaSeconds, knead: true, pull: true }), initial);
  const a = tick(initial, 1, { pull: true });
  let b = initial;
  for (let i = 0; i < 10; i++) b = advanceRamen(b, { deltaSeconds: .1, knead: false, pull: true });
  assert.ok(Math.abs(a.length - b.length) < 1e-10);
  assert.ok(Math.abs(a.tension - b.tension) < 1e-10);
  for (const stretchSpeed of [.1, .32, .8]) for (const tearThreshold of [.5, 1, 2]) {
    let state = prepared({ roundSeconds: 300, targetFolds: 8, stretchSpeed, tearThreshold });
    while (state.stage === 'pulling') state = doFold(state);
    assert.equal(state.stage, 'won', `${stretchSpeed} / ${tearThreshold}`);
  }
  const bounded = createRamenState({ roundSeconds: Infinity, targetFolds: 999, stretchSpeed: -1, tearThreshold: NaN });
  assert.deepEqual(bounded.config, { roundSeconds: 90, targetFolds: 8, stretchSpeed: .1, tearThreshold: 1 });
});
