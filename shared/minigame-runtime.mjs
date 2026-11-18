import { MINIGAME_LIMITS, validateGameDefinition } from './minigame-protocol.mjs';

export const FIXED_DT = 1 / 60;
export const MINIGAME_RUNTIME_VERSION = 'rules-3.0.0';
export const MINIGAME_COMPATIBLE_REPLAY_VERSIONS = Object.freeze(['rules-2.0.0', MINIGAME_RUNTIME_VERSION]);
export const MINIGAME_CHECKPOINT_VERSION = 1;
const EPSILON = 1e-10;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const durationTicks = (n) => Math.max(1, Math.ceil(n / FIXED_DT - EPSILON));
const compare = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b,
  lt: (a, b) => a < b, lte: (a, b) => a <= b,
  gt: (a, b) => a > b, gte: (a, b) => a >= b,
};
const footprintDistanceSquared = (x, z, e) => {
  const dx = Math.max(0, Math.abs(x - e.x) - e.definition.size[0] / 2);
  const dz = Math.max(0, Math.abs(z - e.z) - e.definition.size[2] / 2);
  return dx * dx + dz * dz;
};

// Minimum distance of a moving point to a rectangle. Split where either axis
// crosses a face; squared distance is quadratic in each resulting interval.
function sweptOverlap(x0, z0, x1, z1, e, radius) {
  const ax = x0 - e.previousX, az = z0 - e.previousZ;
  const bx = x1 - e.x - ax, bz = z1 - e.z - az;
  const hx = e.definition.size[0] / 2, hz = e.definition.size[2] / 2;
  const breaks = [0, 1];
  for (const [a, b, h] of [[ax, bx, hx], [az, bz, hz]]) {
    if (Math.abs(b) < EPSILON) continue;
    for (const boundary of [-h, h]) {
      const t = (boundary - a) / b;
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((a, b) => a - b);
  const distance = (t) => Math.max(0, Math.abs(ax + bx * t) - hx) ** 2
    + Math.max(0, Math.abs(az + bz * t) - hz) ** 2;
  for (let i = 0; i < breaks.length - 1; i++) {
    const lo = breaks[i], hi = breaks[i + 1], mid = (lo + hi) / 2;
    const coefficients = (a, b, h) => a + b * mid < -h ? [a + h, b]
      : a + b * mid > h ? [a - h, b] : [0, 0];
    const [cx, dx] = coefficients(ax, bx, hx), [cz, dz] = coefficients(az, bz, hz);
    const denominator = dx * dx + dz * dz;
    const t = denominator ? clamp(-(cx * dx + cz * dz) / denominator, lo, hi) : lo;
    if (distance(t) <= radius * radius + EPSILON || distance(hi) <= radius * radius + EPSILON) return true;
  }
  return false;
}

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const safePlayerId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) && !reserved.has(id);
const idle = Object.freeze({ x: 0, z: 0 });
const invalidOptions = (path, message) => Object.assign(new TypeError(message), {
  issues: [{ path, code: 'runtime_options', message }],
});
function checkedDefinition(input, schemaVersion) {
  const validation = validateGameDefinition(input);
  if (!validation.valid) throw Object.assign(new Error('Invalid minigame definition.'), { issues: validation.issues });
  if (input.schemaVersion !== schemaVersion && !(schemaVersion === 2 && input.schemaVersion === 3)) throw invalidOptions('/schemaVersion', `This runtime requires schemaVersion ${schemaVersion}${schemaVersion === 2 ? ' or 3' : ''}.`);
  return structuredClone(input);
}
function checkInput(input) {
  if (!plain(input) || Object.keys(input).some((key) => !['x', 'z', 'interact'].includes(key))
    || !Number.isFinite(input.x) || !Number.isFinite(input.z)
    || Math.abs(input.x) > 1 || Math.abs(input.z) > 1
    || (input.interact !== undefined && typeof input.interact !== 'boolean')) {
    throw new TypeError('Input requires only x/z in [-1,1] and an optional boolean interact.');
  }
}

const canonicalJson = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
// Deterministic definition identity, NOT authentication. The owner service must
// authorize and integrity-protect persisted checkpoints; never accept client state.
function fingerprint(definition) {
  const source = canonicalJson(definition);
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < source.length; i++) {
    a = Math.imul(a ^ source.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ source.charCodeAt(i), 0x85ebca6b);
  }
  return `${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

function checkedCheckpoint(definition, value, multiplayer) {
  const fail = path => { throw Object.assign(new TypeError(`Invalid minigame checkpoint at ${path}.`), {
    code: 'invalid_checkpoint', issues: [{ path, code: 'invalid_checkpoint', message: 'Checkpoint does not match the definition, version or bounded runtime state.' }],
  }); };
  const object = (v, keys, path, exact = true) => {
    if (!plain(v) || Object.keys(v).some(key => !keys.includes(key)) || exact && Object.keys(v).length !== keys.length) fail(path);
  };
  const number = (v, min, max, path, integer = false) => {
    if (!Number.isFinite(v) || v < min || v > max || integer && !Number.isSafeInteger(v)) fail(path);
  };
  const boolean = (v, path) => { if (typeof v !== 'boolean') fail(path); };
  const array = (v, min, max, path) => { if (!Array.isArray(v) || v.length < min || v.length > max || Object.keys(v).length !== v.length) fail(path); };
  const unique = (values, valid, path) => {
    array(values, 0, valid.size, path);
    if (new Set(values).size !== values.length || values.some(id => !valid.has(id))) fail(path);
  };
  const maxTick = MINIGAME_LIMITS.sessionSeconds * 60;
  object(value, ['checkpointVersion', 'runtimeVersion', 'definitionFingerprint', 'mode', 'tick', 'accumulator', 'status', 'message',
    'sequence', 'actionsThisTick', 'variables', 'firedOnce', 'players', 'entities', 'timers', 'trace', 'pendingEvents'], '');
  if (value.checkpointVersion !== MINIGAME_CHECKPOINT_VERSION || value.runtimeVersion !== MINIGAME_RUNTIME_VERSION
    || value.definitionFingerprint !== fingerprint(definition) || value.mode !== (multiplayer ? 'roster' : 'solo')) fail('/version');
  number(value.tick, 0, maxTick, '/tick', true);
  if (!['playing', 'won', 'lost'].includes(value.status) || value.status === 'playing' && value.tick >= maxTick) fail('/status');
  number(value.accumulator, 0, value.status === 'playing' ? FIXED_DT : .25, '/accumulator');
  if (value.status === 'playing' && value.accumulator >= FIXED_DT) fail('/accumulator');
  number(value.sequence, 1, Number.MAX_SAFE_INTEGER, '/sequence', true);
  number(value.actionsThisTick, 0, MINIGAME_LIMITS.actionsPerTick + 1, '/actionsThisTick', true);
  if (value.message !== null && (typeof value.message !== 'string' || value.message.length > 240)) fail('/message');
  const variableIds = Object.keys(definition.variables);
  object(value.variables, variableIds, '/variables');
  for (const id of variableIds) number(value.variables[id], -MINIGAME_LIMITS.variableMagnitude, MINIGAME_LIMITS.variableMagnitude, `/variables/${id}`);
  unique(value.firedOnce, new Set(definition.rules.filter(rule => rule.once).map(rule => rule.id)), '/firedOnce');

  array(value.entities, definition.entities.length, definition.entities.length, '/entities');
  const entityMap = new Map();
  value.entities.forEach((entity, index) => {
    const path = `/entities/${index}`, source = definition.entities[index];
    object(entity, ['id', 'visible', 'x', 'y', 'z', 'previousX', 'previousZ'], path);
    if (entity.id !== source.id) fail(`${path}/id`);
    boolean(entity.visible, `${path}/visible`);
    const position = tick => {
      if (!source.motion) return [source.position[0], source.position[2]];
      const duration = durationTicks(source.motion.duration), phase = (tick % (2 * duration)) / duration;
      const progress = phase <= 1 ? phase : 2 - phase;
      return [source.position[0] + (source.motion.to[0] - source.position[0]) * progress,
        source.position[2] + (source.motion.to[1] - source.position[2]) * progress];
    };
    const [x, z] = position(value.tick), [previousX, previousZ] = position(Math.max(0, value.tick - 1));
    for (const [key, expected] of Object.entries({ x, z, previousX, previousZ, y: source.position[1] })) {
      if (!Number.isFinite(entity[key]) || Math.abs(entity[key] - expected) > EPSILON) fail(`${path}/${key}`);
    }
    entityMap.set(entity.id, { ...entity, definition: source });
  });
  const ids = new Set(), slots = new Set(), triggerIds = new Set(definition.entities.filter(entity => entity.trigger).map(entity => entity.id));
  const limits = multiplayer ? definition.players : { min: 1, max: 1 };
  array(value.players, limits.min, limits.max, '/players');
  let lastSlot = -1;
  value.players.forEach((player, index) => {
    const path = `/players/${index}`;
    object(player, ['id', 'slot', 'x', 'z', 'yaw', 'inside', 'interactHeld', 'pendingInteract', 'teleportEpoch'], path);
    if (!safePlayerId(player.id) || ids.has(player.id) || !multiplayer && player.id !== 'player') fail(`${path}/id`);
    number(player.slot, 0, limits.max - 1, `${path}/slot`, true);
    if (slots.has(player.slot) || player.slot <= lastSlot) fail(`${path}/slot`);
    lastSlot = player.slot; ids.add(player.id); slots.add(player.slot);
    const radius = definition.arena.playerRadius;
    number(player.x, -definition.arena.width / 2 + radius, definition.arena.width / 2 - radius, `${path}/x`);
    number(player.z, -definition.arena.depth / 2 + radius, definition.arena.depth / 2 - radius, `${path}/z`);
    number(player.yaw, -Math.PI, Math.PI, `${path}/yaw`);
    number(player.teleportEpoch, 0, Number.MAX_SAFE_INTEGER, `${path}/teleportEpoch`, true);
    boolean(player.interactHeld, `${path}/interactHeld`); boolean(player.pendingInteract, `${path}/pendingInteract`);
    unique(player.inside, triggerIds, `${path}/inside`);
    if ([...entityMap.values()].some(entity => entity.visible && entity.definition.solid
      && footprintDistanceSquared(player.x, player.z, entity) < radius * radius - EPSILON)) fail(`${path}/position`);
  });
  const sources = definition.timers ?? [];
  array(value.timers, sources.length, sources.length, '/timers');
  value.timers.forEach((timer, index) => {
    const path = `/timers/${index}`, duration = durationTicks(sources[index].duration);
    object(timer, ['id', 'duration', 'remaining', 'active', 'startedAt'], path);
    if (timer.id !== sources[index].id || timer.duration !== duration) fail(path);
    number(timer.remaining, 0, duration, `${path}/remaining`, true);
    number(timer.startedAt, 0, value.tick, `${path}/startedAt`, true);
    boolean(timer.active, `${path}/active`);
    if (value.status === 'playing' && timer.active && timer.remaining === 0) fail(`${path}/remaining`);
  });
  const rules = new Set(definition.rules.map(rule => rule.id)), timers = new Set(sources.map(timer => timer.id));
  array(value.trace, Math.min(value.sequence, MINIGAME_LIMITS.trace), Math.min(value.sequence, MINIGAME_LIMITS.trace), '/trace');
  value.trace.forEach((entry, index) => {
    const path = `/trace/${index}`;
    if (!plain(entry) || !['event', 'rule', 'message', 'win', 'lose', 'limit'].includes(entry.kind)) fail(path);
    object(entry, ['seq', 'tick', 'time', 'kind', ...(multiplayer ? ['playerId'] : []),
      ...(entry.kind === 'event' ? ['event', 'entityId', 'timerId'] : entry.kind === 'rule' ? ['ruleId'] : ['message', 'limit'].includes(entry.kind) ? ['text'] : [])], path, false);
    if (entry.seq !== value.sequence - value.trace.length + index + 1) fail(`${path}/seq`);
    number(entry.tick, 0, value.tick, `${path}/tick`, true);
    if (entry.time !== entry.tick * FIXED_DT || index && entry.tick < value.trace[index - 1].tick) fail(`${path}/time`);
    if (Object.hasOwn(entry, 'playerId') && !ids.has(entry.playerId)) fail(`${path}/playerId`);
    if (entry.kind === 'rule' && !rules.has(entry.ruleId)) fail(`${path}/ruleId`);
    if (['message', 'limit'].includes(entry.kind) && (typeof entry.text !== 'string' || entry.text.length > 240)) fail(`${path}/text`);
    if (entry.kind === 'event') {
      if (!['start', 'enter', 'interact', 'timer'].includes(entry.event)) fail(`${path}/event`);
      if (['enter', 'interact'].includes(entry.event)) {
        if (!entityMap.has(entry.entityId) || Object.hasOwn(entry, 'timerId')) fail(path);
      } else if (entry.event === 'timer') {
        if (!timers.has(entry.timerId) || Object.hasOwn(entry, 'entityId') || Object.hasOwn(entry, 'playerId')) fail(path);
      } else if (Object.hasOwn(entry, 'entityId') || Object.hasOwn(entry, 'timerId') || Object.hasOwn(entry, 'playerId')) fail(path);
    }
  });
  array(value.pendingEvents, 0, value.trace.length, '/pendingEvents');
  const pendingStart = value.trace.length - value.pendingEvents.length;
  value.pendingEvents.forEach((entry, index) => {
    if (canonicalJson(entry) !== canonicalJson(value.trace[pendingStart + index])) fail(`/pendingEvents/${index}`);
  });
  return structuredClone(value);
}

/** One interpreter for solo and cooperative games. Transport owns roster admission,
 * connection state and pausing; the kernel never reads wall time or city state. */
function createRuntimeKernel(definition, roster, multiplayer, restored) {
  const definitionFingerprint = fingerprint(definition);
  const { arena } = definition;
  const radius = arena.playerRadius;
  const variables = { ...definition.variables };
  const entities = definition.entities.map((e) => ({
    id: e.id, definition: e, visible: e.visible !== false,
    x: e.position[0], y: e.position[1], z: e.position[2],
    previousX: e.position[0], previousZ: e.position[2],
  }));
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const timers = new Map((definition.timers ?? []).map((t) => [t.id, {
    definition: t, duration: durationTicks(t.duration), remaining: durationTicks(t.duration),
    active: t.autoStart === true, startedAt: 0,
  }]));
  const players = roster.map(({ id, slot }) => {
    const spawn = multiplayer ? arena.spawns[slot] : arena.spawn;
    return { id, slot, x: spawn[0], z: spawn[1], yaw: 0,
      inside: new Set(), interactHeld: false, pendingInteract: false, teleportEpoch: 0 };
  });
  const firedOnce = new Set();
  let tick = 0, accumulator = 0, status = 'playing', message = null;
  let sequence = 0, actionsThisTick = 0;
  const trace = [], pendingEvents = [];
  function record(entry, actor) {
    const full = { seq: ++sequence, tick, time: tick * FIXED_DT, ...entry,
      ...(multiplayer && actor ? { playerId: actor.id } : {}) };
    trace.push(full); pendingEvents.push(full);
    if (trace.length > MINIGAME_LIMITS.trace) trace.shift();
    if (pendingEvents.length > MINIGAME_LIMITS.trace) pendingEvents.shift();
  }
  function terminate(next, actor) {
    if (status !== 'playing') return;
    status = next;
    record({ kind: next === 'won' ? 'win' : 'lose' }, actor);
  }
  function failLimit(text, actor) {
    message = text; record({ kind: 'limit', text }, actor); terminate('lost', actor);
  }
  function blocked(x, z) {
    return entities.some((e) => e.visible && e.definition.solid
      && footprintDistanceSquared(x, z, e) < radius * radius - EPSILON);
  }
  function action(a, actor) {
    if (++actionsThisTick > MINIGAME_LIMITS.actionsPerTick) { failLimit('Action budget exceeded.', actor); return; }
    switch (a.type) {
      case 'add': case 'set': {
        const value = a.type === 'add' ? variables[a.variable] + a.value : a.value;
        if (!Number.isFinite(value) || Math.abs(value) > MINIGAME_LIMITS.variableMagnitude) failLimit(`Variable ${a.variable} exceeded its numeric limit.`, actor);
        else variables[a.variable] = value;
        break;
      }
      case 'hide': {
        const entity = entityById.get(a.entity);
        entity.visible = false;
        for (const player of players) player.inside.delete(entity.id);
        break;
      }
      case 'show': {
        const entity = entityById.get(a.entity);
        if (!entity.visible && entity.definition.solid && players.some((player) => footprintDistanceSquared(player.x, player.z, entity) < radius * radius - EPSILON)) failLimit(`Cannot show solid ${a.entity} on a player.`, actor);
        else entity.visible = true;
        break;
      }
      case 'teleport': {
        // All destinations are checked before any actor changes position. Players
        // intentionally do not block one another in this cooperative protocol.
        if (blocked(a.position[0], a.position[1])) { failLimit('Teleport destination is blocked.', actor); break; }
        const targets = !multiplayer ? players : a.target === 'all' ? players : [actor];
        for (const player of targets) {
          player.x = a.position[0]; player.z = a.position[1]; player.inside.clear();
          player.teleportEpoch++; player.pendingInteract = false;
        }
        break;
      }
      case 'message': message = a.text; record({ kind: 'message', text: a.text }, actor); break;
      case 'timer.start': {
        const timer = timers.get(a.timer);
        timer.active = true; timer.remaining = timer.duration; timer.startedAt = tick; break;
      }
      case 'timer.stop': timers.get(a.timer).active = false; break;
      case 'win': terminate('won', actor); break;
      case 'lose': terminate('lost', actor); break;
    }
  }
  function dispatch(event, actor) {
    if (status !== 'playing') return;
    record({ kind: 'event', event: event.type, ...(event.entity ? { entityId: event.entity } : {}), ...(event.timer ? { timerId: event.timer } : {}) }, actor);
    for (const rule of definition.rules) {
      if (status !== 'playing') break;
      if (rule.on.type !== event.type || rule.on.entity !== event.entity || rule.on.timer !== event.timer) continue;
      if (rule.once && firedOnce.has(rule.id)) continue;
      if (!(rule.when ?? []).every((c) => compare[c.op](variables[c.variable], c.value))) continue;
      if (rule.once) firedOnce.add(rule.id);
      record({ kind: 'rule', ruleId: rule.id }, actor);
      for (const a of rule.actions) {
        if (status !== 'playing') break;
        action(a, actor);
      }
    }
  }
  function moveAxis(player, axis, amount) {
    const other = axis === 'x' ? 'z' : 'x';
    const sizeAxis = axis === 'x' ? 0 : 2, sizeOther = axis === 'x' ? 2 : 0;
    const limit = (axis === 'x' ? arena.width : arena.depth) / 2 - radius;
    const start = player[axis];
    let end = clamp(start + amount, -limit, limit);
    for (const e of entities) {
      if (!e.visible || !e.definition.solid) continue;
      const gap = Math.max(0, Math.abs(player[other] - e[other]) - e.definition.size[sizeOther] / 2);
      if (gap >= radius) continue;
      const clearance = Math.sqrt(radius * radius - gap * gap);
      const lo = e[axis] - e.definition.size[sizeAxis] / 2 - clearance;
      const hi = e[axis] + e.definition.size[sizeAxis] / 2 + clearance;
      if (end > start && start <= lo + EPSILON && end > lo) end = Math.max(start, lo);
      else if (end < start && start >= hi - EPSILON && end < hi) end = Math.min(start, hi);
    }
    player[axis] = end;
  }
  function fixedStep(inputs) {
    tick++;
    actionsThisTick = 0;
    for (const e of entities) {
      e.previousX = e.x; e.previousZ = e.z;
      const motion = e.definition.motion;
      if (!motion) continue;
      const duration = durationTicks(motion.duration);
      const phase = (tick % (2 * duration)) / duration;
      const progress = phase <= 1 ? phase : 2 - phase;
      e.x = e.definition.position[0] + (motion.to[0] - e.definition.position[0]) * progress;
      e.z = e.definition.position[2] + (motion.to[1] - e.definition.position[2]) * progress;
    }
    // Movement is a shared phase. A switch pressed by slot 0 cannot change how
    // slot 1 collided earlier in the same tick; new geometry applies next tick.
    const movements = players.map((player, index) => {
      const input = inputs[index];
      const movement = { player, oldX: player.x, oldZ: player.z, epoch: player.teleportEpoch, enter: [] };
      const length = Math.max(1, Math.hypot(input.x, input.z));
      const x = input.x / length, z = input.z / length;
      if (x !== 0 || z !== 0) player.yaw = Math.atan2(x, z);
      moveAxis(player, 'x', x * arena.playerSpeed * FIXED_DT);
      moveAxis(player, 'z', z * arena.playerSpeed * FIXED_DT);
      const nextInside = new Set();
      for (const e of entities) {
        if (!e.visible || !e.definition.trigger) continue;
        if (footprintDistanceSquared(player.x, player.z, e) <= radius * radius + EPSILON) nextInside.add(e.id);
        if (!player.inside.has(e.id) && sweptOverlap(movement.oldX, movement.oldZ, player.x, player.z, e, radius)) movement.enter.push(e.id);
      }
      player.inside = nextInside;
      return movement;
    });
    for (const movement of movements) {
      const player = movement.player;
      for (const id of movement.enter) {
        if (player.teleportEpoch !== movement.epoch) break;
        // Shared hide/once effects are visible immediately to later actors.
        if (entityById.get(id).visible) dispatch({ type: 'enter', entity: id }, player);
        if (status !== 'playing') return;
      }
    }
    for (const player of players) {
      if (!player.pendingInteract) continue;
      player.pendingInteract = false;
      const targets = entities.filter((e) => e.visible && e.definition.interactable)
        .map((e) => ({ e, distance: footprintDistanceSquared(player.x, player.z, e) }))
        .filter((target) => target.distance <= MINIGAME_LIMITS.interactDistance ** 2)
        .sort((a, b) => a.distance - b.distance || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
      if (targets[0]) dispatch({ type: 'interact', entity: targets[0].e.id }, player);
      if (status !== 'playing') return;
    }
    // One shared timer pass. Timer events have no actor, even when an actor
    // started the timer; explicit target:all is required for timer teleports.
    const due = [];
    for (const [id, timer] of timers) {
      if (!timer.active || timer.startedAt === tick) continue;
      if (--timer.remaining === 0) due.push(id);
    }
    for (const id of due) {
      const timer = timers.get(id);
      if (!timer.active || timer.remaining !== 0) continue;
      if (timer.definition.repeat) timer.remaining = timer.duration;
      else timer.active = false;
      dispatch({ type: 'timer', timer: id });
      if (status !== 'playing') return;
    }
    if (tick >= MINIGAME_LIMITS.sessionSeconds * 60) failLimit('Maximum session duration reached.');
  }
  const progress = () => ({ tick, elapsed: tick * FIXED_DT, status });
  function dynamicSnapshot() {
    const playerStates = players.map(({ id, slot, x, z, yaw }) => ({ id, slot, x, z, yaw }));
    return {
      tick, elapsed: tick * FIXED_DT, status,
      players: playerStates,
      variables: { ...variables },
      entities: entities.map(({ id, visible, x, y, z }) => ({ id, visible, x, y, z })),
      timers: Object.fromEntries([...timers].filter(([, t]) => t.active).map(([id, t]) => [id, t.remaining * FIXED_DT])),
      message,
    };
  }
  function snapshot() {
    const dynamic = dynamicSnapshot();
    if (!multiplayer) {
      const { x, z, yaw } = dynamic.players[0];
      delete dynamic.players;
      dynamic.player = { x, z, yaw };
    }
    return { ...dynamic, trace: trace.map((entry) => ({ ...entry })) };
  }
  function checkpoint() {
    return {
      checkpointVersion: MINIGAME_CHECKPOINT_VERSION, runtimeVersion: MINIGAME_RUNTIME_VERSION,
      definitionFingerprint, mode: multiplayer ? 'roster' : 'solo',
      tick, accumulator, status, message, sequence, actionsThisTick,
      variables: { ...variables }, firedOnce: [...firedOnce],
      players: players.map(({ inside, ...player }) => ({ ...player, inside: [...inside] })),
      entities: entities.map(({ definition: _definition, ...entity }) => ({ ...entity })),
      timers: [...timers].map(([id, { definition: _definition, ...timer }]) => ({ id, ...timer })),
      trace: trace.map(entry => ({ ...entry })), pendingEvents: pendingEvents.map(entry => ({ ...entry })),
    };
  }
  if (restored) {
    ({ tick, accumulator, status, message, sequence, actionsThisTick } = restored);
    Object.assign(variables, restored.variables);
    for (const id of restored.firedOnce) firedOnce.add(id);
    players.forEach((player, index) => Object.assign(player, restored.players[index], { inside: new Set(restored.players[index].inside) }));
    entities.forEach((entity, index) => Object.assign(entity, restored.entities[index]));
    for (const { id, ...timer } of restored.timers) Object.assign(timers.get(id), timer);
    trace.push(...restored.trace); pendingEvents.push(...restored.pendingEvents);
  } else dispatch({ type: 'start' });
  return Object.freeze({
    advance(dt, inputs) {
      if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || dt > 0.25) throw new RangeError('step dt must be finite and between 0 and 0.25 seconds.');
      if (status !== 'playing') return progress();
      players.forEach((player, index) => {
        if (inputs[index].interact && !player.interactHeld) player.pendingInteract = true;
        player.interactHeld = inputs[index].interact === true;
      });
      accumulator += dt;
      while (accumulator + EPSILON >= FIXED_DT && status === 'playing') {
        accumulator = Math.max(0, accumulator - FIXED_DT);
        fixedStep(inputs);
      }
      return progress();
    },
    progress,
    dynamicSnapshot,
    checkpoint,
    snapshot,
    readState: snapshot,
    drainEvents() { return pendingEvents.splice(0).map((entry) => ({ ...entry })); },
  });
}

/** Existing solo API, backed by exactly the same kernel as cooperative play. */
function soloRuntime(inputDefinition, restored) {
  const kernel = createRuntimeKernel(checkedDefinition(inputDefinition, 1), [{ id: 'player', slot: 0 }], false, restored);
  const advance = (dt, input) => { checkInput(input); return kernel.advance(dt, [input]); };
  return Object.freeze({ ...kernel, advance, step(dt, input) { advance(dt, input); return kernel.snapshot(); } });
}
export function createGameRuntime(inputDefinition) { return soloRuntime(inputDefinition); }

/** Fixed roster: transport must create a new runtime for a new round, never for
 * a reconnection. Missing inputs mean idle, not removal or a simulation pause. */
function multiplayerRuntime(inputDefinition, options, restored) {
  const definition = checkedDefinition(inputDefinition, 2);
  if (!plain(options) || Object.keys(options).some((key) => key !== 'players') || !Array.isArray(options.players)
    || options.players.length < definition.players.min || options.players.length > definition.players.max) {
    throw invalidOptions('/players', 'Provide a fixed roster within the game player limits.');
  }
  const ids = new Set(), slots = new Set(), roster = [];
  for (let i = 0; i < options.players.length; i++) {
    const player = options.players[i];
    if (!plain(player) || Object.keys(player).some((key) => !['id', 'slot'].includes(key))
      || !safePlayerId(player.id) || ids.has(player.id)) throw invalidOptions(`/players/${i}/id`, 'Player IDs must be safe, unique ASCII identifiers of at most 80 characters.');
    if (!Number.isInteger(player.slot) || player.slot < 0 || player.slot >= definition.players.max || slots.has(player.slot)) throw invalidOptions(`/players/${i}/slot`, 'Roster slots must be unique integers inside the game capacity.');
    ids.add(player.id); slots.add(player.slot); roster.push({ id: player.id, slot: player.slot });
  }
  roster.sort((a, b) => a.slot - b.slot);
  const kernel = createRuntimeKernel(definition, roster, true, restored);
  const advance = (dt, inputs) => {
    if (!plain(inputs)) throw new TypeError('Inputs must be a player ID record.');
    const entries = Object.entries(inputs);
    if (entries.length > roster.length) throw new TypeError('Input contains players outside the fixed roster.');
    for (const [id, input] of entries) {
      if (!safePlayerId(id) || !ids.has(id)) throw new TypeError('Input player is not in the fixed roster.');
      checkInput(input);
    }
    // Validate the entire batch before modifying any held-input or world state.
    return kernel.advance(dt, roster.map(({ id }) => Object.hasOwn(inputs, id) ? inputs[id] : idle));
  };
  return Object.freeze({ ...kernel, advance, step(dt, inputs) { advance(dt, inputs); return kernel.snapshot(); } });
}
export function createMultiplayerRuntime(inputDefinition, options) { return multiplayerRuntime(inputDefinition, options); }
export function restoreGameRuntime(inputDefinition, checkpoint) {
  const definition = checkedDefinition(inputDefinition, 1);
  const restored = checkedCheckpoint(definition, checkpoint, false);
  return soloRuntime(definition, restored);
}
export function restoreMultiplayerRuntime(inputDefinition, checkpoint) {
  const definition = checkedDefinition(inputDefinition, 2);
  const restored = checkedCheckpoint(definition, checkpoint, true);
  return multiplayerRuntime(definition, { players: restored.players.map(({ id, slot }) => ({ id, slot })) }, restored);
}
