import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCityVisibility, selectCityMembership } from '../../server/city-aoi.mjs';
import { CITY_AOI_ENTER_RADIUS, CITY_AOI_EXIT_RADIUS, CITY_AOI_HEIGHT, MAX_VISIBLE_PLAYERS } from '../../server/visibility-rules.mjs';

// Independent full-sort reference implementation. Do not replace this oracle
// with the production selector: the two algorithms must agree independently.
function fullSort(observer, candidates, previous = new Set(), limit = MAX_VISIBLE_PLAYERS) {
  const valid = pose => pose && [pose.x, pose.y, pose.z].every(Number.isFinite);
  if (!valid(observer)) return [];
  const eligible = [];
  for (const player of candidates) {
    if (!valid(player) || player.playerId === observer.playerId || Math.abs(player.y - observer.y) > CITY_AOI_HEIGHT) continue;
    const distance = Math.hypot(player.x - observer.x, player.z - observer.z);
    const retained = previous.has(player.playerId);
    if (distance > (retained ? CITY_AOI_EXIT_RADIUS : CITY_AOI_ENTER_RADIUS)) continue;
    eligible.push({ player, score: Math.max(0, distance - (retained ? 6 : 0)) });
  }
  eligible.sort((a, b) => a.score - b.score || a.player.playerId.localeCompare(b.player.playerId));
  return eligible.slice(0, Math.min(MAX_VISIBLE_PLAYERS, Math.max(0, limit))).map(item => item.player);
}

const player = (playerId, x = 0, z = 0, y = 0) => ({ playerId, x, y, z });
const observer = player('self');
function sameSelection(candidates, previous, limit, position = observer) {
  const expected = fullSort(position, candidates, previous, limit);
  const actual = selectCityVisibility(position, candidates.values(), previous, limit);
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i++) assert.equal(actual[i], expected[i], `same player object and order at ${i}`);
  const membership = selectCityMembership(position, candidates.values(), previous, limit);
  assert.equal(membership.length, expected.length, 'unordered selector retains the same cutoff count');
  const remaining = new Map();
  for (const value of expected) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const value of membership) {
    assert.ok(remaining.get(value) > 0, 'unordered selection must preserve object identity and multiplicity, not merely player IDs');
    remaining.set(value, remaining.get(value) - 1);
  }
  return actual;
}

test('top-K preserves filtering, exact distance/height boundaries, retention and existing limit coercion', () => {
  const candidates = [null, undefined, observer, player('bad-x', NaN), player('bad-y', 0, 0, Infinity),
    player('bad-z', 0, '0'), player('enter', 80), player('outside-enter', 80.000001),
    player('retained-edge', 100), player('outside-exit', 100.000001),
    player('floor-edge', 1, 0, 8), player('outside-floor', 1, 0, 8.000001),
    ...Array.from({ length: 180 }, (_, i) => player(`peer-${i}`, (i * 37) % 79))];
  const previous = new Set(['retained-edge', 'outside-exit', 'peer-13', 'peer-66']);
  const original = candidates.slice(), oldPrevious = [...previous];
  for (const limit of [undefined, -Infinity, -10, -0, 0, .5, 1, 1.9, 20, 79, 79.9, 100, 101, Infinity, NaN,
    null, false, true, '', '3.7', 'invalid', { valueOf: () => 2.5 }]) {
    sameSelection(candidates, previous, limit);
  }
  for (const position of [null, {}, player('invalid', Infinity)]) {
    assert.deepEqual(selectCityVisibility(position, candidates), []);
    assert.deepEqual(selectCityMembership(position, candidates), []);
  }
  assert.throws(() => selectCityVisibility(observer, candidates, previous, 1n), TypeError);
  assert.throws(() => selectCityVisibility(observer, candidates, previous, Symbol('limit')), TypeError);
  assert.throws(() => selectCityMembership(observer, candidates, previous, 1n), TypeError);
  assert.throws(() => selectCityMembership(observer, candidates, previous, Symbol('limit')), TypeError);
  assert.deepEqual(candidates, original, 'candidate order is not mutated');
  assert.deepEqual([...previous], oldPrevious, 'retention history is not mutated');
});

test('top-K retains original stable order for duplicate and locale-equivalent IDs at the cutoff', () => {
  const ids = ['same', 'é', 'e\u0301', 'a', 'A', 'z', '10', '2'];
  const candidates = Array.from({ length: 320 }, (_, i) => ({ ...player(ids[i % ids.length], 4), ordinal: i }));
  for (const values of [candidates, candidates.slice().reverse()]) {
    for (const previous of [new Set(), new Set(ids)]) {
      for (const limit of [1, 2, 3, 20, 79, 100]) sameSelection(values, previous, limit);
    }
  }
  const duplicates = Array.from({ length: 200 }, (_, i) => ({ ...player('duplicate', 40), ordinal: i }));
  assert.deepEqual(sameSelection(duplicates, new Set(), 79), duplicates.slice(0, 79));
  const repeated = player('repeated-object', 4);
  sameSelection([...duplicates, ...Array(101).fill(repeated)], new Set(), 100);
});

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

test('deterministic randomized top-K matches the frozen full sort across dense, invalid and tied candidates', () => {
  const random = randomGenerator(0x51a07e);
  const limits = [0, 1, 2, 20, 79, 79.5, 100, 250, NaN];
  for (let round = 0; round < 240; round++) {
    const size = Math.floor(random() * 2200), previous = new Set();
    const position = player('self', Math.floor(random() * 30), Math.floor(random() * 30), Math.floor(random() * 5));
    const candidates = Array.from({ length: size }, (_, i) => {
      const id = i % 31 === 0 ? 'self' : i % 13 === 0 ? 'duplicate' : `peer-${Math.floor(random() * 200)}`;
      if (random() < .4) previous.add(id);
      const value = player(id, position.x + Math.floor(random() * 210) - 105,
        position.z + Math.floor(random() * 210) - 105, position.y + Math.floor(random() * 20) - 10);
      if (i % 17 === 0) Object.assign(value, { x: position.x + 4, y: position.y, z: position.z });
      if (i % 47 === 0) value.x = NaN;
      if (i % 59 === 0) value.y = Infinity;
      return value;
    });
    sameSelection(candidates, previous, limits[round % limits.length], position);
  }
});

test('top-K follows independent retention history through movement, entries, removals and height changes', () => {
  const random = randomGenerator(0x6b0913);
  let candidates = Array.from({ length: 300 }, (_, i) => player(`peer-${i}`, random() * 150 - 75, random() * 150 - 75));
  let previous = new Set();
  for (let tick = 0; tick < 80; tick++) {
    const expected = fullSort(observer, candidates, previous, 79);
    sameSelection(candidates, previous, 79);
    previous = new Set(expected.map(value => value.playerId));
    candidates = candidates.slice(3);
    candidates.push(...Array.from({ length: 3 }, (_, i) => player(`new-${tick}-${i}`, random() * 180 - 90, random() * 180 - 90)));
    for (let i = 0; i < 20; i++) {
      const value = candidates[Math.floor(random() * candidates.length)];
      value.x += random() * 10 - 5;
      value.y = random() < .1 ? 9 : 0;
    }
  }
});
