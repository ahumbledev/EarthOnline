/** Deterministic scoop, placement, melting, matching and scoring rules. Time is measured in milliseconds. */
export interface IcecreamConfig {
  roundSeconds: number;
  meltSeconds: number;
  maxScoops: number;
  flavors: string[];
  toppings: string[];
  seed: number;
}

export const DEFAULT_ICECREAM_CONFIG: IcecreamConfig = {
  roundSeconds: 120, meltSeconds: 60, maxScoops: 3,
  flavors: ['vanilla', 'strawberry', 'chocolate'], toppings: ['sprinkles', 'cookie'], seed: 1,
};
/** Optional timestamp tolerance for input sampled on a previous frame. */
export const ICECREAM_INPUT_MAX_LAG_MS = 2000;
export interface IcecreamTimingSample { id: string; serverNow: number }
export interface IcecreamInputTiming { sampleId: string; elapsedMs: number }

export type IcecreamAction =
  | { type: 'start' | 'scoop-start' | 'scoop-release' | 'place' | 'serve' | 'replay' }
  | { type: 'container'; container: 'cup' | 'cone' }
  | { type: 'flavor'; flavor: string }
  | { type: 'topping'; topping: string };
export interface IcecreamOrder { id: string; container: 'cup' | 'cone'; flavors: string[]; topping: string }
export interface IcecreamScoop { flavor: string; quality: number; offset: number; placedAt: number; playerId: string }
export interface IcecreamResult {
  score: number; match: number; integrity: number; speed: number;
  grade: 'excellent' | 'good' | 'practice'; servedBy: string; servedAt: number;
}
export interface IcecreamState {
  version: 1;
  phase: 'ready' | 'making' | 'served' | 'failed';
  round: number;
  order: IcecreamOrder;
  startedAt: number | null;
  updatedAt: number;
  container: 'cup' | 'cone' | null;
  flavor: string | null;
  topping: string | null;
  activeScoop: { playerId: string; flavor: string; startedAt: number } | null;
  pendingScoop: { playerId: string; flavor: string; quality: number; readyAt: number } | null;
  scoops: IcecreamScoop[];
  firstPreparedAt: number | null;
  mistakes: number;
  contributors: string[];
  failure: 'timeout' | 'melted' | 'toppled' | 'wasted' | null;
  notice: 'ready' | 'container' | 'flavor' | 'scooping' | 'place' | 'topping' | 'serve' | 'missed' | 'served' | 'failed';
  result: IcecreamResult | null;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_config', '配置必须是对象。');
  return input as Record<string, unknown>;
}
function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) fail('unknown_field', '包含未支持的字段。');
}
function number(input: unknown, min: number, max: number, integer = false): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < min || input > max || (integer && !Number.isInteger(input))) {
    fail('invalid_config', integer ? `数值需在 ${min}–${max} 范围内且为整数。` : `数值需在 ${min}–${max} 范围内。`);
  }
  return input;
}
function ids(input: unknown, max: number): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > max ||
    input.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id)) || new Set(input).size !== input.length) {
    fail('invalid_config', `菜单需包含 1–${max} 个不同的英文小写标识。`);
  }
  return [...input] as string[];
}
export function validateIcecreamConfig(input: unknown): IcecreamConfig {
  const value = record(input);
  fields(value, ['roundSeconds', 'meltSeconds', 'maxScoops', 'flavors', 'toppings', 'seed']);
  return {
    roundSeconds: number(value.roundSeconds, 30, 300), meltSeconds: number(value.meltSeconds, 15, 180),
    maxScoops: number(value.maxScoops, 1, 3, true), flavors: ids(value.flavors, 6), toppings: ids(value.toppings, 4),
    seed: number(value.seed, 0, 2147483647, true),
  };
}

function order(config: IcecreamConfig, round: number): IcecreamOrder {
  let seed = ((config.seed + Math.imul(round, 2654435761)) >>> 0) || 1;
  const draw = (n: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  const container = draw(2) === 0 ? 'cup' : 'cone';
  const count = 1 + draw(config.maxScoops);
  return { id: `order-${round}`, container, flavors: Array.from({ length: count }, () => config.flavors[draw(config.flavors.length)]),
    topping: config.toppings[draw(config.toppings.length)] };
}
function validTime(now: number, previous = 0) {
  if (!Number.isSafeInteger(now) || now < previous) fail('invalid_time', '服务器时间无效。');
}
export function createIcecreamState(input: IcecreamConfig = DEFAULT_ICECREAM_CONFIG, now = 0): IcecreamState {
  const config = validateIcecreamConfig(input); validTime(now);
  return { version: 1, phase: 'ready', round: 1, order: order(config, 1), startedAt: null, updatedAt: now,
    container: null, flavor: null, topping: null, activeScoop: null, pendingScoop: null, scoops: [], firstPreparedAt: null,
    mistakes: 0, contributors: [], failure: null, notice: 'ready', result: null };
}

export function icecreamMeltFraction(state: IcecreamState, config: IcecreamConfig, now: number): number {
  return state.firstPreparedAt === null ? 0 : Math.min(1, Math.max(0, (now - state.firstPreparedAt) / (config.meltSeconds * 1000)));
}
/** Oscillating placement is evaluated again on the server; the client sends only an intent to place. */
export function icecreamPlacementOffset(state: IcecreamState, now: number): number {
  return state.pendingScoop ? Math.sin(Math.max(0, now - state.pendingScoop.readyAt) * Math.PI / 720) : 0;
}
export function icecreamIntegrity(state: IcecreamState, config: IcecreamConfig, now: number): number {
  const quality = state.scoops.length ? state.scoops.reduce((sum, scoop) => sum + scoop.quality * (1 - Math.abs(scoop.offset) * .6), 0) / state.scoops.length : 1;
  return Math.max(0, quality * (1 - icecreamMeltFraction(state, config, now) * .65) * (1 - state.mistakes * .1));
}
function failed(state: IcecreamState, reason: NonNullable<IcecreamState['failure']>, now: number): IcecreamState {
  return { ...state, phase: 'failed', failure: reason, notice: 'failed', activeScoop: null, pendingScoop: null, updatedAt: now };
}
/** Call during snapshot reads as well as writes so a disconnected cook cannot freeze a round or reserve a tool. */
export function tickIcecreamState(state: IcecreamState, config: IcecreamConfig, now: number): IcecreamState {
  validTime(now, state.updatedAt);
  if (state.phase !== 'making') return state;
  if (now - state.startedAt! >= config.roundSeconds * 1000) return failed(state, 'timeout', now);
  if (icecreamMeltFraction(state, config, now) >= 1) return failed(state, 'melted', now);
  if (state.activeScoop && now - state.activeScoop.startedAt >= 4000) {
    const next = { ...state, activeScoop: null, mistakes: state.mistakes + 1, notice: 'missed' as const, updatedAt: now };
    return next.mistakes >= 3 ? failed(next, 'wasted', now) : next;
  }
  return state;
}

function validateAction(input: unknown): IcecreamAction {
  const action = record(input);
  if (['start', 'scoop-start', 'scoop-release', 'place', 'serve', 'replay'].includes(String(action.type))) {
    fields(action, ['type']); return action as IcecreamAction;
  }
  if (action.type === 'container') {
    fields(action, ['type', 'container']);
    if (action.container !== 'cup' && action.container !== 'cone') fail('invalid_action', '请选择纸杯或甜筒。');
  } else if (action.type === 'flavor') {
    fields(action, ['type', 'flavor']); if (typeof action.flavor !== 'string') fail('invalid_action', '请选择口味。');
  } else if (action.type === 'topping') {
    fields(action, ['type', 'topping']); if (typeof action.topping !== 'string') fail('invalid_action', '请选择配料。');
  } else fail('invalid_action', '未支持的冰激凌操作。');
  return action as IcecreamAction;
}

/** Authentication, room membership, row locking and actionId deduplication belong to the host. */
export function applyIcecreamAction(previous: IcecreamState, input: unknown, actor: { playerId: string; now: number; inputAt?: number }, config: IcecreamConfig): IcecreamState {
  const action = validateAction(input), { playerId, now } = actor;
  if (typeof playerId !== 'string' || !playerId || playerId.length > 128) fail('invalid_actor', '需要有效的玩家身份。');
  validTime(now, previous.updatedAt);
  const inputAt = actor.inputAt === undefined ? now : actor.inputAt;
  if (actor.inputAt !== undefined && ((!['scoop-release', 'place'].includes(action.type)) || !Number.isSafeInteger(inputAt)
    || inputAt < 0 || inputAt > now || now - inputAt > ICECREAM_INPUT_MAX_LAG_MS)) {
    fail('input_timing_expired', '操作时间已过期，请等画面同步后重试。');
  }
  // Real time still expires tools and rounds. Compensation never restores past state.
  const current = tickIcecreamState(previous, config, now);
  if (action.type === 'replay') {
    if (current.phase !== 'served' && current.phase !== 'failed') fail('round_active', '本局结束后才能重开。');
    const next = createIcecreamState(config, now);
    next.round = current.round + 1; next.order = order(config, next.round);
    return { ...next, phase: 'making', startedAt: now, notice: 'container', contributors: [playerId] };
  }
  if (current.phase === 'served' || current.phase === 'failed') fail('round_finished', '本局已经结束，请开始下一单。');
  if (action.type === 'start') {
    if (current.phase !== 'ready') fail('round_active', '已经接单了。');
    return { ...current, phase: 'making', startedAt: now, updatedAt: now, notice: 'container', contributors: [playerId] };
  }
  if (current.phase !== 'making') fail('round_not_started', '请先接单。');
  const state: IcecreamState = { ...current, scoops: [...current.scoops], contributors: [...current.contributors], updatedAt: now };
  if (!state.contributors.includes(playerId)) state.contributors.push(playerId);
  if (action.type === 'container') {
    if (state.container || state.scoops.length || state.activeScoop || state.pendingScoop) fail('container_locked', '已经选好容器了。');
    state.container = action.container; state.notice = 'flavor'; return state;
  }
  if (!state.container) fail('container_required', '先选纸杯或甜筒。');
  if (action.type === 'flavor') {
    if (!config.flavors.includes(action.flavor)) fail('invalid_flavor', '菜单里没有这个口味。');
    if (state.activeScoop || state.pendingScoop) fail('station_busy', '正在制作这一球，请先完成。');
    if (state.scoops.length >= state.order.flavors.length) fail('scoops_complete', '冰激凌球已经完成，请加配料。');
    state.flavor = action.flavor; state.notice = 'flavor'; return state;
  }
  if (action.type === 'scoop-start') {
    if (state.activeScoop || state.pendingScoop) fail('station_busy', '正在使用冰激凌勺。');
    if (state.scoops.length >= state.order.flavors.length) fail('scoops_complete', '冰激凌球已经完成，请加配料。');
    if (!state.flavor) fail('flavor_required', '先选一种口味。');
    state.activeScoop = { playerId, flavor: state.flavor, startedAt: now }; state.notice = 'scooping'; return state;
  }
  if (action.type === 'scoop-release') {
    if (!state.activeScoop) fail('scoop_required', '请先开始挖球。');
    if (state.activeScoop.playerId !== playerId) fail('station_owned', '其他玩家正在使用冰激凌勺。');
    if (inputAt < state.activeScoop.startedAt) fail('input_timing_expired', '这次挖球已经变化，请等画面同步后重试。');
    const duration = inputAt - state.activeScoop.startedAt;
    const quality = Math.max(0, 1 - Math.abs(duration - 900) / 900);
    if (quality < .2) {
      state.activeScoop = null; state.mistakes++; state.notice = 'missed';
      return state.mistakes >= 3 ? failed(state, 'wasted', now) : state;
    }
    state.pendingScoop = { playerId, flavor: state.activeScoop.flavor, quality, readyAt: now };
    state.activeScoop = null; state.firstPreparedAt ??= now; state.notice = 'place'; return state;
  }
  if (action.type === 'place') {
    if (!state.pendingScoop) fail('scoop_required', '请先挖出一球。');
    if (inputAt < state.pendingScoop.readyAt) fail('input_timing_expired', '这一球已经变化，请等画面同步后重试。');
    if (inputAt - state.pendingScoop.readyAt < 150) fail('placement_not_ready', '让勺子移到容器上方，再放下。');
    const offset = icecreamPlacementOffset(state, inputAt);
    if (Math.abs(offset) > .86) return failed(state, 'toppled', now);
    state.scoops.push({ flavor: state.pendingScoop.flavor, quality: state.pendingScoop.quality, offset, placedAt: now, playerId });
    state.pendingScoop = null; state.flavor = null;
    state.notice = state.scoops.length === state.order.flavors.length ? 'topping' : 'flavor'; return state;
  }
  if (action.type === 'topping') {
    if (state.scoops.length !== state.order.flavors.length || state.pendingScoop || state.activeScoop) fail('unfinished', '先完成所有冰激凌球。');
    if (!config.toppings.includes(action.topping)) fail('invalid_topping', '菜单里没有这种配料。');
    state.topping = action.topping; state.notice = 'serve'; return state;
  }
  if (state.scoops.length !== state.order.flavors.length || !state.topping) fail('unfinished', '先完成冰激凌球和配料。');
  const matches = Number(state.container === state.order.container) + Number(state.topping === state.order.topping) + state.order.flavors.reduce((sum, flavor, index) => sum + Number(state.scoops[index].flavor === flavor), 0);
  const match = Math.round(matches / (state.order.flavors.length + 2) * 100);
  const integrity = Math.round(icecreamIntegrity(state, config, now) * 100);
  const speed = Math.round(Math.max(0, 1 - (now - state.startedAt!) / (config.roundSeconds * 1000)) * 100);
  const score = Math.round(match * .5 + integrity * .35 + speed * .15);
  state.phase = 'served'; state.notice = 'served';
  state.result = { score, match, integrity, speed, grade: score >= 90 ? 'excellent' : score >= 65 ? 'good' : 'practice', servedBy: playerId, servedAt: now };
  return state;
}
