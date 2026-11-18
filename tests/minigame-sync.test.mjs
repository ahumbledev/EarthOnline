import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createGameRuntime, FIXED_DT } from '../shared/minigame-runtime.mjs';
import * as sync from '../shared/minigame-sync.mjs';

const definition = () => JSON.parse(readFileSync(new URL('../public/minigames/examples/collect.json', import.meta.url), 'utf8'));

test('a baseline and sequential deltas reconstruct authoritative dynamic state without static descriptions or trace', () => {
  const game = createGameRuntime(definition());
  let previous = game.dynamicSnapshot(), client = sync.applyMinigameSync(null, sync.createMinigameBaseline(previous, { streamId: 'room:round:epoch', sequence: 0 }));
  for (let sequence = 1; sequence <= 120; sequence++) {
    game.advance(FIXED_DT, { x: 1, z: 0 });
    const next = game.dynamicSnapshot();
    const delta = sync.createMinigameDelta(previous, next, { streamId: 'room:round:epoch', baseSequence: sequence - 1, sequence });
    client = sync.applyMinigameSync(client, JSON.parse(JSON.stringify(delta)));
    assert.deepEqual(client.snapshot, next);
    assert.equal(client.sequence, sequence);
    assert.equal('trace' in client.snapshot, false);
    assert.equal('arena' in client.snapshot, false);
    previous = next;
  }
  client.snapshot.variables.score = 999;
  assert.notEqual(game.dynamicSnapshot().variables.score, 999);
});

test('missing baseline, sequence gaps, duplicates and another owner stream require resync without mutating the client', () => {
  const rt = createGameRuntime(definition()), before = rt.dynamicSnapshot();
  const base = sync.createMinigameBaseline(before, { streamId: 'owner-a', sequence: 10 });
  const client = sync.applyMinigameSync(null, base);
  rt.advance(FIXED_DT, { x: 1, z: 0 });
  const delta = sync.createMinigameDelta(before, rt.dynamicSnapshot(), { streamId: 'owner-a', baseSequence: 10, sequence: 11 });
  assert.throws(() => sync.applyMinigameSync(null, delta), error => error.code === 'resync_required');
  for (const broken of [{ ...delta, baseSequence: 9, sequence: 10 }, { ...delta, baseSequence: 11, sequence: 12 }, { ...delta, streamId: 'owner-b' }]) {
    assert.throws(() => sync.applyMinigameSync(client, broken), error => error.code === 'resync_required');
  }
  const advanced = sync.applyMinigameSync(client, delta);
  assert.throws(() => sync.applyMinigameSync(advanced, delta), error => error.code === 'resync_required');
  assert.throws(() => sync.applyMinigameSync(advanced, base), error => error.code === 'resync_required');
  assert.deepEqual(client.snapshot, before);
  const recovered = sync.applyMinigameSync(advanced, sync.createMinigameBaseline(rt.dynamicSnapshot(), { streamId: 'owner-a', sequence: 20 }));
  assert.deepEqual(recovered.snapshot, rt.dynamicSnapshot());
  assert.equal(recovered.sequence, 20);
  assert.throws(() => sync.applyMinigameSync(advanced, sync.createMinigameBaseline(before, { streamId: 'owner-a', sequence: 30 })), error => error.code === 'resync_required');
});

test('deltas remove expired timers and omit idle players, static entities and unchanged variables', () => {
  const d = definition(); d.rules = [{ id: 'begin', on: { type: 'start' }, actions: [{ type: 'message', text: 'Begin' }] }];
  d.timers = [{ id: 'clock', duration: 1 / 60, autoStart: true }];
  const rt = createGameRuntime(d), before = rt.dynamicSnapshot(); rt.advance(FIXED_DT, { x: 0, z: 0 });
  const next = rt.dynamicSnapshot(), delta = sync.createMinigameDelta(before, next, { streamId: 'room', baseSequence: 0, sequence: 1 });
  assert.deepEqual(delta.changes.timers, { clock: null });
  for (const key of ['players', 'entities', 'variables', 'trace']) assert.equal(key in delta.changes, false);
  const initial = sync.applyMinigameSync(null, sync.createMinigameBaseline(before, { streamId: 'room' }));
  assert.deepEqual(sync.applyMinigameSync(initial, delta).snapshot, next);
  assert.ok(JSON.stringify(delta).length < JSON.stringify(sync.createMinigameBaseline(next, { streamId: 'room' })).length / 2);
});

test('malformed sync data, hidden capabilities and prototype keys are rejected atomically', () => {
  const state = createGameRuntime(definition()).dynamicSnapshot();
  const base = sync.createMinigameBaseline(state, { streamId: 'room', sequence: 0 });
  const client = sync.applyMinigameSync(null, base);
  for (const corrupt of [
    m => { m.protocolVersion = 9; }, m => { m.sequence = -1; }, m => { m.streamId = ''; },
    m => { m.snapshot.trace = []; }, m => { m.snapshot.variables.score = Infinity; },
    m => { m.snapshot.players[0].slot = 16; }, m => { m.snapshot.players.push(m.snapshot.players[0]); },
    m => { m.snapshot.entities[0].material = 'stone'; }, m => { m.snapshot.elapsed = 100; },
  ]) {
    const broken = structuredClone(base); corrupt(broken);
    assert.throws(() => sync.applyMinigameSync(null, broken), error => error.code === 'invalid_sync');
  }
  const delta = { protocolVersion: 1, type: 'delta', streamId: 'room', baseSequence: 0, sequence: 1, changes: {} };
  for (const changes of [{ trace: [] }, { tick: -1 }, { players: [{ id: 'outsider', x: 0 }] },
    { players: [{ id: 'player', slot: 1 }] }, { variables: { unknown: 1 } }, { variables: { score: null } },
    { entities: [{ id: state.entities[0].id, visible: false }, { id: state.entities[0].id, visible: true }] },
    JSON.parse('{"variables":{"__proto__":1}}')]) {
    assert.throws(() => sync.applyMinigameSync(client, { ...delta, changes }), error => error.code === 'invalid_sync');
  }
  assert.deepEqual(client.snapshot, state); assert.equal({}.polluted, undefined);
});
