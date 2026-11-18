import { generateFishCatch, getFishSpecies, type FishCatch, type FishId } from './fish-catalog.ts';
import { FISH_BEHAVIORS, fishBehaviorAt, biteFeedbackAt, type FishMove } from './fish-behavior.ts';
import { getWaterActivity } from './water-activity.ts';
import { evaluateFightResponse } from './fight-response.ts';
import { emptyFishingFeedback, LINE_METRES_PER_TURN, type BiteStage } from './feedback.ts';

export type FishingPhase = 'ready' | 'casting' | 'waiting' | 'bite' | 'reeling' | 'caught' | 'escaped';
export const CAST_DURATION = 1.35;
const FINAL_RUN_SECONDS = 3.6;
const BANK_CONTROL_SECONDS = 1.2;
export type FishingZone = 'shallows' | 'reeds' | 'mud-bay' | 'inlet';
export type FishingBait = 'worm' | 'corn' | 'insect' | 'minnow';
export type FishingDepth = 'surface' | 'mid' | 'bottom';
export interface FishingSetup {
  zone: FishingZone;
  bait: FishingBait;
  depth: FishingDepth;
  /** Equipment multipliers: 1 is the borrowed starter tackle. */
  rodPower: number;
  lineStrength: number;
  lineStretch: number;
  biteSensitivity: number;
  leader: boolean;
  novice: boolean;
  /** Onboarding may prefer a fish only when the location and bait support it. */
  preferredSpecies?: FishId;
  /** Supplied only after the scene matches the actual cast position to a water clue. */
  activityId?: string;
}
export interface FishingControls {
  reeling: boolean;
  /** -1 left, +1 right. Oppose the fish's pull. */
  rodDirection?: number;
  /** -1 low, +1 high. Lower the rod for jumps and the final net approach. */
  rodAngle?: number;
  /** 0 free spool, 1 locked. */
  drag?: number;
  /** Nearest geometrically safe water point, as horizontal metres from the player. */
  landingDistance?: number;
  /** The scene confirms a reachable bank and a clear final approach. */
  landingAvailable?: boolean;
}
export type FishingFailure = 'missed-bite' | 'early-strike' | 'line-broke' | 'hook-slipped' | 'no-interest' | null;
export type FishingEventType = 'castRelease' | 'waterImpact' | 'biteCommitted' | 'hookSet' | 'reelStart' | 'reelStop' | 'dragPayout' | 'fishSurge' | 'counterSuccess' | 'landed' | 'released' | 'escaped';
export interface FishingEvent { type: FishingEventType; serial: number; strength: number }
export interface FishEncounter { speciesId: FishId; lengthCm: number; weightKg: number; seed: number }
export const DEFAULT_FISHING_SETUP: Readonly<FishingSetup> = Object.freeze({ zone: 'shallows', bait: 'worm', depth: 'mid', rodPower: 1, lineStrength: 1, lineStretch: 1, biteSensitivity: 1, leader: false, novice: true });

interface FishEncounterHabitat {
  zones: readonly FishingZone[];
  baits: readonly FishingBait[];
  depths: readonly FishingDepth[];
}
/** Fictional Songlan Lake encounter rules, not a wild distribution or real bait prescription.
 * Outside visible activity, equal selection within small location/bait/depth pools keeps every page attainable.
 * The six original entries retain their existing eligible setups. */
export const FISH_ENCOUNTER_HABITATS: Readonly<Record<FishId, FishEncounterHabitat>> = {
  bluegill: { zones: ['shallows', 'reeds'], baits: ['worm', 'insect'], depths: ['surface', 'mid'] },
  'yellow-perch': { zones: ['shallows', 'mud-bay', 'inlet'], baits: ['worm', 'minnow'], depths: ['mid', 'bottom'] },
  'largemouth-bass': { zones: ['reeds'], baits: ['minnow'], depths: ['surface', 'mid'] },
  'common-carp': { zones: ['mud-bay'], baits: ['corn'], depths: ['bottom'] },
  'rainbow-trout': { zones: ['inlet'], baits: ['insect'], depths: ['surface', 'mid'] },
  'northern-pike': { zones: ['reeds'], baits: ['minnow'], depths: ['surface', 'mid', 'bottom'] },
  pumpkinseed: { zones: ['shallows', 'reeds'], baits: ['worm', 'insect'], depths: ['surface', 'mid'] },
  'redear-sunfish': { zones: ['shallows'], baits: ['worm'], depths: ['bottom'] },
  'green-sunfish': { zones: ['shallows', 'reeds'], baits: ['worm', 'insect'], depths: ['surface', 'mid'] },
  'black-crappie': { zones: ['reeds'], baits: ['minnow'], depths: ['mid'] },
  'white-crappie': { zones: ['mud-bay'], baits: ['minnow'], depths: ['mid', 'bottom'] },
  'rock-bass': { zones: ['shallows', 'inlet'], baits: ['worm'], depths: ['mid', 'bottom'] },
  'smallmouth-bass': { zones: ['inlet'], baits: ['minnow'], depths: ['mid', 'bottom'] },
  'spotted-bass': { zones: ['inlet', 'reeds'], baits: ['minnow'], depths: ['bottom'] },
  'white-bass': { zones: ['inlet'], baits: ['minnow'], depths: ['surface', 'mid'] },
  'striped-bass': { zones: ['inlet'], baits: ['minnow'], depths: ['mid', 'bottom'] },
  walleye: { zones: ['inlet', 'mud-bay'], baits: ['minnow'], depths: ['bottom'] },
  zander: { zones: ['mud-bay'], baits: ['minnow'], depths: ['bottom'] },
  'brown-trout': { zones: ['inlet'], baits: ['insect', 'minnow'], depths: ['mid'] },
  'brook-trout': { zones: ['inlet'], baits: ['insect'], depths: ['surface', 'mid'] },
  'lake-trout': { zones: ['inlet'], baits: ['minnow'], depths: ['bottom'] },
  'atlantic-salmon': { zones: ['inlet'], baits: ['insect', 'minnow'], depths: ['surface'] },
  'chain-pickerel': { zones: ['reeds'], baits: ['minnow'], depths: ['surface', 'mid'] },
  muskellunge: { zones: ['reeds'], baits: ['minnow'], depths: ['mid', 'bottom'] },
  'grass-carp': { zones: ['reeds', 'mud-bay'], baits: ['corn'], depths: ['mid', 'bottom'] },
  'silver-carp': { zones: ['mud-bay'], baits: ['corn'], depths: ['mid'] },
  'crucian-carp': { zones: ['mud-bay'], baits: ['corn', 'worm'], depths: ['bottom'] },
  'common-bream': { zones: ['mud-bay'], baits: ['corn', 'worm'], depths: ['bottom'] },
  roach: { zones: ['shallows'], baits: ['worm', 'insect'], depths: ['mid'] },
  tench: { zones: ['mud-bay', 'reeds'], baits: ['corn', 'worm'], depths: ['bottom'] },
};
const ZONES: readonly FishingZone[] = ['shallows', 'reeds', 'mud-bay', 'inlet'];
const BAITS: readonly FishingBait[] = ['worm', 'corn', 'insect', 'minnow'];
const DEPTHS: readonly FishingDepth[] = ['surface', 'mid', 'bottom'];
export function eligibleFish(setup: Pick<FishingSetup, 'zone' | 'bait' | 'depth'>): FishId[] {
  return (Object.keys(FISH_ENCOUNTER_HABITATS) as FishId[]).filter(id => {
    const habitat = FISH_ENCOUNTER_HABITATS[id];
    return habitat.zones.includes(setup.zone) && habitat.baits.includes(setup.bait) && habitat.depths.includes(setup.depth);
  });
}
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** A deterministic local encounter. Catch identity and size are fixed before the first nibble. */
export function createFishingSession(random: () => number = Math.random) {
  const state = {
    phase: 'ready' as FishingPhase, phaseTime: 0, distance: 0, castDistance: 0, tension: 0, weight: 0, length: 0, catches: 0, nibble: 0, catch: null as FishCatch | null,
    encounter: null as FishEncounter | null, setup: { ...DEFAULT_FISHING_SETUP } as FishingSetup,
    behavior: 'steady' as FishMove | 'steady' | 'recover', telegraph: false, pullDirection: 0, recommendedDirection: 0,
    jumping: false, diving: false, behaviorProgress: 0, fatigue: 0, drag: .55, lineDamage: 0, slackTime: 0, overloadTime: 0,
    counterCount: 0, counteredMoves: [] as FishMove[], lastCounter: null as FishMove | null, openingRemaining: 0,
    landingProgress: 0, landingDistance: .7, landingAvailable: true, bankApproach: false, bankControl: 0, bankReady: false,
    biteWindow: 3, payout: false, reeling: false, rodDirection: 0, rodAngle: 0,
    biteStage: 'quiet' as BiteStage, feedback: emptyFishingFeedback(),
    cue: '' as 'wrong-bait' | 'strike' | 'ease-line' | 'keep-contact' | 'lower-rod' | 'bring-to-water' | 'settle-fish' | '',
    failureReason: null as FishingFailure, eventSerial: 0, event: null as FishingEvent | null,
  };
  let biteAfter = 8, pendingCatch: FishCatch | null = null, accumulator = 0, releasedCast = false, lastMove = '', lastPayout = false, finalPikeTime = -1;
  // Fatigue stretches recovery locally; changing fatigue never rebuilds the
  // stateless seeded beat schedule or moves another session into a new phase.
  let behaviorClock = 0, finalRunRecovered = false;
  // A response is judged over the whole attack, including both halves of a
  // switchback. Releasing or toggling for a single frame cannot farm openings.
  let counterAttempt: { key: string; move: FishMove; seconds: number; good: number; sides: Map<number, { seconds: number; good: number }> } | null = null;
  const events: FishingEvent[] = [];
  function emit(type: FishingEventType, strength = 1) {
    const event = { type, serial: ++state.eventSerial, strength };
    state.event = event; events.push(event);
    if (events.length > 64) events.shift();
  }
  function enter(phase: FishingPhase) {
    state.phase = phase; state.phaseTime = 0; state.nibble = 0;
    state.biteStage = phase === 'bite' ? 'take' : 'quiet';
    Object.assign(state.feedback, emptyFishingFeedback());
    if (phase === 'bite') state.feedback.bitePulse = 1;
    if (phase === 'reeling') state.feedback.load = state.tension;
  }
  function configure(patch: Partial<FishingSetup>) {
    if (state.phase !== 'ready' && state.phase !== 'escaped') return false;
    const next = { ...state.setup, ...patch };
    if (!ZONES.includes(next.zone) || !BAITS.includes(next.bait) || !DEPTHS.includes(next.depth)) return false;
    for (const key of ['rodPower', 'lineStrength', 'lineStretch', 'biteSensitivity'] as const) next[key] = clamp(finite(next[key], 1), .4, 2.5);
    next.novice = !!next.novice; next.leader = !!next.leader;
    const activity = getWaterActivity(next.activityId);
    if (!activity || activity.zone !== next.zone || activity.bait !== next.bait || activity.depth !== next.depth
      || !eligibleFish(next).some(id => activity.targetSpecies.includes(id))) next.activityId = undefined;
    state.setup = next; return true;
  }
  function sample() {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Fishing RNG must return a finite number between 0 and 1');
    return Math.min(1 - Number.EPSILON, value);
  }
  function escape(reason: Exclude<FishingFailure, null>) {
    if (state.reeling) emit('reelStop');
    state.failureReason = reason; state.payout = false; state.reeling = false;
    state.openingRemaining = 0; state.bankApproach = false; state.bankControl = 0; state.bankReady = false; counterAttempt = null;
    emit('escaped'); enter('escaped');
  }
  function cast(power = .7, patch?: Partial<FishingSetup>) {
    if (state.phase !== 'ready' && state.phase !== 'escaped') return false;
    if (patch && !configure(patch)) return false;
    const setup = state.setup, candidates = eligibleFish(setup), choice = sample();
    const preferred = setup.preferredSpecies ?? (setup.novice && candidates.includes('bluegill') ? 'bluegill' : undefined);
    const activity = getWaterActivity(setup.activityId);
    const weights = candidates.map(id => activity?.targetSpecies.includes(id) ? 3 : 1);
    let roll = choice * weights.reduce((sum, weight) => sum + weight, 0);
    const weightedChoice = candidates.find((_, i) => (roll -= weights[i]) < 0);
    const speciesId = preferred && candidates.includes(preferred) ? preferred : weightedChoice;
    pendingCatch = speciesId ? generateFishCatch(random, { speciesId }) : null;
    state.encounter = pendingCatch ? { speciesId: pendingCatch.speciesId, lengthCm: pendingCatch.lengthCm, weightKg: pendingCatch.weightKg, seed: sample() } : null;
    biteAfter = speciesId ? (setup.novice ? 6 : 8) + sample() * (setup.novice ? 3 : 12) : 10;
    if (activity && speciesId) biteAfter *= .8;
    state.biteWindow = setup.novice ? 3 : speciesId ? FISH_BEHAVIORS[speciesId].biteWindow * clamp(setup.biteSensitivity, .85, 1.25) : 2;
    state.castDistance = 8 + clamp(finite(power, .7), 0, 1) * (19 + setup.rodPower * 3);
    state.distance = state.castDistance; state.tension = 0; state.catch = null; state.weight = 0; state.length = 0;
    state.fatigue = 0; state.lineDamage = 0; state.slackTime = 0; state.overloadTime = 0; state.landingProgress = 0; state.landingDistance = .7; state.landingAvailable = true;
    state.bankApproach = false; state.bankControl = 0; state.bankReady = false;
    state.failureReason = null; state.cue = ''; state.telegraph = false; state.jumping = false; state.diving = false;
    state.pullDirection = 0; state.recommendedDirection = 0; state.behavior = 'steady'; state.behaviorProgress = 0;
    state.counterCount = 0; state.counteredMoves = []; state.lastCounter = null; state.openingRemaining = 0; counterAttempt = null;
    state.payout = false; state.reeling = false; releasedCast = false; lastPayout = false; lastMove = ''; finalPikeTime = -1;
    behaviorClock = 0; finalRunRecovered = false;
    accumulator = 0; enter('casting'); return true;
  }
  function hook() {
    if (state.phase === 'waiting') { escape('early-strike'); return false; }
    if (state.phase !== 'bite' || !pendingCatch) return false;
    state.tension = .38; state.cue = ''; emit('hookSet'); enter('reeling'); return true;
  }
  function release() {
    if (state.phase !== 'caught') return false;
    state.distance = 0; state.tension = 0; emit('released'); enter('ready'); return true;
  }
  function keep() {
    if (state.phase !== 'caught') return false;
    state.distance = 0; state.tension = 0; enter('ready'); return true;
  }
  function retrieve() {
    if (state.phase !== 'casting' && state.phase !== 'waiting' && state.phase !== 'bite') return false;
    pendingCatch = null; state.encounter = null; state.catch = null;
    state.distance = 0; state.castDistance = 0; state.tension = 0; state.weight = 0; state.length = 0;
    state.cue = ''; state.failureReason = null; state.reeling = false; state.payout = false;
    state.telegraph = false; state.jumping = false; state.diving = false; state.behavior = 'steady';
    state.behaviorProgress = 0; state.pullDirection = 0; state.recommendedDirection = 0;
    state.openingRemaining = 0; state.bankApproach = false; state.bankControl = 0; state.bankReady = false; counterAttempt = null;
    accumulator = 0; releasedCast = false; lastPayout = false; lastMove = '';
    enter('ready'); return true;
  }
  /** Radial change from the scene's actual player/fish world positions, in metres. */
  function applyPlayerMovement(distanceDelta: number) {
    if (!Number.isFinite(distanceDelta) || state.phase !== 'waiting' && state.phase !== 'bite' && state.phase !== 'reeling') return 0;
    const before = state.distance, limit = state.castDistance + 12 * state.setup.lineStrength;
    state.distance = clamp(before + clamp(distanceDelta, -.5, .5), Math.min(state.landingDistance, limit), limit);
    if (state.distance > state.landingDistance + .2) { state.landingProgress = 0; state.bankApproach = false; state.bankReady = false; }
    if (state.distance > state.landingDistance + 1) state.bankControl = 0;
    if (state.distance > limit - 1) state.cue = 'ease-line';
    else if (state.cue === 'ease-line' && state.overloadTime <= .25) state.cue = state.phase === 'bite' ? 'strike' : '';
    return state.distance - before;
  }
  function fight(dt: number, input: FishingControls) {
    const encounter = state.encounter!, setup = state.setup;
    state.openingRemaining = Math.max(0, state.openingRemaining - dt);
    // The final bank rush interrupts the ordinary schedule. Restart with its
    // quiet opening afterwards, rather than resuming halfway into an attack
    // while the HUD is inviting the player to reel their earned advantage.
    if (finalPikeTime >= 0 && state.phaseTime - finalPikeTime >= FINAL_RUN_SECONDS && !finalRunRecovered) {
      behaviorClock = 0; finalRunRecovered = true;
    }
    behaviorClock += dt / (state.behavior === 'recover' ? 1 + state.fatigue * .15 : 1);
    const behavior = fishBehaviorAt(encounter.speciesId, behaviorClock, encounter.seed, state.fatigue, setup.novice);
    const controlledApproach = state.counterCount >= 2 && state.fatigue >= .45;
    if (FISH_BEHAVIORS[encounter.speciesId].moves.includes('last-run') && finalPikeTime < 0
      && state.distance < state.landingDistance + 3.3 && (state.fatigue >= .65 || controlledApproach)) finalPikeTime = state.phaseTime;
    const finalRun = finalPikeTime >= 0 && state.phaseTime - finalPikeTime < FINAL_RUN_SECONDS;
    if (finalRun) {
      const elapsed = state.phaseTime - finalPikeTime;
      behavior.move = 'last-run'; behavior.telegraph = elapsed < 1.1; behavior.force = elapsed < 1.1 ? .7 : 1.65;
      behavior.direction = encounter.seed < .5 ? -1 : 1; behavior.jumping = false; behavior.diving = false; behavior.progress = clamp((elapsed - 1.1) / 2.5, 0, 1);
      behavior.warningProgress = clamp(elapsed / 1.1, 0, 1);
    }
    state.behavior = behavior.move; state.telegraph = behavior.telegraph; state.behaviorProgress = behavior.progress;
    state.pullDirection = behavior.direction; state.recommendedDirection = -Math.sign(behavior.direction);
    state.jumping = behavior.jumping; state.diving = behavior.diving;
    const moveKey = `${behavior.cycle}:${behavior.move}:${behavior.telegraph}`;
    if (moveKey !== lastMove && !behavior.telegraph && behavior.move !== 'recover' && behavior.move !== 'steady') emit('fishSurge', behavior.force);
    lastMove = moveKey;
    state.rodDirection = clamp(finite(input.rodDirection, 0), -1, 1); state.rodAngle = clamp(finite(input.rodAngle, 0), -1, 1);
    state.drag = clamp(finite(input.drag, state.drag), 0, 1);
    const steering = -state.rodDirection * Math.sign(behavior.direction), correct = Math.max(0, steering), wrong = Math.max(0, -steering);
    const hasMove = behavior.move !== 'steady' && behavior.move !== 'recover';
    const attackKey = hasMove ? finalRun ? 'final-run' : `${behavior.cycle}:${behavior.move}` : '';
    if (counterAttempt && attackKey !== counterAttempt.key) {
      const attempt = counterAttempt;
      const completed = behavior.move === 'recover' || attempt.key === 'final-run' && !finalRun;
      const bothSidesRead = attempt.move !== 'switchback' || attempt.sides.size === 2 && [...attempt.sides.values()].every(side => side.good >= side.seconds * .6);
      if (completed && attempt.seconds >= .35 && attempt.good >= attempt.seconds * .68 && bothSidesRead) {
        state.counterCount++; state.lastCounter = attempt.move;
        if (!state.counteredMoves.includes(attempt.move)) state.counteredMoves.push(attempt.move);
        // Sensitivity gives light tackle a slightly longer opportunity; power
        // already determines the metres gained while the reel is held.
        state.openingRemaining = 2.4 + clamp(setup.biteSensitivity - 1, -.2, .25) * .6;
        emit('counterSuccess');
      }
      counterAttempt = null;
    }
    if (hasMove && !behavior.telegraph) {
      if (!counterAttempt) counterAttempt = { key: attackKey, move: behavior.move as FishMove, seconds: 0, good: 0, sides: new Map() };
      const good = evaluateFightResponse(state, input.reeling).correct;
      counterAttempt.seconds += dt; if (good) counterAttempt.good += dt;
      const side = Math.sign(behavior.direction), held = counterAttempt.sides.get(side) ?? { seconds: 0, good: 0 };
      held.seconds += dt; if (good) held.good += dt; counterAttempt.sides.set(side, held);
    }
    const size = getFishSpecies(encounter.speciesId).size;
    const sizeFraction = (encounter.lengthCm - size.minCm) / (size.maxCm - size.minCm);
    const sizePower = .8 + .7 * sizeFraction;
    const equipment = setup.rodPower * .35 + setup.lineStrength * .65;
    const profile = FISH_BEHAVIORS[encounter.speciesId];
    let force = behavior.force * profile.pressure * sizePower * (setup.novice ? .67 : 1) / equipment;
    if (behavior.jumping) force *= state.rodAngle < -.25 ? .65 : state.rodAngle > .25 ? 1.4 : 1.1;
    if (behavior.move === 'dive' && !behavior.telegraph && state.rodAngle > .35) force *= .88;
    const lineLimit = state.castDistance + 12 * setup.lineStrength;
    const limitPressure = state.distance > lineLimit - 1 ? .18 : 0;
    const opening = state.openingRemaining > 0;
    const pullTarget = .10 + state.drag * .43 + force * .24 + (input.reeling ? .29 : -.08) - correct * .15 * setup.rodPower + wrong * .18 + limitPressure - (opening && input.reeling ? .045 : 0);
    // Side pressure cannot erase the contact held by a nonzero reel drag. This
    // keeps an upgraded rod from paradoxically making a controlled jump go slack.
    const target = clamp(Math.max(.05 + state.drag * .5, pullTarget), 0, 1.16);
    state.tension += (target - state.tension) * (1 - Math.exp(-dt * (5 / setup.lineStretch)));
    state.tension = clamp(state.tension, 0, 1);
    state.overloadTime = state.tension > .92 ? state.overloadTime + dt : Math.max(0, state.overloadTime - dt * 2);
    const highGrace = (setup.novice ? 1.3 : .8) * clamp(Math.sqrt(setup.lineStretch), .85, 1.25);
    if (state.tension > .92 && state.overloadTime > highGrace) state.lineDamage += dt * (['northern-pike', 'chain-pickerel', 'muskellunge'].includes(encounter.speciesId) && !setup.leader ? .55 : .35);
    else if (state.tension < .8) state.lineDamage = Math.max(0, state.lineDamage - dt * .045);
    state.slackTime = state.tension < .16 ? state.slackTime + dt : Math.max(0, state.slackTime - dt * 1.5);
    state.cue = state.overloadTime > .25 || limitPressure > 0 ? 'ease-line' : state.slackTime > .65 ? 'keep-contact' : '';
    const usefulTension = state.tension >= .23 && state.tension <= .84;
    // A stronger rod tires a fish faster only while the player capitalises on
    // an earned opening. Buying power cannot replace the response itself.
    const controlledPressure = opening && input.reeling ? 1 + clamp(setup.rodPower - 1, 0, .6) * 1.6 : 1;
    if (usefulTension) state.fatigue = Math.min(1, state.fatigue + dt * profile.fatigueRate * (setup.novice ? 1.55 : 1) / (.9 + sizeFraction * .4) * (input.reeling ? 1 : .55) * (1 + correct * .35) * controlledPressure);
    const canReel = input.reeling && state.tension < .91;
    // High contact load progressively slows a working reel before its existing
    // stall threshold. The quiet/new-player range retains its original speed.
    const resistance = clamp((state.tension - .7) / .21, 0, 1);
    const reelEfficiency = 1 - .6 * resistance * resistance * (3 - 2 * resistance);
    const retrieval = canReel ? .97 * setup.rodPower * (.6 + state.fatigue * .75) * (1 + correct * .18) * (opening ? 1.65 : 1) * reelEfficiency : 0;
    const givesLine = !input.reeling && force > .75 && state.drag < .85;
    const payout = givesLine ? (.3 + force * .4) * (1 - state.drag) : 0;
    // A changed water boundary can correct distance, but that is not spool travel.
    const before = clamp(state.distance, state.landingDistance, lineLimit);
    state.distance = clamp(before + (payout - retrieval) * dt, state.landingDistance, lineLimit);
    const travel = state.distance - before, feedback = state.feedback;
    feedback.reelSpeed = Math.max(0, -travel) / dt; feedback.payoutSpeed = Math.max(0, travel) / dt;
    feedback.reelTurns += Math.max(0, -travel) / LINE_METRES_PER_TURN;
    feedback.payoutTurns += Math.max(0, travel) / LINE_METRES_PER_TURN;
    feedback.load = state.tension; feedback.fishPull = clamp(force, 0, 2.5);
    feedback.surge = behavior.telegraph ? .15 + .35 * Math.sin(behavior.warningProgress * Math.PI / 2) ** 2
      : hasMove ? .65 + .35 * Math.sin(behavior.progress * Math.PI) : 0;
    feedback.struggle = clamp(force * .55 * (1 - state.fatigue * .5), 0, 1);
    state.payout = feedback.payoutSpeed > 0;
    if (state.payout && !lastPayout) emit('dragPayout', force);
    lastPayout = state.payout;
    if (state.lineDamage >= 1) { escape('line-broke'); return; }
    if (state.slackTime > (setup.novice ? 2.5 : 1.8)) { escape('hook-slipped'); return; }
    const nearWater = state.distance <= state.landingDistance + .2;
    const lastRunFinished = !profile.moves.includes('last-run') || finalPikeTime >= 0 && state.phaseTime - finalPikeTime >= FINAL_RUN_SECONDS;
    state.bankApproach = nearWater;
    // A recent counter creates a short opportunity to settle the fish into the
    // net. Strong tackle can cash in its earlier arrival with deliberate low-tip
    // control, instead of sitting at the distance floor waiting on hidden fatigue.
    const quietRecovery = behavior.move === 'recover' || behavior.move === 'steady';
    const settleOpportunity = nearWater && state.landingAvailable && lastRunFinished
      && state.counterCount > 0 && state.fatigue >= .45
      && (opening || state.bankControl > 0 && quietRecovery);
    const settling = settleOpportunity && input.reeling && state.rodAngle < -.2
      && state.tension >= .23 && state.tension <= .8 && state.drag >= .2 && state.drag <= .7;
    if (settling) state.bankControl = Math.min(1, state.bankControl + dt / BANK_CONTROL_SECONDS);
    else if (!state.landingAvailable || state.distance > state.landingDistance + 1) state.bankControl = 0;
    else if (state.tension > .86 || state.tension < .16) state.bankControl = Math.max(0, state.bankControl - dt);
    const readyFatigue = state.fatigue >= .88 || state.bankControl >= 1;
    const atNet = nearWater && readyFatigue && state.tension < .86 && state.landingAvailable && lastRunFinished;
    state.bankReady = atNet;
    if (nearWater && !state.landingAvailable) state.cue = 'bring-to-water';
    else if (settleOpportunity && state.bankControl < 1 && !state.cue) state.cue = 'settle-fish';
    if (atNet && state.rodAngle > .25) state.cue = 'lower-rod';
    // Low rod position helps the net approach, but normal/raised input can never deadlock a tired fish.
    const netSeconds = state.rodAngle < -.2 ? 1.2 : state.rodAngle > .25 ? 2.8 : 2.2;
    state.landingProgress = atNet && canReel ? Math.min(1, state.landingProgress + dt / netSeconds) : Math.max(0, state.landingProgress - dt * .5);
    if (state.landingProgress >= 1) {
      if (state.reeling) emit('reelStop');
      state.catch = pendingCatch; state.weight = pendingCatch!.weightKg; state.length = pendingCatch!.lengthCm;
      state.catches++; state.distance = 0; state.tension = 0; state.payout = false; state.reeling = false; state.cue = '';
      state.openingRemaining = 0; state.bankApproach = false; state.bankReady = false; counterAttempt = null;
      emit('landed'); enter('caught');
    }
  }
  function tick(seconds: number, reeling: boolean | FishingControls, controls: Omit<FishingControls, 'reeling'> = {}) {
    const input = typeof reeling === 'boolean' ? { ...controls, reeling } : reeling;
    state.landingDistance = clamp(finite(input.landingDistance, .7), 0, state.castDistance + 12 * state.setup.lineStrength);
    state.landingAvailable = input.landingAvailable !== false;
    if (!state.landingAvailable) { state.landingProgress = 0; state.bankControl = 0; state.bankReady = false; }
    // Fixed increments preserve telegraph and reaction windows across frame rates.
    const elapsed = clamp(finite(seconds, 0), 0, .25);
    // Pausing or stopping input must not leave a stale rate driving a consumer.
    // Turns stay fixed until a real simulation step moves the line again.
    if (!elapsed || !input.reeling) state.feedback.reelSpeed = 0;
    if (!elapsed || input.reeling) state.feedback.payoutSpeed = 0;
    accumulator += elapsed;
    const step = 1 / 120;
    while (accumulator + 1e-9 >= step) {
      accumulator -= step; state.phaseTime += step;
      const activelyReeling = state.phase === 'reeling' && !!input.reeling;
      if (activelyReeling !== state.reeling) emit(activelyReeling ? 'reelStart' : 'reelStop');
      state.reeling = activelyReeling;
      if (state.phase === 'waiting' && state.encounter) {
        const bite = biteFeedbackAt(state.encounter.speciesId, biteAfter - state.phaseTime);
        state.biteStage = bite.stage; state.nibble = bite.pulse * (bite.stage === 'approach' ? .08 : .4); state.feedback.bitePulse = bite.pulse;
      } else if (state.phase === 'bite') state.feedback.bitePulse = 1 - .28 * clamp(state.phaseTime / state.biteWindow, 0, 1);
      if (state.phase === 'casting') {
        if (!releasedCast && state.phaseTime >= .35) { releasedCast = true; emit('castRelease'); }
        if (state.phaseTime + 1e-8 >= CAST_DURATION) { emit('waterImpact'); enter('waiting'); }
      } else if (state.phase === 'waiting') {
        if (!state.encounter && state.phaseTime > 7) state.cue = 'wrong-bait';
        if (state.phaseTime >= biteAfter) {
          if (!state.encounter) escape('no-interest');
          else { state.cue = 'strike'; emit('biteCommitted'); enter('bite'); }
        }
      } else if (state.phase === 'bite' && state.phaseTime >= state.biteWindow) escape('missed-bite');
      else if (state.phase === 'reeling') fight(step, input);
      else if (state.phase === 'escaped' && state.phaseTime > 2.8) { state.tension = 0; state.distance = 0; state.cue = ''; enter('ready'); }
    }
  }
  return { state, cast, hook, release, keep, retrieve, applyPlayerMovement, tick, configure, drainEvents: () => events.splice(0) };
}
