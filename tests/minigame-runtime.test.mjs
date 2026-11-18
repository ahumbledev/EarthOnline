import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MINIGAME_LIMITS, validateGameDefinition } from '../shared/minigame-protocol.mjs';
import { FIXED_DT, createGameRuntime } from '../shared/minigame-runtime.mjs';

const example = (name) => JSON.parse(readFileSync(new URL(`../public/minigames/examples/${name}.json`, import.meta.url), 'utf8'));
const idle = { x: 0, z: 0 };
function run(runtime, frames, input = idle) {
  for (let i = 0; i < frames; i++) runtime.step(FIXED_DT, input);
  return runtime.snapshot();
}
function game() {
  return {
    schemaVersion: 1, id: 'test-game', title: 'Test game', description: 'An interpreter probe.',
    author: 'EarthOnline', version: '1.0.0', players: 1,
    arena: { width: 20, depth: 20, spawn: [0, 0], playerSpeed: 3, playerRadius: 0.3, material: 'concrete' },
    entities: [], variables: { score: 0 },
    rules: [{ id: 'start', on: { type: 'start' }, actions: [{ type: 'message', text: 'Ready.' }] }],
  };
}
const box = (id, x, z, extra = {}) => ({ id, shape: 'box', position: [x, 0.5, z], size: [1, 1, 1], material: 'stone', ...extra });
const increment = (on, id = 'increment') => ({ id, on, actions: [{ type: 'add', variable: 'score', value: 1 }] });

test('all three canonical definitions validate and have reachable, distinct winning trajectories', () => {
  for (const name of ['collect', 'switches', 'survival']) assert.deepEqual(validateGameDefinition(example(name)), { valid: true, issues: [] });
  const collect = createGameRuntime(example('collect'));
  const collected = run(collect, 300, { x: 1, z: 0 });
  assert.equal(collected.status, 'won'); assert.equal(collected.variables.score, 3);
  assert.equal(collected.entities.filter((e) => e.id.startsWith('lantern-') && e.visible).length, 0);

  const switches = createGameRuntime(example('switches'));
  run(switches, 1, { ...idle, interact: true });
  assert.deepEqual(switches.snapshot().variables, { north: 1, south: 0 });
  run(switches, 80, { x: 0, z: 1 });
  run(switches, 1, { ...idle, interact: true });
  assert.equal(switches.snapshot().entities.find((e) => e.id === 'door').visible, false);
  assert.equal(run(switches, 220, { x: 1, z: 0 }).status, 'won');

  const survival = createGameRuntime(example('survival'));
  run(survival, 40, { x: 0, z: -1 });
  const survived = run(survival, 560);
  assert.equal(survived.status, 'won'); assert.equal(survived.tick, 600);
  assert.equal(survived.variables.seconds, 10);
});

test('samples can fail, and the closed puzzle door really blocks movement', () => {
  assert.equal(run(createGameRuntime(example('collect')), 3600).status, 'lost');
  const puzzle = createGameRuntime(example('switches'));
  const stopped = run(puzzle, 250, { x: 1, z: 0 });
  assert.equal(stopped.status, 'playing'); assert.ok(stopped.player.x <= -0.55 + 1e-9);
  assert.deepEqual(stopped.variables, { north: 0, south: 0 });
  const survival = run(createGameRuntime(example('survival')), 600);
  assert.equal(survival.status, 'lost'); assert.ok(survival.tick < 150);
  assert.ok(survival.trace.some((e) => e.event === 'enter' && e.entityId === 'low-hazard'));
});

test('validator reports exact paths for unknown fields, references, scripts and unsupported capabilities', () => {
  const d = game();
  d.players = 2; d.script = 'globalThis.fetch()';
  d.entities.push(box('prop', 3, 0, { texture: 'missing', motion: { to: [4, 0], duration: 1 }, solid: true }));
  d.rules[0].actions.push({ type: 'set', variable: 'unknown', value: 1 });
  d.rules.push({ id: 'bad', on: { type: 'enter', entity: 'prop' }, actions: [{ type: 'eval', code: 'alert(1)' }] });
  const result = validateGameDefinition(d);
  assert.equal(result.valid, false);
  for (const path of ['/players', '/script', '/entities/0/texture', '/entities/0/motion', '/rules/0/actions/1/variable', '/rules/1/on/entity', '/rules/1/actions/0/type']) {
    assert.ok(result.issues.some((e) => e.path === path), path);
  }
  assert.throws(() => createGameRuntime(d), (error) => Array.isArray(error.issues) && error.issues.length > 0);
});

test('validator rejects traversal, remote texture URLs, duplicate IDs, nonfinite state and out-of-bounds geometry', () => {
  for (const path of ['../secret.png', 'assets/../../secret.png', 'https://example.org/secret.png', '/assets/a.png', 'assets/a.svg', 'assets\\a.png', 'assets/a.png?x=1']) {
    const d = game(); d.assets = { texture: { path } };
    assert.ok(validateGameDefinition(d).issues.some((e) => e.code === 'asset_path'), path);
  }
  const d = game();
  d.assets = { texture: { path: 'assets/tiles/stone.png' } };
  d.entities = [box('prop', 2, 0, { texture: 'texture' })];
  assert.equal(validateGameDefinition(d).valid, true);
  d.entities.push(box('prop', 10, 0)); d.variables.score = Infinity;
  const issues = validateGameDefinition(d).issues;
  assert.ok(issues.some((e) => e.code === 'duplicate_id'));
  assert.ok(issues.some((e) => e.path === '/variables/score'));
  assert.ok(issues.some((e) => e.code === 'bounds'));
  const malicious = JSON.parse(JSON.stringify(game()));
  malicious.variables = JSON.parse('{"__proto__":1,"constructor":2}');
  assert.equal(validateGameDefinition(malicious).valid, false);
  assert.equal({}.polluted, undefined);
});

test('validator handles malformed JSON-shaped values without throwing and caps diagnostics', () => {
  for (const data of [null, [], 1, '', {}, { ...game(), arena: null, entities: [null, 4], rules: [{}] }]) {
    assert.equal(validateGameDefinition(data).valid, false);
  }
  const d = game(); d.entities = Array.from({ length: 1000 }, () => ({}));
  assert.ok(validateGameDefinition(d).issues.length <= MINIGAME_LIMITS.issues);
  const blocked = game(); blocked.entities = [box('wall', 0, 0, { solid: true })];
  assert.ok(validateGameDefinition(blocked).issues.some((e) => e.code === 'blocked_spawn'));
  const sparse = game(); sparse.arena.spawn = Array(2);
  assert.equal(validateGameDefinition(sparse).valid, false);
  sparse.entities = Array(2);
  assert.equal(validateGameDefinition(sparse).valid, false);
});

test('fixed tick replay is deterministic across render frame partitions and snapshots cannot mutate simulation', () => {
  const d = game();
  const a = createGameRuntime(d), b = createGameRuntime(d);
  run(a, 60, { x: 1, z: 1 });
  for (let i = 0; i < 100; i++) b.step(0.01, { x: 1, z: 1 });
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.ok(Math.abs(Math.hypot(a.snapshot().player.x, a.snapshot().player.z) - 3) < 1e-9);
  const snap = a.snapshot(); snap.player.x = 999; snap.variables.score = 999; snap.trace[0].kind = 'win';
  d.arena.playerSpeed = 20;
  assert.notEqual(a.snapshot().player.x, 999); assert.equal(a.snapshot().variables.score, 0);
  assert.equal(a.snapshot().trace[0].kind, 'event');
  assert.deepEqual(a.readState(), a.snapshot());
});

test('movement cannot tunnel through a thin solid or leave arena; frame/input values are bounded', () => {
  const d = game(); d.arena.spawn = [-2, 0]; d.arena.playerSpeed = 20;
  d.entities = [box('wall', 0, 0, { size: [0.1, 1, 8], solid: true })];
  const rt = createGameRuntime(d);
  assert.ok(run(rt, 60, { x: 1, z: 0 }).player.x <= -0.35 + 1e-9);
  assert.ok(run(rt, 100, { x: 0, z: 1 }).player.z <= 9.7 + 1e-9);
  for (const dt of [-1, Infinity, NaN, 1]) assert.throws(() => rt.step(dt, idle), RangeError);
  for (const input of [{ x: 2, z: 0 }, { x: 0, z: NaN }, { x: 0, z: 0, interact: 1 }]) assert.throws(() => rt.step(FIXED_DT, input), TypeError);
});

test('interaction is edge-triggered and ties target the stable ID, not entity array order', () => {
  const d = game();
  d.entities = [box('z-button', 1, 0, { interactable: true }), box('a-button', -1, 0, { interactable: true })];
  d.rules.push(increment({ type: 'interact', entity: 'a-button' }));
  const rt = createGameRuntime(d);
  run(rt, 60, { ...idle, interact: true });
  assert.equal(rt.snapshot().variables.score, 1);
  run(rt, 1); run(rt, 1, { ...idle, interact: true });
  assert.equal(rt.snapshot().variables.score, 2);
  assert.equal(rt.snapshot().trace.filter((e) => e.event === 'interact').every((e) => e.entityId === 'a-button'), true);
});

test('enter fires on transitions, visibility disables triggers, and once remains once after re-entry', () => {
  const d = game(); d.entities = [box('zone', 2, 0, { trigger: true })];
  d.rules.push({ ...increment({ type: 'enter', entity: 'zone' }), once: true });
  const rt = createGameRuntime(d);
  run(rt, 40, { x: 1, z: 0 }); run(rt, 20); run(rt, 40, { x: -1, z: 0 }); run(rt, 40, { x: 1, z: 0 });
  assert.equal(rt.snapshot().variables.score, 1);
  d.entities[0].visible = false;
  assert.equal(run(createGameRuntime(d), 40, { x: 1, z: 0 }).variables.score, 0);
});

test('fast relative motion crossing a small hazard is detected even when endpoints do not overlap', () => {
  const d = game(); d.arena.spawn = [-0.3, 0]; d.arena.playerRadius = 0.2; d.arena.playerSpeed = 20;
  d.entities = [box('hazard', 0.25, 0, { size: [0.1, 1, 0.1], trigger: true, motion: { to: [-1.75, 0], duration: 0.2 } })];
  d.rules.push({ id: 'hit', on: { type: 'enter', entity: 'hazard' }, actions: [{ type: 'lose' }] });
  assert.equal(run(createGameRuntime(d), 1, { x: 1, z: 0 }).status, 'lost');
});

test('teleport cancels stale movement events and reevaluates destination triggers on the next tick', () => {
  const d = game(); d.arena.playerSpeed = 20;
  d.entities = [
    box('portal', 0.5, 0, { size: [0.1, 1, 1], trigger: true }),
    box('old-hazard', 0.65, 0, { size: [0.1, 1, 1], trigger: true }),
    box('destination', 5, 5, { trigger: true }),
    box('destination-button', 6, 5, { interactable: true }),
  ];
  d.rules.push(
    { id: 'travel', on: { type: 'enter', entity: 'portal' }, actions: [{ type: 'teleport', position: [5, 5] }] },
    { id: 'stale-hit', on: { type: 'enter', entity: 'old-hazard' }, actions: [{ type: 'lose' }] },
    increment({ type: 'enter', entity: 'destination' }),
    { id: 'no-carried-input', on: { type: 'interact', entity: 'destination-button' }, actions: [{ type: 'lose' }] },
  );
  const rt = createGameRuntime(d);
  const traveled = run(rt, 1, { x: 1, z: 0, interact: true });
  assert.equal(traveled.status, 'playing'); assert.equal(traveled.player.x, 5);
  assert.equal(traveled.variables.score, 0);
  assert.equal(traveled.trace.some((event) => event.entityId === 'old-hazard'), false);
  assert.equal(run(rt, 1).variables.score, 1);
  assert.equal(run(rt, 5).variables.score, 1);
  // Equal fixed input history, whether delivered separately or in one frame.
  const a = createGameRuntime(d), b = createGameRuntime(d);
  run(a, 2, { x: 1, z: 0 }); b.step(2 * FIXED_DT, { x: 1, z: 0 });
  assert.deepEqual(a.snapshot(), b.snapshot());
});

test('terminal outcome stops actions, future events and all elapsed time; restart creates an independent run', () => {
  const d = game();
  d.rules[0].actions = [{ type: 'add', variable: 'score', value: 1 }, { type: 'win' }, { type: 'set', variable: 'score', value: 999 }];
  const rt = createGameRuntime(d), before = rt.snapshot();
  assert.equal(before.variables.score, 1); assert.equal(before.status, 'won');
  run(rt, 1000, { x: 1, z: 0 }); assert.deepEqual(rt.snapshot(), before);
  assert.deepEqual(createGameRuntime(d).snapshot(), before);
});

test('timer start/stop/repeat semantics and trace buffers stay bounded', () => {
  const d = game();
  d.timers = [{ id: 'pulse', duration: FIXED_DT, repeat: true }];
  d.rules[0].actions.push({ type: 'timer.start', timer: 'pulse' });
  d.rules.push(increment({ type: 'timer', timer: 'pulse' }));
  const rt = createGameRuntime(d);
  run(rt, 300);
  assert.equal(rt.snapshot().variables.score, 300);
  assert.equal(rt.snapshot().trace.length, MINIGAME_LIMITS.trace);
  assert.equal(rt.drainEvents().length, MINIGAME_LIMITS.trace); assert.deepEqual(rt.drainEvents(), []);
  d.rules.push({ id: 'stop', on: { type: 'timer', timer: 'pulse' }, when: [{ variable: 'score', op: 'gte', value: 3 }], actions: [{ type: 'timer.stop', timer: 'pulse' }] });
  const stopped = run(createGameRuntime(d), 50);
  assert.equal(stopped.variables.score, 3); assert.deepEqual(stopped.timers, {});
});

test('authored blocked teleports, solid shows, numeric overflow and action budget fail explicitly', () => {
  const teleport = game(); teleport.entities = [box('wall', 2, 0, { solid: true })];
  teleport.rules[0].actions = [{ type: 'teleport', position: [2, 0] }];
  const teleported = createGameRuntime(teleport).snapshot();
  assert.equal(teleported.status, 'lost'); assert.equal(teleported.player.x, 0);
  const show = game(); show.entities = [box('wall', 0, 0, { solid: true, visible: false })];
  show.rules[0].actions = [{ type: 'show', entity: 'wall' }];
  assert.equal(createGameRuntime(show).snapshot().status, 'lost');
  const overflow = game(); overflow.variables.score = MINIGAME_LIMITS.variableMagnitude;
  overflow.rules[0].actions = [{ type: 'add', variable: 'score', value: 1 }];
  assert.equal(createGameRuntime(overflow).snapshot().status, 'lost');
  const budget = game(); budget.rules = Array.from({ length: 128 }, (_, i) => ({
    id: `rule-${i}`, on: { type: 'start' }, actions: Array.from({ length: 32 }, () => ({ type: 'add', variable: 'score', value: 1 })),
  }));
  const limited = createGameRuntime(budget).snapshot();
  assert.equal(limited.status, 'lost'); assert.equal(limited.variables.score, MINIGAME_LIMITS.actionsPerTick);
  assert.ok(limited.trace.some((entry) => entry.kind === 'limit'));
});
