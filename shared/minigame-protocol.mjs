/** Versioned, data-only contract shared by browser, creator CLI and upload server. */
export const MINIGAME_MATERIALS = Object.freeze(['concrete', 'stone', 'timber', 'plaster']);
/** Authoring limits, not a revision's production capacity certification. */
export const MINIGAME_PROFILES = Object.freeze({
  solo: Object.freeze({ minPlayers: 1, maxPlayers: 1 }),
  coop4: Object.freeze({ minPlayers: 2, maxPlayers: 4 }),
  standard8: Object.freeze({ minPlayers: 1, maxPlayers: 8 }),
  party16: Object.freeze({ minPlayers: 2, maxPlayers: 16 }),
});
export const MINIGAME_LIMITS = Object.freeze({
  archiveBytes: 32 * 1024 * 1024, unpackedBytes: 64 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024, files: 128, definitionBytes: 512 * 1024,
  assets: 32, textureDimension: 2048, texturePixels: 4 * 1024 * 1024,
  totalTexturePixels: 32 * 1024 * 1024,
  entities: 256, rules: 128, actionsPerRule: 32, conditionsPerRule: 16,
  variables: 64, timers: 32, issues: 100, trace: 256,
  actionsPerTick: 1024, variableMagnitude: 1e9, sessionSeconds: 3600,
  arenaSize: 200, motionSpeed: 10, interactDistance: 1.8,
});

const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const own = (v, k) => Object.hasOwn(v, k);
const pointer = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/** Never executes package code. Paths are RFC 6901 JSON pointers. */
export function validateGameDefinition(data) {
  const issues = [];
  const issue = (path, code, message) => {
    if (issues.length < MINIGAME_LIMITS.issues) issues.push({ path, code, message });
  };
  const object = (v, path, allowed) => {
    if (!plain(v)) { issue(path, 'type', 'Expected an object.'); return false; }
    if (allowed) for (const k of Object.keys(v)) {
      if (!allowed.includes(k)) issue(`${path}/${pointer(k)}`, 'unknown_key', 'Field is not supported in this schema version.');
    }
    return true;
  };
  const number = (v, path, min, max) => {
    if (!finite(v) || v < min || v > max) {
      issue(path, 'range', `Expected a finite number from ${min} to ${max}.`); return false;
    }
    return true;
  };
  const string = (v, path, max, min = 1) => {
    if (typeof v !== 'string' || v.trim().length < min || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) {
      issue(path, 'string', `Expected text of ${min} to ${max} characters without control characters.`); return false;
    }
    return true;
  };
  const id = (v, path) => {
    if (typeof v !== 'string' || !ID.test(v) || RESERVED.has(v)) {
      issue(path, 'id', 'Use a lowercase letter followed by up to 63 letters, digits, _ or -; reserved names are forbidden.'); return false;
    }
    return true;
  };
  const boolean = (v, path) => {
    if (typeof v !== 'boolean') issue(path, 'type', 'Expected a boolean.');
  };
  const array = (v, path, max, min = 0) => {
    if (!Array.isArray(v)) { issue(path, 'type', 'Expected an array.'); return []; }
    if (v.length < min || v.length > max) issue(path, 'quota', `Expected ${min} to ${max} entries.`);
    // Public callers may supply sparse JS arrays even though JSON cannot; make
    // absent entries explicit so all nested validators reject them normally.
    return Array.from(v.slice(0, max));
  };
  const vector = (v, path, n, min, max) => {
    if (!Array.isArray(v) || v.length !== n) { issue(path, 'vector', `Expected exactly ${n} numbers.`); return false; }
    return Array.from({ length: n }, (_, i) => number(v[i], `${path}/${i}`, min, max)).every(Boolean);
  };
  const material = (v, path) => {
    if (!MINIGAME_MATERIALS.includes(v)) issue(path, 'material', `Choose ${MINIGAME_MATERIALS.join(', ')}.`);
  };
  const optionalBool = (v, k, path) => { if (own(v, k)) boolean(v[k], `${path}/${k}`); };
  const uniqueIds = (items, path) => {
    const result = new Map();
    items.forEach((v, i) => {
      if (!plain(v) || !id(v.id, `${path}/${i}/id`)) return;
      if (result.has(v.id)) issue(`${path}/${i}/id`, 'duplicate_id', `Duplicate ID ${v.id}.`);
      else result.set(v.id, v);
    });
    return result;
  };
  if (!object(data, '', ['schemaVersion', 'id', 'title', 'description', 'author', 'version', 'players', 'arena', 'assets', 'entities', 'variables', 'timers', 'rules', ...(data?.schemaVersion === 3 ? ['profile'] : [])])) return { valid: false, issues };
  const production = data.schemaVersion === 3, cooperative = data.schemaVersion === 2 || production;
  const profile = production && typeof data.profile === 'string' && own(MINIGAME_PROFILES, data.profile) ? MINIGAME_PROFILES[data.profile] : null;
  if (production && !profile) issue('/profile', 'profile', 'Choose solo, coop4, standard8 or party16; larger profiles are not supported.');
  if (data.schemaVersion !== 1 && !cooperative) issue('/schemaVersion', 'version', 'Supported schema versions are 1 (solo), 2 (cooperative), and 3 (explicit profile).');
  id(data.id, '/id');
  string(data.title, '/title', 80);
  string(data.description, '/description', 1000);
  string(data.author, '/author', 80);
  if (typeof data.version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(data.version)) issue('/version', 'version', 'Use a version such as 1.0.0.');
  if (cooperative) {
    if (object(data.players, '/players', ['min', 'max'])) {
      const lower = production ? profile?.minPlayers ?? 1 : 2, upper = production ? profile?.maxPlayers ?? 16 : 4;
      if (!Number.isInteger(data.players.min) || data.players.min < lower || data.players.min > data.players.max) issue('/players/min', 'range', `Minimum players must be an integer from ${lower} through players.max.`);
      if (!Number.isInteger(data.players.max) || data.players.max < lower || data.players.max > upper) issue('/players/max', 'range', `Choose a capacity from ${lower} through ${upper} players for this profile.`);
    }
  } else if (data.players !== 1) issue('/players', 'unsupported', 'Schema 1 supports single-player games only.');

  const arena = data.arena;
  let arenaValid = false;
  const spawns = [];
  if (object(arena, '/arena', ['width', 'depth', cooperative ? 'spawns' : 'spawn', 'playerSpeed', 'playerRadius', 'material'])) {
    const widthOK = number(arena.width, '/arena/width', 4, MINIGAME_LIMITS.arenaSize);
    const depthOK = number(arena.depth, '/arena/depth', 4, MINIGAME_LIMITS.arenaSize);
    number(arena.playerSpeed, '/arena/playerSpeed', 0.5, 20);
    const radiusOK = number(arena.playerRadius, '/arena/playerRadius', 0.2, 1);
    material(arena.material, '/arena/material');
    arenaValid = widthOK && depthOK && radiusOK;
    const candidates = cooperative
      ? array(arena.spawns, '/arena/spawns', production ? 16 : 4, production ? 1 : 2).map((spawn, i) => ({ spawn, path: `/arena/spawns/${i}` }))
      : [{ spawn: arena.spawn, path: '/arena/spawn' }];
    if (cooperative && Array.isArray(arena.spawns) && plain(data.players) && arena.spawns.length !== data.players.max) issue('/arena/spawns', 'spawn_count', 'Provide exactly players.max spawn positions, one per roster slot.');
    for (const { spawn, path } of candidates) {
      if (!vector(spawn, path, 2, -100, 100)) continue;
      spawns.push({ spawn, path });
      if (arenaValid && (Math.abs(spawn[0]) + arena.playerRadius > arena.width / 2 || Math.abs(spawn[1]) + arena.playerRadius > arena.depth / 2)) issue(path, 'bounds', 'Player spawn must fit inside the arena.');
    }
  }

  const assets = new Map();
  if (own(data, 'assets') && object(data.assets, '/assets')) {
    const entries = Object.entries(data.assets);
    const paths = new Set();
    if (entries.length > MINIGAME_LIMITS.assets) issue('/assets', 'quota', `At most ${MINIGAME_LIMITS.assets} assets.`);
    for (const [key, v] of entries.slice(0, MINIGAME_LIMITS.assets)) {
      const p = `/assets/${pointer(key)}`;
      id(key, p);
      if (!object(v, p, ['path'])) continue;
      if (typeof v.path !== 'string' || v.path.length > 180 || !/^assets\/(?:[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(png|jpg|jpeg|webp)$/i.test(v.path)) issue(`${p}/path`, 'asset_path', 'Use a relative assets/ PNG, JPEG or WebP path with safe path segments.');
      else {
        if (paths.has(v.path.toLowerCase())) issue(`${p}/path`, 'duplicate_path', 'Asset paths must be unique, including case.');
        paths.add(v.path.toLowerCase());
      }
      assets.set(key, v);
    }
  }
  const variables = new Set();
  if (object(data.variables, '/variables')) {
    const entries = Object.entries(data.variables);
    if (entries.length > MINIGAME_LIMITS.variables) issue('/variables', 'quota', `At most ${MINIGAME_LIMITS.variables} variables.`);
    for (const [key, value] of entries.slice(0, MINIGAME_LIMITS.variables)) {
      id(key, `/variables/${pointer(key)}`);
      number(value, `/variables/${pointer(key)}`, -MINIGAME_LIMITS.variableMagnitude, MINIGAME_LIMITS.variableMagnitude);
      variables.add(key);
    }
  }
  const entityList = array(data.entities, '/entities', MINIGAME_LIMITS.entities);
  const entities = uniqueIds(entityList, '/entities');
  entityList.forEach((e, i) => {
    const p = `/entities/${i}`;
    if (!object(e, p, ['id', 'shape', 'position', 'size', 'material', 'texture', 'solid', 'trigger', 'interactable', 'visible', 'motion'])) return;
    if (!['box', 'sphere', 'cylinder'].includes(e.shape)) issue(`${p}/shape`, 'shape', 'Choose box, sphere or cylinder.');
    const positionOK = vector(e.position, `${p}/position`, 3, -200, 200);
    const sizeOK = vector(e.size, `${p}/size`, 3, 0.1, 100);
    material(e.material, `${p}/material`);
    for (const key of ['solid', 'trigger', 'interactable', 'visible']) optionalBool(e, key, p);
    if (own(e, 'texture') && !assets.has(e.texture)) issue(`${p}/texture`, 'reference', 'Texture must name an entry in assets.');
    if (arenaValid && positionOK && sizeOK) {
      if (Math.abs(e.position[0]) + e.size[0] / 2 > arena.width / 2 || Math.abs(e.position[2]) + e.size[2] / 2 > arena.depth / 2) issue(`${p}/position`, 'bounds', 'Entity footprint must fit inside the arena.');
      if (e.position[1] - e.size[1] / 2 < -0.001 || e.position[1] + e.size[1] / 2 > 50) issue(`${p}/position/1`, 'bounds', 'Entity must fit between ground Y=0 and Y=50.');
      if (e.solid === true && e.visible !== false) for (const { spawn, path } of spawns) {
        const dx = Math.max(0, Math.abs(spawn[0] - e.position[0]) - e.size[0] / 2);
        const dz = Math.max(0, Math.abs(spawn[1] - e.position[2]) - e.size[2] / 2);
        if (dx * dx + dz * dz < arena.playerRadius ** 2 - 1e-10) issue(path, 'blocked_spawn', `Spawn overlaps solid ${e.id}.`);
      }
    }
    if (own(e, 'motion') && object(e.motion, `${p}/motion`, ['to', 'duration'])) {
      if (e.solid === true) issue(`${p}/motion`, 'moving_solid', 'Moving solids are not supported; use non-solid trigger hazards.');
      const toOK = vector(e.motion.to, `${p}/motion/to`, 2, -100, 100);
      const durationOK = number(e.motion.duration, `${p}/motion/duration`, 1 / 60, 3600);
      if (toOK && sizeOK && arenaValid && (Math.abs(e.motion.to[0]) + e.size[0] / 2 > arena.width / 2 || Math.abs(e.motion.to[1]) + e.size[2] / 2 > arena.depth / 2)) issue(`${p}/motion/to`, 'bounds', 'Motion endpoint must fit inside the arena.');
      if (toOK && positionOK && durationOK && Math.hypot(e.motion.to[0] - e.position[0], e.motion.to[1] - e.position[2]) / e.motion.duration > MINIGAME_LIMITS.motionSpeed) issue(`${p}/motion/duration`, 'motion_speed', `Motion speed must not exceed ${MINIGAME_LIMITS.motionSpeed} m/s.`);
    }
  });
  const timerList = own(data, 'timers') ? array(data.timers, '/timers', MINIGAME_LIMITS.timers) : [];
  const timers = uniqueIds(timerList, '/timers');
  timerList.forEach((t, i) => {
    const p = `/timers/${i}`;
    if (!object(t, p, ['id', 'duration', 'repeat', 'autoStart'])) return;
    number(t.duration, `${p}/duration`, 1 / 60, MINIGAME_LIMITS.sessionSeconds);
    optionalBool(t, 'repeat', p); optionalBool(t, 'autoStart', p);
  });
  const reference = (value, map, path, label) => {
    if (typeof value !== 'string' || !map.has(value)) issue(path, 'reference', `Unknown ${label} reference.`);
  };
  const ruleList = array(data.rules, '/rules', MINIGAME_LIMITS.rules, 1);
  uniqueIds(ruleList, '/rules');
  ruleList.forEach((r, i) => {
    const p = `/rules/${i}`;
    if (!object(r, p, ['id', 'on', 'when', 'once', 'actions'])) return;
    optionalBool(r, 'once', p);
    if (object(r.on, `${p}/on`)) {
      if (r.on.type === 'start') object(r.on, `${p}/on`, ['type']);
      else if (r.on.type === 'enter' || r.on.type === 'interact') {
        object(r.on, `${p}/on`, ['type', 'entity']);
        reference(r.on.entity, entities, `${p}/on/entity`, 'entity');
        const entity = entities.get(r.on.entity);
        const flag = r.on.type === 'enter' ? 'trigger' : 'interactable';
        if (entity && entity[flag] !== true) issue(`${p}/on/entity`, 'event_target', `Target entity must declare ${flag}: true.`);
      } else if (r.on.type === 'timer') {
        object(r.on, `${p}/on`, ['type', 'timer']); reference(r.on.timer, timers, `${p}/on/timer`, 'timer');
      } else issue(`${p}/on/type`, 'event', 'Choose start, enter, interact or timer.');
    }
    if (own(r, 'when')) array(r.when, `${p}/when`, MINIGAME_LIMITS.conditionsPerRule).forEach((c, j) => {
      const q = `${p}/when/${j}`;
      if (!object(c, q, ['variable', 'op', 'value'])) return;
      reference(c.variable, variables, `${q}/variable`, 'variable');
      if (!['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(c.op)) issue(`${q}/op`, 'operator', 'Choose eq, ne, lt, lte, gt or gte.');
      number(c.value, `${q}/value`, -MINIGAME_LIMITS.variableMagnitude, MINIGAME_LIMITS.variableMagnitude);
    });
    array(r.actions, `${p}/actions`, MINIGAME_LIMITS.actionsPerRule, 1).forEach((a, j) => {
      const q = `${p}/actions/${j}`;
      if (!object(a, q)) return;
      switch (a.type) {
        case 'add': case 'set':
          object(a, q, ['type', 'variable', 'value']); reference(a.variable, variables, `${q}/variable`, 'variable');
          number(a.value, `${q}/value`, -MINIGAME_LIMITS.variableMagnitude, MINIGAME_LIMITS.variableMagnitude); break;
        case 'hide': case 'show':
          object(a, q, ['type', 'entity']); reference(a.entity, entities, `${q}/entity`, 'entity'); break;
        case 'teleport':
          object(a, q, cooperative ? ['type', 'position', 'target'] : ['type', 'position']);
          if (cooperative) {
            if (!['actor', 'all'].includes(a.target)) issue(`${q}/target`, 'teleport_target', 'Cooperative teleports require target actor or all.');
            if (a.target === 'actor' && (!plain(r.on) || !['enter', 'interact'].includes(r.on.type))) issue(`${q}/target`, 'actor_context', 'Only enter/interact events have an actor. Timers never inherit an actor.');
          }
          if (vector(a.position, `${q}/position`, 2, -100, 100) && arenaValid && (Math.abs(a.position[0]) + arena.playerRadius > arena.width / 2 || Math.abs(a.position[1]) + arena.playerRadius > arena.depth / 2)) issue(`${q}/position`, 'bounds', 'Teleport destination must fit inside the arena.');
          break;
        case 'message': object(a, q, ['type', 'text']); string(a.text, `${q}/text`, 240); break;
        case 'timer.start': case 'timer.stop':
          object(a, q, ['type', 'timer']); reference(a.timer, timers, `${q}/timer`, 'timer'); break;
        case 'win': case 'lose': object(a, q, ['type']); break;
        default: issue(`${q}/type`, 'action', 'Unsupported action; executable code is forbidden.');
      }
    });
  });
  return { valid: issues.length === 0, issues };
}
