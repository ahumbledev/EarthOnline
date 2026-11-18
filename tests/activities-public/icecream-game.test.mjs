import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ICECREAM_CONFIG, validateIcecreamConfig, createIcecreamState,
  applyIcecreamAction, tickIcecreamState, icecreamPlacementOffset,
} from '../../src/activities-public/icecream/rules.ts';

const config = DEFAULT_ICECREAM_CONFIG;
const act = (state, action, now, playerId = 'alice') => applyIcecreamAction(state, action, { now, playerId }, config);
function prepared() {
  let state = act(createIcecreamState(config, 1000), { type: 'start' }, 1000);
  return act(state, { type: 'container', container: state.order.container }, 1100);
}
function scoop(state, now, playerId = 'alice', flavor = state.order.flavors[state.scoops.length]) {
  state = act(state, { type: 'flavor', flavor }, now, playerId);
  state = act(state, { type: 'scoop-start' }, now + 10, playerId);
  state = act(state, { type: 'scoop-release' }, now + 910, playerId);
  // The authoritative moving scoop crosses the stack center after half a cycle.
  return act(state, { type: 'place' }, now + 910 + 720, playerId);
}

test('cooperative order requires timed scooping, placement, toppings and one authoritative serving', () => {
  const initial = createIcecreamState(config, 1000);
  let state = prepared(); let now = 1200;
  for (let i = 0; i < state.order.flavors.length; i++) {
    state = scoop(state, now, i % 2 ? 'bob' : 'alice'); now += 1800;
  }
  assert.equal(state.scoops.length, state.order.flavors.length);
  state = act(state, { type: 'topping', topping: state.order.topping }, now, 'bob');
  state = act(state, { type: 'serve' }, now + 100, 'bob');
  assert.equal(state.phase, 'served'); assert.equal(state.result.servedBy, 'bob');
  assert.equal(state.result.match, 100); assert.ok(state.result.score > 90);
  assert.deepEqual(state.contributors.sort(), ['alice', 'bob']);
  assert.throws(() => act(state, { type: 'serve' }, now + 101, 'alice'), /结束/);
  assert.equal(initial.phase, 'ready'); assert.equal(initial.scoops.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
});

test('orders are deterministic per seed and round, with safe replay after completion only', () => {
  const a = prepared(); assert.deepEqual(a.order, prepared().order);
  assert.throws(() => act(a, { type: 'replay' }, 1200), /结束/);
  const failed = tickIcecreamState(a, config, 200000);
  const next = act(failed, { type: 'replay' }, 200001, 'bob');
  assert.equal(next.round, 2); assert.equal(next.phase, 'making');
  assert.notEqual(next.order.id, a.order.id); assert.equal(next.scoops.length, 0);
  assert.equal(next.result, null); assert.equal(failed.phase, 'failed');
});

test('scoop station ownership prevents another player releasing an active tool and expires safely', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 1200);
  state = act(state, { type: 'scoop-start' }, 1201);
  assert.throws(() => act(state, { type: 'scoop-release' }, 2101, 'bob'), /其他/);
  assert.throws(() => act(state, { type: 'scoop-start' }, 1300, 'bob'), /正在/);
  const expired = tickIcecreamState(state, config, 5202);
  assert.equal(expired.activeScoop, null); assert.equal(expired.phase, 'making');
  assert.equal(expired.mistakes, 1);
  assert.ok(act(expired, { type: 'scoop-start' }, 5300, 'bob').activeScoop);
});

test('server time determines scoop quality, placement, melting and timeout', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 1200);
  state = act(state, { type: 'scoop-start' }, 1210);
  const weak = act(state, { type: 'scoop-release' }, 1330);
  assert.equal(weak.pendingScoop, null); assert.equal(weak.mistakes, 1);
  const held = act(state, { type: 'scoop-release' }, 2110);
  assert.equal(held.pendingScoop.quality, 1);
  assert.ok(Math.abs(icecreamPlacementOffset(held, 2110 + 360)) > .9);
  assert.equal(act(held, { type: 'place' }, 2470).phase, 'failed');
  const stable = act(held, { type: 'place' }, 2830);
  assert.equal(stable.scoops.length, 1);
  const melted = tickIcecreamState(stable, config, 2110 + config.meltSeconds * 1000 + 1);
  assert.equal(melted.phase, 'failed'); assert.equal(melted.failure, 'melted');
  const timeout = tickIcecreamState(prepared(), config, 121001);
  assert.equal(timeout.failure, 'timeout');
});

test('verified displayed placement survives network delay without rewinding authoritative timestamps', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 9000);
  state = act(state, { type: 'scoop-start' }, 9100);
  state = act(state, { type: 'scoop-release' }, 10000);
  assert.equal(state.pendingScoop.readyAt, 10000);
  assert.equal(act(state, { type: 'place' }, 11901, 'bob').failure, 'toppled', 'receipt-time placement reproduces the production failure');
  const placed = applyIcecreamAction(state, { type: 'place' }, { playerId: 'bob', now: 11901, inputAt: 11470 }, config);
  assert.equal(placed.phase, 'making'); assert.equal(placed.scoops.length, 1);
  assert.ok(Math.abs(placed.scoops[0].offset - 0.1305261922200513) < 1e-10);
  assert.equal(placed.scoops[0].placedAt, 11901); assert.equal(placed.updatedAt, 11901);
  assert.equal(placed.firstPreparedAt, 10000, 'compensation does not delay melting');
});

test('verified release uses the visible hold duration but starts melting at actual receipt time', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 9000);
  state = act(state, { type: 'scoop-start' }, 10000);
  assert.equal(act(state, { type: 'scoop-release' }, 12300).pendingScoop, null);
  const released = applyIcecreamAction({ ...state, updatedAt: 12200 }, { type: 'scoop-release' },
    { playerId: 'alice', now: 12300, inputAt: 10900 }, config);
  assert.equal(released.pendingScoop.quality, 1); assert.equal(released.pendingScoop.readyAt, 12300);
  assert.equal(released.firstPreparedAt, 12300); assert.equal(released.updatedAt, 12300);
});

test('compensated input is bounded to the current station and cannot inject a future or arbitrary clock', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 9000);
  state = act(state, { type: 'scoop-start' }, 10000);
  for (const inputAt of [null, NaN, Infinity, -1, 10900.5, 12001, 9999, '10900']) {
    assert.throws(() => applyIcecreamAction(state, { type: 'scoop-release' }, { playerId: 'alice', now: 12000, inputAt }, config),
      error => error.code === 'input_timing_expired');
  }
  assert.throws(() => applyIcecreamAction(state, { type: 'scoop-release' }, { playerId: 'alice', now: 13000, inputAt: 10999 }, config),
    error => error.code === 'input_timing_expired');
  assert.throws(() => applyIcecreamAction(state, { type: 'serve' }, { playerId: 'alice', now: 12000, inputAt: 12000 }, config),
    error => error.code === 'input_timing_expired');
  const pending = act(state, { type: 'scoop-release' }, 10900);
  assert.throws(() => applyIcecreamAction(pending, { type: 'place' }, { playerId: 'alice', now: 12000, inputAt: 10899 }, config),
    error => error.code === 'input_timing_expired');
  assert.throws(() => applyIcecreamAction(pending, { type: 'place' }, { playerId: 'alice', now: 11500, inputAt: 10900 }, config),
    error => error.code === 'placement_not_ready', 'network transit cannot bypass the visible minimum placement wait');
});

test('late input cannot restore an expired tool, melted scoop or finished round', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 1200);
  state = act(state, { type: 'scoop-start' }, 1210);
  assert.throws(() => applyIcecreamAction(state, { type: 'scoop-release' }, { playerId: 'alice', now: 5210, inputAt: 4000 }, config),
    error => error.code === 'scoop_required');
  const pending = act(state, { type: 'scoop-release' }, 2110), meltAt = 2110 + config.meltSeconds * 1000;
  assert.throws(() => applyIcecreamAction(pending, { type: 'place' }, { playerId: 'alice', now: meltAt, inputAt: meltAt - 500 }, config),
    error => error.code === 'round_finished');
  const expired = tickIcecreamState(pending, config, meltAt);
  assert.throws(() => applyIcecreamAction(expired, { type: 'place' }, { playerId: 'alice', now: meltAt + 100, inputAt: meltAt - 500 }, config),
    error => error.code === 'round_finished');
  const lateRound = { ...pending, startedAt: 0, firstPreparedAt: 119500,
    pendingScoop: { ...pending.pendingScoop, readyAt: 119500 }, updatedAt: 119500 };
  assert.throws(() => applyIcecreamAction(lateRound, { type: 'place' }, { playerId: 'alice', now: 120000, inputAt: 119900 }, config),
    error => error.code === 'round_finished');
});

test('invalid actions cannot skip preparation or inject a score, clock or unknown flavor', () => {
  const fresh = createIcecreamState(config, 1000);
  assert.throws(() => act(fresh, { type: 'serve' }, 1000), /接单/);
  assert.throws(() => act(prepared(), { type: 'serve' }, 1200), /完成/);
  assert.throws(() => act(prepared(), { type: 'flavor', flavor: 'script' }, 1200), /口味/);
  assert.throws(() => act(prepared(), { type: 'scoop-start', score: 100 }, 1200), /字段/);
  assert.throws(() => act(prepared(), { type: 'scoop-start', now: 1234 }, 1200), /字段/);
  assert.throws(() => act(prepared(), { type: 'flavor', flavor: config.flavors[0] }, 900), /时间/);
});

test('wrong menu choices are playable but reduce the matching grade', () => {
  let state = act(createIcecreamState(config, 1000), { type: 'start' }, 1000);
  state = act(state, { type: 'container', container: state.order.container === 'cup' ? 'cone' : 'cup' }, 1100);
  let now = 1200;
  for (const ignored of state.order.flavors) {
    state = scoop(state, now, 'alice', config.flavors.find(flavor => flavor !== state.order.flavors[state.scoops.length])); now += 1800;
  }
  state = act(state, { type: 'topping', topping: config.toppings.find(topping => topping !== state.order.topping) }, now);
  state = act(state, { type: 'serve' }, now + 10);
  assert.equal(state.result.match, 0); assert.ok(state.result.score < 50);
});

test('a disconnected cook cannot freeze a pending scoop and cold visits retain finished results', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 1200);
  state = act(state, { type: 'scoop-start' }, 1210);
  const pending = act(state, { type: 'scoop-release' }, 2110);
  const handedOff = act(pending, { type: 'place' }, 2830, 'bob');
  assert.equal(handedOff.scoops[0].playerId, 'bob', 'another cook may take over placing a prepared scoop');
  const cold = tickIcecreamState(pending, config, 62110);
  assert.equal(cold.failure, 'melted'); assert.equal(cold.pendingScoop, null);
  assert.equal(pending.pendingScoop.playerId, 'alice', 'a snapshot tick does not mutate the stored input');
  let completed = prepared(), now = 1200;
  for (const ignored of completed.order.flavors) { completed = scoop(completed, now); now += 1800; }
  completed = act(completed, { type: 'topping', topping: completed.order.topping }, now);
  completed = act(completed, { type: 'serve' }, now + 10);
  assert.equal(tickIcecreamState(completed, config, 1000000), completed, 'finished score and geometry time remain frozen after returning');
});

test('three failed scoops end the round and a collaborator replay clears mistakes and ownership', () => {
  let state = prepared();
  state = act(state, { type: 'flavor', flavor: config.flavors[0] }, 1200);
  for (let i = 0; i < 3; i++) {
    state = act(state, { type: 'scoop-start' }, 1300 + i * 200);
    state = act(state, { type: 'scoop-release' }, 1310 + i * 200);
  }
  assert.equal(state.failure, 'wasted'); assert.equal(state.result, null);
  const reset = act(state, { type: 'replay' }, 2000, 'bob');
  assert.equal(reset.mistakes, 0); assert.equal(reset.activeScoop, null);
  assert.equal(reset.pendingScoop, null); assert.deepEqual(reset.contributors, ['bob']);
});

test('config validation bounds every runtime setting and rejects unknown authoring fields', () => {
  assert.deepEqual(validateIcecreamConfig(config), config);
  for (const patch of [{ roundSeconds: 0 }, { meltSeconds: Infinity }, { maxScoops: 7 }, { seed: -1 },
    { flavors: [] }, { flavors: ['vanilla', 'vanilla'] }, { toppings: ['<img>'] }, { script: 'alert()' }]) {
    assert.throws(() => validateIcecreamConfig({ ...config, ...patch }));
  }
});
