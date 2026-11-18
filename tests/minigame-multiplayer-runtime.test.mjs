import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateGameDefinition } from '../shared/minigame-protocol.mjs';
import { createGameRuntime, createMultiplayerRuntime, FIXED_DT } from '../shared/minigame-runtime.mjs';

const idle = { x: 0, z: 0 };
const roster = [{ id: 'west-player', slot: 0 }, { id: 'east-player', slot: 1 }];
const example = () => JSON.parse(readFileSync(new URL('../public/minigames/examples/cooperative.json', import.meta.url), 'utf8'));
const box = (id, x, z, extra = {}) => ({ id, shape: 'box', position: [x, 0.5, z], size: [1, 1, 1], material: 'stone', ...extra });
const increment = (on, extra = {}) => ({ id: 'increment', on, actions: [{ type: 'add', variable: 'score', value: 1 }], ...extra });
function game() {
  return { schemaVersion: 2, id: 'cooperative-test', title: 'Cooperative test', description: 'Shared kernel probe.',
    author: 'EarthOnline', version: '1.0.0', players: { min: 2, max: 2 },
    arena: { width: 20, depth: 20, spawns: [[-5, -5], [5, -5]], playerSpeed: 3, playerRadius: 0.3, material: 'concrete' },
    entities: [], variables: { score: 0 }, rules: [{ id: 'start', on: { type: 'start' }, actions: [{ type: 'message', text: 'Ready.' }] }],
  };
}
const runtime = (definition = game(), players = roster) => createMultiplayerRuntime(definition, { players });
function run(rt, frames, inputs = {}) {
  for (let i = 0; i < frames; i++) rt.step(FIXED_DT, inputs);
  return rt.snapshot();
}

test('canonical co-op game is solvable by both players with the shipped replay', () => {
  assert.deepEqual(validateGameDefinition(example()), { valid: true, issues: [] });
  const replay = JSON.parse(readFileSync(new URL('../public/minigames/replays/cooperative-win.json', import.meta.url), 'utf8'));
  const rt = runtime(example(), replay.players);
  for (const step of replay.steps) run(rt, step.frames, step.inputs);
  const state = rt.snapshot();
  assert.equal(state.status, 'won'); assert.deepEqual(state.variables, { west: 1, east: 1 });
  assert.equal(state.tick, 245);
  assert.deepEqual(state.trace.filter((entry) => ['press-west', 'press-east'].includes(entry.ruleId)).map((entry) => entry.playerId), ['west-player', 'east-player']);
  assert.equal(state.entities.find((e) => e.id === 'shared-gate').visible, false);
  const won = rt.snapshot(); run(rt, 120, { 'west-player': { x: -1, z: -1 } });
  assert.deepEqual(rt.snapshot(), won);
});

test('a single active participant cannot press the other switch or pass the shared gate', () => {
  for (const [active, direction] of [['west-player', 1], ['east-player', -1]]) {
    const rt = runtime(example());
    run(rt, 1, { [active]: { ...idle, interact: true } });
    const blocked = run(rt, 240, { [active]: { x: 0, z: 1 } });
    assert.equal(blocked.status, 'playing');
    assert.ok(blocked.players.find((p) => p.id === active).z <= 1.45 + 1e-9);
    assert.equal(blocked.entities.find((e) => e.id === 'shared-gate').visible, true);
    run(rt, 240, { [active]: { x: direction, z: 0 } });
    run(rt, 240, { [active]: { x: 0, z: -1 } });
    run(rt, 1, { [active]: { ...idle, interact: true } });
    const state = rt.snapshot();
    assert.equal(state.variables.west + state.variables.east, 1);
    assert.equal(state.status, 'playing');
  }
});

test('schema 2 is explicit, capacity and every spawn are checked, solo remains a separate mode', () => {
  const d = game();
  assert.throws(() => createGameRuntime(d), /schemaVersion 1/);
  const solo = JSON.parse(readFileSync(new URL('../public/minigames/examples/collect.json', import.meta.url), 'utf8'));
  assert.throws(() => runtime(solo), /schemaVersion 2/);
  for (const players of [2, { min: 1, max: 2 }, { min: 3, max: 2 }, { min: 2.5, max: 3 }, { min: 2, max: 5 }, { min: 2, max: 2, freeJoin: true }]) {
    assert.equal(validateGameDefinition({ ...d, players }).valid, false);
  }
  for (const max of [2, 3, 4]) {
    const expanded = game(); expanded.players.max = max;
    expanded.arena.spawns = Array.from({ length: max }, (_, i) => [-6 + i * 3, -5]);
    const actors = Array.from({ length: max }, (_, slot) => ({ id: `p-${slot}`, slot }));
    assert.equal(runtime(expanded, actors).snapshot().players.length, max);
    expanded.players.min = max;
    assert.equal(runtime(expanded, actors).snapshot().players.length, max);
    if (max > 2) assert.throws(() => runtime(expanded, actors.slice(0, 2)), /player limits/);
  }
  d.arena.spawns[1] = [10, 0];
  assert.ok(validateGameDefinition(d).issues.some((e) => e.path === '/arena/spawns/1' && e.code === 'bounds'));
  d.arena.spawns[1] = [2, 0]; d.entities = [box('solid', 2, 0, { solid: true })];
  assert.ok(validateGameDefinition(d).issues.some((e) => e.path === '/arena/spawns/1' && e.code === 'blocked_spawn'));
  d.arena.spawns.pop();
  assert.ok(validateGameDefinition(d).issues.some((e) => e.code === 'spawn_count'));
  assert.equal(validateGameDefinition({ ...game(), arena: { ...game().arena, spawn: [0, 0] } }).valid, false);
  const sparse = game(); sparse.arena.spawns = Array(2);
  assert.equal(validateGameDefinition(sparse).valid, false);
  assert.throws(() => runtime(sparse), /Invalid minigame definition/);
});

test('actor teleport requires a direct actor event; timer/start never inherit an actor', () => {
  const d = game(); d.entities = [box('button', -4, -5, { interactable: true })];
  d.timers = [{ id: 'clock', duration: 1 }];
  for (const on of [{ type: 'start' }, { type: 'timer', timer: 'clock' }]) {
    d.rules = [{ id: 'move', on, actions: [{ type: 'teleport', target: 'actor', position: [0, 0] }] }];
    assert.ok(validateGameDefinition(d).issues.some((e) => e.code === 'actor_context'));
  }
  d.rules = [{ id: 'move', on: { type: 'interact', entity: 'button' }, actions: [{ type: 'teleport', target: 'actor', position: [0, 0] }] }];
  assert.equal(validateGameDefinition(d).valid, true);
  for (const target of [undefined, 'west-player', 'any', null]) {
    d.rules[0].actions[0].target = target;
    assert.equal(validateGameDefinition(d).valid, false);
  }
});

test('fixed roster rejects duplicate identities, duplicate slots, prototypes and excess capabilities', () => {
  for (const players of [[], [roster[0]], [...roster, { id: 'third', slot: 2 }],
    [{ id: 'same', slot: 0 }, { id: 'same', slot: 1 }],
    [{ id: 'a', slot: 0 }, { id: 'b', slot: 0 }],
    [{ id: 'a', slot: -1 }, roster[1]], [{ id: 'a', slot: 0.5 }, roster[1]],
    [roster[0], { id: 'b', slot: 2 }], [Object.create({ id: 'a', slot: 0 }), roster[1]],
    [{ ...roster[0], x: 100 }, roster[1]]]) assert.throws(() => runtime(game(), players));
  for (const id of ['__proto__', 'prototype', 'constructor', '', 'x'.repeat(81), 'a/b', 'a.b']) {
    assert.throws(() => runtime(game(), [{ id, slot: 0 }, roster[1]]));
  }
  assert.throws(() => createMultiplayerRuntime(game(), { players: roster, lateJoin: true }));
  assert.throws(() => createMultiplayerRuntime(game(), Object.create({ players: roster })));
  const d = game(); d.variables = JSON.parse('{"__proto__":1}');
  assert.throws(() => runtime(d));
  assert.equal({}.polluted, undefined);
});

test('inputs cannot impersonate a nonmember or mutate state before the whole batch validates', () => {
  const rt = runtime(), before = rt.snapshot();
  for (const inputs of [null, [], Object.create({ 'west-player': idle }),
    { outsider: idle }, { 'west-player': { x: 1, z: 0 }, outsider: idle },
    JSON.parse('{"__proto__":{"x":0,"z":0}}'), JSON.parse('{"constructor":{"x":0,"z":0}}'),
    { 'west-player': { x: 0, z: 0, position: [5, 5] } },
    { 'west-player': { x: 1, z: 0 }, 'east-player': { x: NaN, z: 0 } }]) {
    assert.throws(() => rt.step(FIXED_DT, inputs)); assert.deepEqual(rt.snapshot(), before);
  }
  for (const dt of [-1, NaN, Infinity, 1]) {
    assert.throws(() => rt.step(dt, { 'west-player': { ...idle, interact: true } }));
    assert.deepEqual(rt.snapshot(), before);
  }
  run(rt, 60, { 'west-player': { x: 1, z: 0 } });
  assert.equal(rt.snapshot().players[1].x, 5);
  const previous = rt.snapshot().players[0].x;
  run(rt, 60); assert.equal(rt.snapshot().players[0].x, previous);
});

test('same-tick pickup is counted once; stable slot order is independent of roster or input order', () => {
  const d = game(); d.arena.spawns = [[-0.8, 0], [0.8, 0]]; d.arena.playerSpeed = 20;
  d.entities = [box('item', 0, 0, { size: [0.4, 1, 0.4], trigger: true })];
  d.rules = [{ ...increment({ type: 'enter', entity: 'item' }), actions: [
    { type: 'add', variable: 'score', value: 1 }, { type: 'hide', entity: 'item' },
  ] }];
  const a = runtime(d), b = runtime(d, [...roster].reverse());
  a.step(FIXED_DT, { 'west-player': { x: 1, z: 0 }, 'east-player': { x: -1, z: 0 } });
  b.step(FIXED_DT, { 'east-player': { x: -1, z: 0 }, 'west-player': { x: 1, z: 0 } });
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().variables.score, 1);
  assert.equal(a.snapshot().trace.find((entry) => entry.ruleId === 'increment').playerId, 'west-player');
  // once is global to the room even when the shared entity remains visible.
  d.rules[0] = increment({ type: 'enter', entity: 'item' }, { once: true });
  const once = runtime(d); run(once, 1, { 'west-player': { x: 1, z: 0 }, 'east-player': { x: -1, z: 0 } });
  assert.equal(once.snapshot().variables.score, 1);
});

test('interact edges are independent for each actor and hidden shared buttons cannot be double-pressed', () => {
  const d = game(); d.arena.spawns = [[-0.5, 0], [0.5, 0]];
  d.entities = [box('button', 0, 0, { interactable: true })];
  d.rules = [increment({ type: 'interact', entity: 'button' })];
  const rt = runtime(d), both = Object.fromEntries(roster.map(({ id }) => [id, { ...idle, interact: true }]));
  run(rt, 60, both); assert.equal(rt.snapshot().variables.score, 2);
  run(rt, 1, { 'east-player': { ...idle, interact: true } });
  run(rt, 1, both); assert.equal(rt.snapshot().variables.score, 3);
  d.rules[0].actions.push({ type: 'hide', entity: 'button' });
  assert.equal(run(runtime(d), 1, both).variables.score, 1);
});

test('four actors share one clock, motion pass and frame accumulator', () => {
  const d = game(); d.players.max = 4; d.arena.spawns = [[-6, -5], [-2, -5], [2, -5], [6, -5]];
  d.entities = [box('moving', -3, 2, { trigger: true, motion: { to: [3, 2], duration: 3 } })];
  d.timers = [{ id: 'pulse', duration: 1, repeat: true, autoStart: true }];
  d.rules.push(increment({ type: 'timer', timer: 'pulse' }));
  const players = Array.from({ length: 4 }, (_, slot) => ({ id: `player-${slot}`, slot }));
  const a = runtime(d, players), b = runtime(d, [...players].reverse());
  run(a, 60);
  for (let i = 0; i < 100; i++) b.step(0.01, {});
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.equal(a.snapshot().elapsed, 1); assert.equal(a.snapshot().variables.score, 1);
  assert.equal(a.snapshot().entities[0].x, -1);
  assert.equal(a.snapshot().trace.find((e) => e.event === 'timer').playerId, undefined);
});

test('actor teleport only moves its source, cancels its stale events, and preserves another actor events', () => {
  const d = game(); d.arena.spawns = [[0, 0], [0, 3]]; d.arena.playerSpeed = 20;
  d.entities = [box('portal', 0.5, 0, { size: [0.1, 1, 1], trigger: true }),
    box('old-hazard', 0.65, 0, { size: [0.1, 1, 1], trigger: true }),
    box('other-zone', 0.5, 3, { size: [0.1, 1, 1], trigger: true })];
  d.rules = [
    { id: 'travel', on: { type: 'enter', entity: 'portal' }, actions: [{ type: 'teleport', target: 'actor', position: [5, 5] }] },
    { id: 'hit', on: { type: 'enter', entity: 'old-hazard' }, actions: [{ type: 'lose' }] },
    increment({ type: 'enter', entity: 'other-zone' }),
  ];
  const state = run(runtime(d), 1, Object.fromEntries(roster.map(({ id }) => [id, { x: 1, z: 0 }])));
  assert.equal(state.status, 'playing'); assert.equal(state.players[0].x, 5);
  assert.ok(state.players[1].x < 1); assert.equal(state.variables.score, 1);
  assert.equal(state.trace.find((e) => e.ruleId === 'increment').playerId, 'east-player');
});

test('all-player teleport cancels every stale movement event and buffers destination triggers until next tick', () => {
  const d = game(); d.arena.spawns = [[0, 0], [0, 3]]; d.arena.playerSpeed = 20;
  d.entities = [box('portal', 0.5, 0, { size: [0.1, 1, 1], trigger: true }),
    box('old-hazard', 0.5, 3, { size: [0.1, 1, 1], trigger: true }), box('destination', 5, 5, { trigger: true }),
    box('button', 6, 5, { interactable: true })];
  d.rules = [
    { id: 'travel', on: { type: 'enter', entity: 'portal' }, actions: [{ type: 'teleport', target: 'all', position: [5, 5] }] },
    { id: 'hit', on: { type: 'enter', entity: 'old-hazard' }, actions: [{ type: 'lose' }] },
    increment({ type: 'enter', entity: 'destination' }),
    { id: 'old-input', on: { type: 'interact', entity: 'button' }, actions: [{ type: 'lose' }] },
  ];
  const rt = runtime(d);
  const before = run(rt, 1, Object.fromEntries(roster.map(({ id }) => [id, { x: 1, z: 0, interact: true }])));
  assert.equal(before.status, 'playing'); assert.ok(before.players.every((p) => p.x === 5 && p.z === 5));
  assert.equal(before.variables.score, 0);
  assert.equal(run(rt, 1).variables.score, 2); assert.equal(run(rt, 1).variables.score, 2);
});

test('show checks every actor and blocked all-player teleports are atomic', () => {
  const d = game();
  d.entities = [box('hidden', 5, -5, { solid: true, visible: false })];
  d.rules[0].actions = [{ type: 'show', entity: 'hidden' }];
  const shown = runtime(d).snapshot(); assert.equal(shown.status, 'lost');
  assert.equal(shown.entities[0].visible, false);
  d.entities[0].position = [0, 0.5, 0]; d.entities[0].visible = true;
  d.rules[0].actions = [{ type: 'teleport', target: 'all', position: [0, 0] }];
  const teleported = runtime(d).snapshot(); assert.equal(teleported.status, 'lost');
  assert.deepEqual(teleported.players.map((p) => [p.x, p.z]), d.arena.spawns);
});

test('timer started by one actor is shared and does not retain that actor in its trace', () => {
  const d = game(); d.entities = [box('button', -4, -5, { interactable: true })];
  d.timers = [{ id: 'delay', duration: FIXED_DT }];
  d.rules = [
    { id: 'press', on: { type: 'interact', entity: 'button' }, actions: [{ type: 'timer.start', timer: 'delay' }] },
    { id: 'move', on: { type: 'timer', timer: 'delay' }, actions: [{ type: 'teleport', target: 'all', position: [0, 0] }] },
  ];
  const rt = runtime(d); run(rt, 1, { 'west-player': { ...idle, interact: true } });
  assert.equal(rt.snapshot().players[0].x, -5);
  const state = run(rt, 1);
  assert.ok(state.players.every((p) => p.x === 0 && p.z === 0));
  assert.equal(state.trace.find((e) => e.ruleId === 'press').playerId, 'west-player');
  assert.equal(state.trace.find((e) => e.ruleId === 'move').playerId, undefined);
});

test('actor collision and arena constraints apply independently without player-player obstruction', () => {
  const d = game(); d.arena.spawns = [[-2, -1], [2, 1]]; d.arena.playerSpeed = 20;
  d.entities = [box('wall', 0, 0, { size: [0.1, 1, 8], solid: true })];
  const rt = runtime(d); const stopped = run(rt, 60, { 'west-player': { x: 1, z: 0 }, 'east-player': { x: -1, z: 0 } });
  assert.ok(stopped.players[0].x <= -0.35 + 1e-9); assert.ok(stopped.players[1].x >= 0.35 - 1e-9);
  const edges = run(rt, 60, { 'west-player': { x: 0, z: -1 }, 'east-player': { x: 0, z: 1 } });
  assert.ok(edges.players.every((p) => Math.abs(p.z) <= 9.7 + 1e-9));
  d.entities = []; const cross = run(runtime(d), 12, { 'west-player': { x: 1, z: 0 }, 'east-player': { x: -1, z: 0 } });
  assert.ok(cross.players[0].x > 0); assert.ok(cross.players[1].x < 0);
});

test('roster, definitions and returned player snapshots are isolated; not stepping pauses all shared time', () => {
  const d = game(), players = structuredClone(roster), rt = runtime(d, players);
  d.arena.spawns[0][0] = 9; players[0].id = 'forged'; players.reverse();
  const first = rt.snapshot(); first.players[0].x = 99; first.variables.score = 99; first.trace[0].kind = 'win';
  assert.equal(rt.snapshot().players[0].id, 'west-player'); assert.equal(rt.snapshot().players[0].x, -5);
  assert.equal(rt.snapshot().variables.score, 0);
  const paused = rt.snapshot(); assert.deepEqual(rt.snapshot(), paused); assert.deepEqual(rt.readState(), paused);
  const restart = runtime(); assert.deepEqual(restart.snapshot(), rt.snapshot());
});
