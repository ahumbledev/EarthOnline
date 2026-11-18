import { CITY_AOI_ENTER_RADIUS, CITY_AOI_EXIT_RADIUS, CITY_AOI_HEIGHT, MAX_VISIBLE_PLAYERS } from './visibility-rules.mjs';

const CELL_SIZE = 40;
const RETENTION_BIAS = 6;
const valid = pose => pose && [pose.x, pose.y, pose.z].every(Number.isFinite);
const compare = (a, b) => a.score - b.score || a.player.playerId.localeCompare(b.player.playerId) || a.ordinal - b.ordinal;

// The root is the worst retained candidate, including the original order for
// equal scores and locale-equivalent IDs. Replacing it cannot disturb ties.
function siftDown(heap, index) {
  const value = heap[index];
  for (let child = index * 2 + 1; child < heap.length; child = index * 2 + 1) {
    if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) > 0) child++;
    if (compare(heap[child], value) <= 0) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = value;
}

/** Rebuilt once per patch, shared by all observers; no all-city scan per client. */
export function createCitySpatialIndex(players) {
  const cells = new Map();
  for (const player of players) {
    if (!valid(player)) continue;
    const key = `${Math.floor(player.x / CELL_SIZE)}:${Math.floor(player.z / CELL_SIZE)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(player);
  }
  return {
    query(position) {
      if (!valid(position)) return [];
      const found = [];
      for (let x = Math.floor((position.x - CITY_AOI_EXIT_RADIUS) / CELL_SIZE); x <= Math.floor((position.x + CITY_AOI_EXIT_RADIUS) / CELL_SIZE); x++) {
        for (let z = Math.floor((position.z - CITY_AOI_EXIT_RADIUS) / CELL_SIZE); z <= Math.floor((position.z + CITY_AOI_EXIT_RADIUS) / CELL_SIZE); z++) {
          found.push(...(cells.get(`${x}:${z}`) || []));
        }
      }
      return found;
    },
  };
}

// Both callers share exactly the same eligibility, retention and stable top-K
// cutoff. Only consumers of near-player priority need to order the final heap.
function selectCandidates(observer, candidates, previous, limit) {
  if (!valid(observer)) return [];
  // Match Array.slice's positive fractional/NaN limit behavior after the
  // existing clamp. The heap never retains more than the public player budget.
  const count = Math.trunc(Math.min(MAX_VISIBLE_PLAYERS, Math.max(0, limit))) || 0;
  const eligible = [];
  let ordinal = 0, heapReady = false;
  for (const player of candidates) {
    if (!valid(player) || player.playerId === observer.playerId || Math.abs(player.y - observer.y) > CITY_AOI_HEIGHT) continue;
    const distance = Math.hypot(player.x - observer.x, player.z - observer.z);
    const retained = previous.has(player.playerId);
    if (distance > (retained ? CITY_AOI_EXIT_RADIUS : CITY_AOI_ENTER_RADIUS)) continue;
    // A newcomer must be materially closer to replace a retained boundary actor.
    if (!count) continue;
    const candidate = { player, score: Math.max(0, distance - (retained ? RETENTION_BIAS : 0)), ordinal: ordinal++ };
    if (eligible.length < count) { eligible.push(candidate); continue; }
    if (!heapReady) {
      for (let index = Math.floor(eligible.length / 2) - 1; index >= 0; index--) siftDown(eligible, index);
      heapReady = true;
    }
    if (compare(candidate, eligible[0]) < 0) {
      eligible[0] = candidate;
      siftDown(eligible, 0);
    }
  }
  return eligible;
}

/** Ordered nearest players; the zone cache uses this priority for its near-player list. */
export function selectCityVisibility(observer, candidates, previous = new Set(), limit = MAX_VISIBLE_PLAYERS) {
  return selectCandidates(observer, candidates, previous, limit).sort(compare).map(item => item.player);
}

/** Same top-K player identities, with no ordering guarantee. Self remains outside this budget. */
export function selectCityMembership(observer, candidates, previous = new Set(), limit = MAX_VISIBLE_PLAYERS) {
  return selectCandidates(observer, candidates, previous, limit).map(item => item.player);
}
