/** Data-only codec. Transport authenticates the stream's owner and requests a
 * fresh baseline after resync_required. No DOM, sockets, clocks or scene assets. */
export const MINIGAME_SYNC_VERSION = 1;
const LIMITS = { players: 16, entities: 256, variables: 64, timers: 32, ticks: 216000 };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const reserved = new Set(['__proto__', 'constructor', 'prototype']);
const safeId = (id, player = false) => typeof id === 'string' && !reserved.has(id)
  && (player ? /^[A-Za-z0-9_-]{1,80}$/ : /^[a-z][a-z0-9_-]{0,63}$/).test(id);
const fail = (path, code = 'invalid_sync') => { throw Object.assign(new TypeError(`${code === 'resync_required' ? 'Minigame resync required' : 'Invalid minigame sync'} at ${path}.`), { code, path }); };
const object = (value, keys, path, exact = true) => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key)) || exact && Object.keys(value).length !== keys.length) fail(path);
};
const number = (value, min, max, path, integer = false) => {
  if (!Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) fail(path);
};
const array = (value, min, max, path) => {
  if (!Array.isArray(value) || value.length < min || value.length > max || Object.keys(value).length !== value.length) fail(path);
};
function stream(streamId, sequence) {
  if (typeof streamId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(streamId)) fail('/streamId');
  number(sequence, 0, Number.MAX_SAFE_INTEGER, '/sequence', true);
}
function record(value, limit, path, min, max, nullable = false) {
  if (!plain(value) || Object.keys(value).length > limit) fail(path);
  for (const [id, item] of Object.entries(value)) {
    if (!safeId(id)) fail(`${path}/${id}`);
    if (!nullable || item !== null) number(item, min, max, `${path}/${id}`);
  }
}
function state(snapshot) {
  object(snapshot, ['tick', 'elapsed', 'status', 'players', 'entities', 'variables', 'timers', 'message'], '/snapshot');
  number(snapshot.tick, 0, LIMITS.ticks, '/snapshot/tick', true);
  if (snapshot.elapsed !== snapshot.tick * (1 / 60)) fail('/snapshot/elapsed');
  if (!['playing', 'won', 'lost'].includes(snapshot.status)) fail('/snapshot/status');
  if (snapshot.message !== null && (typeof snapshot.message !== 'string' || snapshot.message.length > 240)) fail('/snapshot/message');
  for (const [collection, fields, maximum] of [['players', ['id', 'slot', 'x', 'z', 'yaw'], LIMITS.players], ['entities', ['id', 'visible', 'x', 'y', 'z'], LIMITS.entities]]) {
    array(snapshot[collection], collection === 'players' ? 1 : 0, maximum, `/snapshot/${collection}`);
    const ids = new Set(), slots = new Set();
    for (const [index, item] of snapshot[collection].entries()) {
      const path = `/snapshot/${collection}/${index}`;
      object(item, fields, path);
      if (!safeId(item.id, collection === 'players') || ids.has(item.id)) fail(`${path}/id`);
      ids.add(item.id);
      for (const key of collection === 'players' ? ['x', 'z'] : ['x', 'y', 'z']) number(item[key], -100, 100, `${path}/${key}`);
      if (collection === 'players') {
        number(item.slot, 0, LIMITS.players - 1, `${path}/slot`, true);
        if (slots.has(item.slot)) fail(`${path}/slot`); slots.add(item.slot);
        number(item.yaw, -Math.PI, Math.PI, `${path}/yaw`);
      } else if (typeof item.visible !== 'boolean') fail(`${path}/visible`);
    }
  }
  record(snapshot.variables, LIMITS.variables, '/snapshot/variables', -1e9, 1e9);
  record(snapshot.timers, LIMITS.timers, '/snapshot/timers', 0, 3600);
}
function compatible(previous, next, code = 'resync_required') {
  for (const collection of ['players', 'entities']) {
    if (previous[collection].length !== next[collection].length || previous[collection].some((item, index) =>
      item.id !== next[collection][index].id || collection === 'players' && item.slot !== next[collection][index].slot)) fail(`/${collection}`, code);
  }
  if (Object.keys(previous.variables).length !== Object.keys(next.variables).length
    || Object.keys(previous.variables).some(id => !Object.hasOwn(next.variables, id))) fail('/variables', code);
  if (next.tick < previous.tick || previous.status !== 'playing' && (next.status !== previous.status || next.tick !== previous.tick)) fail('/tick', code);
}

export function createMinigameBaseline(snapshot, options) {
  object(options, ['streamId', 'sequence'], '/options', false);
  const { streamId, sequence = 0 } = options;
  state(snapshot); stream(streamId, sequence);
  return { protocolVersion: MINIGAME_SYNC_VERSION, type: 'baseline', streamId, sequence, snapshot: structuredClone(snapshot) };
}

export function createMinigameDelta(previous, next, options) {
  object(options, ['streamId', 'baseSequence', 'sequence'], '/options');
  const { streamId, baseSequence, sequence } = options;
  state(previous); state(next); compatible(previous, next); stream(streamId, sequence);
  number(baseSequence, 0, Number.MAX_SAFE_INTEGER, '/baseSequence', true);
  if (sequence !== baseSequence + 1) fail('/sequence');
  const changes = {};
  for (const key of ['tick', 'elapsed', 'status', 'message']) if (previous[key] !== next[key]) changes[key] = next[key];
  for (const [collection, fields] of [['players', ['x', 'z', 'yaw']], ['entities', ['visible', 'x', 'y', 'z']]]) {
    const before = new Map(previous[collection].map(item => [item.id, item]));
    const patches = [];
    for (const item of next[collection]) {
      const patch = { id: item.id };
      for (const key of fields) if (before.get(item.id)[key] !== item[key]) patch[key] = item[key];
      if (Object.keys(patch).length > 1) patches.push(patch);
    }
    if (patches.length) changes[collection] = patches;
  }
  for (const collection of ['variables', 'timers']) {
    const patches = {};
    for (const [id, value] of Object.entries(next[collection])) if (previous[collection][id] !== value) patches[id] = value;
    if (collection === 'timers') for (const id of Object.keys(previous.timers)) if (!Object.hasOwn(next.timers, id)) patches[id] = null;
    if (Object.keys(patches).length) changes[collection] = patches;
  }
  return { protocolVersion: MINIGAME_SYNC_VERSION, type: 'delta', streamId, baseSequence, sequence, changes };
}

export function applyMinigameSync(current, message) {
  if (!plain(message) || !['baseline', 'delta'].includes(message.type)) fail('/type');
  object(message, ['protocolVersion', 'type', 'streamId', 'sequence', ...(message.type === 'baseline' ? ['snapshot'] : ['baseSequence', 'changes'])], '');
  if (message.protocolVersion !== MINIGAME_SYNC_VERSION) fail('/protocolVersion');
  stream(message.streamId, message.sequence);
  if (current !== null) {
    object(current, ['streamId', 'sequence', 'snapshot'], '/current');
    stream(current.streamId, current.sequence); state(current.snapshot);
    if (current.streamId !== message.streamId) fail('/streamId', 'resync_required');
  }
  if (message.type === 'baseline') {
    state(message.snapshot);
    if (current && message.sequence < current.sequence) fail('/sequence', 'resync_required');
    if (current) compatible(current.snapshot, message.snapshot);
    return { streamId: message.streamId, sequence: message.sequence, snapshot: structuredClone(message.snapshot) };
  }
  number(message.baseSequence, 0, Number.MAX_SAFE_INTEGER, '/baseSequence', true);
  if (message.sequence !== message.baseSequence + 1) fail('/sequence');
  if (!current || message.baseSequence !== current.sequence) fail('/baseSequence', 'resync_required');
  object(message.changes, ['tick', 'elapsed', 'status', 'players', 'entities', 'variables', 'timers', 'message'], '/changes', false);
  const snapshot = structuredClone(current.snapshot), changes = message.changes;
  for (const key of ['tick', 'elapsed', 'status', 'message']) if (Object.hasOwn(changes, key)) snapshot[key] = changes[key];
  for (const collection of ['players', 'entities']) {
    const targets = new Map(snapshot[collection].map(item => [item.id, item]));
    if (Object.hasOwn(changes, collection)) array(changes[collection], 0, targets.size, `/changes/${collection}`);
    const patched = new Set();
    for (const patch of changes[collection] ?? []) {
      object(patch, collection === 'players' ? ['id', 'x', 'z', 'yaw'] : ['id', 'visible', 'x', 'y', 'z'], `/changes/${collection}`, false);
      if (!targets.has(patch.id) || patched.has(patch.id)) fail(`/changes/${collection}/id`);
      patched.add(patch.id); Object.assign(targets.get(patch.id), patch);
    }
  }
  for (const collection of ['variables', 'timers']) {
    if (Object.hasOwn(changes, collection)) record(changes[collection], LIMITS[collection], `/changes/${collection}`, collection === 'variables' ? -1e9 : 0, collection === 'variables' ? 1e9 : 3600, collection === 'timers');
    for (const [id, value] of Object.entries(changes[collection] ?? {})) {
      if (value === null) delete snapshot[collection][id]; else snapshot[collection][id] = value;
    }
  }
  state(snapshot); compatible(current.snapshot, snapshot, 'invalid_sync');
  return { streamId: message.streamId, sequence: message.sequence, snapshot };
}
