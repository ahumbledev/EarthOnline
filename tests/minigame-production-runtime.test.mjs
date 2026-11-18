import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { validateGameDefinition } from '../shared/minigame-protocol.mjs';
import * as runtime from '../shared/minigame-runtime.mjs';

const idle = { x: 0, z: 0 };
const actors = count => Array.from({ length: count }, (_, slot) => ({ id: `p-${slot}`, slot }));
const box = (id, x, z, extra = {}) => ({ id, shape: 'box', position: [x, .5, z], size: [.5, 1, .5], material: 'stone', ...extra });
function game(profile = 'standard8', count = 8) {
  return { schemaVersion: 3, profile, id: 'production-test', title: 'Production test', description: 'A fixed-roster shared challenge.',
    author: 'EarthOnline', version: '1.0.0', players: { min: profile === 'coop4' || profile === 'party16' ? 2 : 1, max: count },
    arena: { width: 80, depth: 20, spawns: Array.from({ length: count }, (_, slot) => [-30 + slot * 4, -4]), playerSpeed: 3, playerRadius: .3, material: 'concrete' },
    entities: [], variables: { score: 0 }, rules: [{ id: 'start', on: { type: 'start' }, actions: [{ type: 'message', text: 'Ready.' }] }] };
}

test('schema 3 explicitly selects a bounded profile and starts all 8 or 16 roster slots', () => {
  for (const [profile, count] of [['solo', 1], ['coop4', 4], ['standard8', 8], ['party16', 16]]) {
    const definition = game(profile, count);
    assert.deepEqual(validateGameDefinition(definition), { valid: true, issues: [] });
    const rt = runtime.createMultiplayerRuntime(definition, { players: actors(count) });
    assert.equal(rt.snapshot().players.length, count);
  }
  for (const definition of [game(undefined, 8), game('party32', 32), game('party64', 64), game('standard8', 9),
    { ...game(), profile: undefined }, { ...game(), profile: { toString: 1, valueOf: 2 } }, { ...game(), players: { min: 0, max: 8 } }, { ...game('solo', 1), players: { min: 1, max: 2 } }]) {
    if (definition.profile === 'standard8' && definition.players.max === 8 && definition.players.min === 1) delete definition.profile;
    assert.equal(validateGameDefinition(definition).valid, false);
  }
  assert.equal(validateGameDefinition({ ...game(), schemaVersion: 2 }).valid, false);
});

test('legacy solo and cooperative checkpoints preserve terminal states and rolled-over drained traces', () => {
  for (const schemaVersion of [1, 2]) {
    const d = game('coop4', 2); delete d.profile; d.schemaVersion = schemaVersion;
    if (schemaVersion === 1) { d.players = 1; d.arena.spawn = d.arena.spawns[0]; delete d.arena.spawns; }
    d.timers = [{ id: 'pulse', duration: runtime.FIXED_DT, repeat: true, autoStart: true }];
    d.rules.push({ id: 'count', on: { type: 'timer', timer: 'pulse' }, actions: [{ type: 'add', variable: 'score', value: 1 }] },
      { id: 'finish', on: { type: 'timer', timer: 'pulse' }, when: [{ variable: 'score', op: 'gte', value: 150 }], actions: [{ type: 'win' }] });
    const create = () => schemaVersion === 1 ? runtime.createGameRuntime(d) : runtime.createMultiplayerRuntime(d, { players: actors(2) });
    const restore = c => schemaVersion === 1 ? runtime.restoreGameRuntime(d, c) : runtime.restoreMultiplayerRuntime(d, c);
    const a = create(), inputs = schemaVersion === 1 ? idle : {};
    for (let tick = 0; tick < 140; tick++) a.advance(runtime.FIXED_DT, inputs);
    assert.equal(a.snapshot().trace.length, 256); a.drainEvents();
    a.advance(runtime.FIXED_DT / 2, inputs);
    const b = restore(JSON.parse(JSON.stringify(a.checkpoint())));
    assert.deepEqual(b.drainEvents(), []);
    a.advance(.25, inputs); b.advance(.25, inputs);
    assert.equal(a.progress().status, 'won'); assert.deepEqual(b.checkpoint(), a.checkpoint());
    const ended = restore(JSON.parse(JSON.stringify(a.checkpoint()))); ended.advance(.25, inputs);
    assert.deepEqual(ended.checkpoint(), a.checkpoint());
  }
});

test('JSON checkpoint restores held and pending input, once, inside, fractional time, timers, motion and teleport state tick-for-tick', () => {
  const definition = game('coop4', 2); definition.arena.spawns = [[-2, 0], [4, 0]];
  definition.entities = [box('zone', -2, 0, { trigger: true }), box('button', -2, 0, { interactable: true }),
    box('portal', 1, 0, { trigger: true }), box('moving', 0, 5, { motion: { to: [4, 5], duration: 1 } })];
  definition.timers = [{ id: 'pulse', duration: .05, repeat: true }];
  definition.rules.push(
    { id: 'enter-zone', on: { type: 'enter', entity: 'zone' }, actions: [{ type: 'add', variable: 'score', value: 1 }] },
    { id: 'press', on: { type: 'interact', entity: 'button' }, once: true, actions: [{ type: 'add', variable: 'score', value: 5 }, { type: 'timer.start', timer: 'pulse' }] },
    { id: 'pulse', on: { type: 'timer', timer: 'pulse' }, actions: [{ type: 'add', variable: 'score', value: 2 }] },
    { id: 'travel', on: { type: 'enter', entity: 'portal' }, actions: [{ type: 'teleport', target: 'actor', position: [5, 4] }] });
  const a = runtime.createMultiplayerRuntime(definition, { players: actors(2) });
  a.advance(runtime.FIXED_DT, { 'p-0': { ...idle, interact: true } });
  assert.equal(a.snapshot().variables.score, 6);
  a.advance(runtime.FIXED_DT / 2, {});
  a.advance(0, { 'p-0': { ...idle, interact: true } });
  const checkpoint = JSON.parse(JSON.stringify(a.checkpoint()));
  const b = runtime.restoreMultiplayerRuntime(definition, checkpoint);
  assert.deepEqual(b.checkpoint(), checkpoint);
  for (let tick = 0; tick < 100; tick++) {
    const inputs = { 'p-0': { x: tick > 4 ? 1 : 0, z: 0, interact: true } };
    a.advance(runtime.FIXED_DT, inputs); b.advance(runtime.FIXED_DT, inputs);
    assert.deepEqual(b.checkpoint(), a.checkpoint(), `restored divergence at tick ${tick}`);
  }
  assert.equal(a.snapshot().players[0].z, 4);
  assert.equal(a.snapshot().trace.filter(entry => entry.ruleId === 'press').length, 1);
  assert.deepEqual(b.drainEvents(), a.drainEvents());
  assert.deepEqual(b.checkpoint(), a.checkpoint());
  checkpoint.variables.score = 999;
  assert.notEqual(b.snapshot().variables.score, 999);
});

test('lightweight advance preserves the legacy step result without exposing scene descriptions or diagnostic traces', () => {
  const definition = game(), a = runtime.createMultiplayerRuntime(definition, { players: actors(8) });
  const b = runtime.createMultiplayerRuntime(definition, { players: actors(8) });
  for (let tick = 0; tick < 120; tick++) {
    const inputs = { 'p-0': { x: 1, z: 0 } };
    const progress = a.advance(runtime.FIXED_DT, inputs);
    b.step(runtime.FIXED_DT, inputs);
    assert.deepEqual(Object.keys(progress).sort(), ['elapsed', 'status', 'tick']);
    assert.equal(progress.tick, tick + 1);
  }
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.progress(), { tick: 120, elapsed: 2, status: 'playing' });
  const dynamic = a.dynamicSnapshot();
  assert.equal('trace' in dynamic, false); assert.equal('definition' in dynamic, false);
  assert.equal('arena' in dynamic, false);
  dynamic.players[0].x = 999; dynamic.variables.score = 999;
  assert.equal(a.snapshot().variables.score, 0);
  assert.ok(a.snapshot().players[0].x < -20);
  const before = a.checkpoint?.() ?? a.snapshot();
  assert.throws(() => a.advance(runtime.FIXED_DT, { outsider: idle }));
  assert.deepEqual(a.checkpoint?.() ?? a.snapshot(), before);
});

test('restore rejects malformed, mismatched and out-of-budget checkpoints before creating a runtime', () => {
  const definition = game('coop4', 2);
  definition.entities = [box('zone', -30, -4, { trigger: true }), box('wall', 0, 0, { solid: true })];
  definition.timers = [{ id: 'clock', duration: 2, autoStart: true }];
  definition.rules[0].once = true;
  const original = runtime.createMultiplayerRuntime(definition, { players: actors(2) });
  original.advance(runtime.FIXED_DT, {});
  const checkpoint = original.checkpoint();
  const corruptions = [
    c => { c.checkpointVersion = 2; }, c => { c.runtimeVersion = 'future'; }, c => { c.definitionFingerprint = 'changed'; },
    c => { c.extra = true; }, c => { c.mode = 'solo'; }, c => { c.tick = -1; }, c => { c.tick = .5; },
    c => { c.accumulator = 1; }, c => { c.status = 'paused'; }, c => { c.sequence = Infinity; },
    c => { c.variables.score = NaN; }, c => { c.variables.unknown = 1; }, c => { delete c.variables.score; },
    c => { c.players[0].id = '__proto__'; }, c => { c.players[1].slot = 0; }, c => { c.players[0].slot = 2; },
    c => { c.players[0].x = 1000; }, c => { c.players[0].inside = ['missing']; }, c => { c.players[0].interactHeld = 1; },
    c => { c.players[0].teleportEpoch = -.5; }, c => { c.players[0].x = 0; c.players[0].z = 0; },
    c => { c.entities[0].id = 'wall'; }, c => { c.entities[0].visible = 'yes'; }, c => { c.entities[0].x += 1; },
    c => { c.entities[0].previousX = Infinity; }, c => { c.entities.pop(); },
    c => { c.timers[0].remaining = -1; }, c => { c.timers[0].duration++; }, c => { c.timers[0].startedAt = 100; },
    c => { c.firedOnce.push('unknown'); }, c => { c.trace[0].kind = 'execute'; }, c => { c.trace[0].seq = 999; },
    c => { c.pendingEvents[0].text = 'forged'; }, c => { c.actionsThisTick = 100000; },
  ];
  for (const corrupt of corruptions) {
    const broken = structuredClone(checkpoint); corrupt(broken);
    assert.throws(() => runtime.restoreMultiplayerRuntime(definition, broken), error => error.code === 'invalid_checkpoint', corrupt.toString());
  }
  for (const invalid of [null, [], Object.create(checkpoint), {}]) assert.throws(() => runtime.restoreMultiplayerRuntime(definition, invalid));
  assert.throws(() => runtime.restoreMultiplayerRuntime({ ...definition, version: '1.0.1' }, checkpoint), /checkpoint/i);
  assert.deepEqual(original.checkpoint(), checkpoint);
});

test('shipped 8- and 16-player games require every role and replay successfully across a checkpoint', () => {
  for (const [name, count] of [['standard8', 8], ['party16', 16]]) {
    const definition = JSON.parse(readFileSync(new URL(`../public/minigames/examples/${name}.json`, import.meta.url), 'utf8'));
    const replay = JSON.parse(readFileSync(new URL(`../public/minigames/replays/${name}-win.json`, import.meta.url), 'utf8'));
    assert.equal(validateGameDefinition(definition).valid, true);
    const a = runtime.createMultiplayerRuntime(definition, { players: replay.players });
    let b = runtime.createMultiplayerRuntime(definition, { players: replay.players });
    for (const step of replay.steps) {
      for (let frame = 0; frame < step.frames; frame++) {
        a.advance(runtime.FIXED_DT, step.inputs); b.advance(runtime.FIXED_DT, step.inputs);
        if (a.progress().tick === 45) b = runtime.restoreMultiplayerRuntime(definition, JSON.parse(JSON.stringify(b.checkpoint())));
        assert.deepEqual(b.dynamicSnapshot(), a.dynamicSnapshot());
      }
    }
    assert.equal(a.progress().status, 'won');
    assert.deepEqual(a.snapshot().variables, { ready: count, arrived: count });
    const partial = runtime.createMultiplayerRuntime(definition, { players: replay.players });
    for (const step of replay.steps) for (let frame = 0; frame < step.frames; frame++) {
      partial.advance(runtime.FIXED_DT, { ...step.inputs, [`p-${count - 1}`]: idle });
    }
    assert.equal(partial.progress().status, 'playing');
    assert.equal(partial.snapshot().variables.ready, count - 1);
    assert.equal(partial.snapshot().entities.find(entity => entity.id === 'gate').visible, true);
    while (partial.progress().status === 'playing') partial.advance(runtime.FIXED_DT, {});
    assert.equal(partial.progress().status, 'lost'); assert.equal(partial.progress().tick, 1800);
  }
});
