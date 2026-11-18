import type { FishId } from './fish-catalog.ts';
import type { BiteStage } from './feedback.ts';

export type FishMove = 'small-dart' | 'perch-pause' | 'grass-run' | 'deep-run' | 'dive' | 'jump' | 'switchback' | 'last-run';
/** Short instructions stay tied to the actual motion and the current pull side. */
export function fishMoveCue(move: FishMove | 'steady' | 'recover', telegraph: boolean, recommendedDirection: number): string {
  const side = recommendedDirection < 0 ? 'left' : 'right';
  switch (move) {
    case 'small-dart': return `${telegraph ? 'Dart coming' : 'Quick dart'} · ease & steer ${side}`;
    case 'perch-pause': return 'A pause · reel gently, keep contact';
    case 'grass-run': return `Reeds ahead · ease & steer ${side}`;
    case 'deep-run': return `Deep run · ease & steer ${side}`;
    case 'dive': return `${telegraph ? 'Dive coming' : 'Deep dive'} · ease & lift the tip`;
    case 'jump': return `${telegraph ? 'Jump coming' : 'Airborne'} · ease & lower the tip`;
    case 'switchback': return `Changing sides · ease & steer ${side}`;
    case 'last-run': return `Last rush · ease & steer ${side}`;
    case 'recover': return 'Reel now';
    default: return '';
  }
}
export interface FishBehaviorProfile {
  moves: readonly FishMove[];
  warning: number;
  attack: number;
  recovery: number;
  biteWindow: number;
  nibblePattern: 'taps' | 'sideways' | 'slow-drag' | 'strike';
  /** Species load, separate from specimen length and the player's equipment. */
  pressure: number;
  fatigueRate: number;
}
/** Game tuning: small fish teach one beat, predators combine readable attacks. */
export const FISH_BEHAVIORS: Readonly<Record<FishId, FishBehaviorProfile>> = {
  bluegill: { moves: ['small-dart'], warning: 1.4, attack: 1.2, recovery: 4.1, biteWindow: 2.5, nibblePattern: 'taps', pressure: .65, fatigueRate: .045 },
  'yellow-perch': { moves: ['small-dart', 'perch-pause'], warning: 1.3, attack: 1.6, recovery: 3.8, biteWindow: 2.2, nibblePattern: 'sideways', pressure: .78, fatigueRate: .04 },
  'largemouth-bass': { moves: ['grass-run', 'jump'], warning: 1.15, attack: 2.15, recovery: 3.15, biteWindow: 1.9, nibblePattern: 'strike', pressure: 1.05, fatigueRate: .03 },
  'common-carp': { moves: ['deep-run', 'dive'], warning: 1.2, attack: 2.9, recovery: 3.5, biteWindow: 2.4, nibblePattern: 'slow-drag', pressure: 1.2, fatigueRate: .027 },
  'rainbow-trout': { moves: ['switchback', 'jump'], warning: 1.05, attack: 2.6, recovery: 2.8, biteWindow: 1.7, nibblePattern: 'sideways', pressure: 1.1, fatigueRate: .029 },
  'northern-pike': { moves: ['grass-run', 'last-run', 'deep-run'], warning: 1.0, attack: 2.45, recovery: 2.5, biteWindow: 1.8, nibblePattern: 'strike', pressure: 1.35, fatigueRate: .024 },
  'pumpkinseed': { moves: ['small-dart', 'perch-pause'], warning: 1.4, attack: 1.25, recovery: 4.0, biteWindow: 2.5, nibblePattern: 'taps', pressure: 0.68, fatigueRate: 0.044 },
  'redear-sunfish': { moves: ['perch-pause', 'dive'], warning: 1.35, attack: 1.4, recovery: 3.9, biteWindow: 2.3, nibblePattern: 'slow-drag', pressure: 0.77, fatigueRate: 0.041 },
  'green-sunfish': { moves: ['small-dart', 'grass-run'], warning: 1.3, attack: 1.4, recovery: 3.8, biteWindow: 2.3, nibblePattern: 'taps', pressure: 0.75, fatigueRate: 0.042 },
  'black-crappie': { moves: ['perch-pause', 'switchback'], warning: 1.25, attack: 1.7, recovery: 3.6, biteWindow: 2.2, nibblePattern: 'sideways', pressure: 0.84, fatigueRate: 0.038 },
  'white-crappie': { moves: ['perch-pause', 'small-dart', 'dive'], warning: 1.3, attack: 1.65, recovery: 3.8, biteWindow: 2.25, nibblePattern: 'taps', pressure: 0.82, fatigueRate: 0.039 },
  'rock-bass': { moves: ['small-dart', 'dive'], warning: 1.3, attack: 1.6, recovery: 3.6, biteWindow: 2.25, nibblePattern: 'strike', pressure: 0.83, fatigueRate: 0.039 },
  'smallmouth-bass': { moves: ['jump', 'switchback', 'grass-run'], warning: 1.1, attack: 2.3, recovery: 3.0, biteWindow: 1.85, nibblePattern: 'strike', pressure: 1.12, fatigueRate: 0.03 },
  'spotted-bass': { moves: ['switchback', 'dive', 'grass-run'], warning: 1.15, attack: 2.15, recovery: 3.1, biteWindow: 1.9, nibblePattern: 'strike', pressure: 1.06, fatigueRate: 0.031 },
  'white-bass': { moves: ['small-dart', 'switchback', 'deep-run'], warning: 1.2, attack: 2.0, recovery: 3.2, biteWindow: 2.0, nibblePattern: 'sideways', pressure: 0.97, fatigueRate: 0.033 },
  'striped-bass': { moves: ['deep-run', 'switchback', 'last-run'], warning: 1.05, attack: 2.8, recovery: 2.65, biteWindow: 1.8, nibblePattern: 'strike', pressure: 1.43, fatigueRate: 0.024 },
  'walleye': { moves: ['perch-pause', 'deep-run', 'dive'], warning: 1.2, attack: 2.45, recovery: 3.25, biteWindow: 2.1, nibblePattern: 'slow-drag', pressure: 1.13, fatigueRate: 0.029 },
  'zander': { moves: ['dive', 'switchback', 'deep-run'], warning: 1.15, attack: 2.6, recovery: 2.95, biteWindow: 1.95, nibblePattern: 'sideways', pressure: 1.23, fatigueRate: 0.027 },
  'brown-trout': { moves: ['switchback', 'dive', 'jump'], warning: 1.05, attack: 2.55, recovery: 2.9, biteWindow: 1.75, nibblePattern: 'sideways', pressure: 1.17, fatigueRate: 0.028 },
  'brook-trout': { moves: ['small-dart', 'jump', 'switchback'], warning: 1.2, attack: 2.0, recovery: 3.15, biteWindow: 2.0, nibblePattern: 'taps', pressure: 0.95, fatigueRate: 0.034 },
  'lake-trout': { moves: ['deep-run', 'dive', 'perch-pause'], warning: 1.15, attack: 2.85, recovery: 3.0, biteWindow: 2.0, nibblePattern: 'slow-drag', pressure: 1.37, fatigueRate: 0.025 },
  'atlantic-salmon': { moves: ['jump', 'deep-run', 'switchback'], warning: 1.0, attack: 2.7, recovery: 2.6, biteWindow: 1.7, nibblePattern: 'strike', pressure: 1.4, fatigueRate: 0.025 },
  'chain-pickerel': { moves: ['grass-run', 'switchback', 'last-run'], warning: 1.1, attack: 2.15, recovery: 3.0, biteWindow: 1.9, nibblePattern: 'strike', pressure: 1.1, fatigueRate: 0.03 },
  'muskellunge': { moves: ['last-run', 'deep-run', 'switchback', 'grass-run'], warning: 1.0, attack: 2.8, recovery: 2.5, biteWindow: 1.7, nibblePattern: 'strike', pressure: 1.52, fatigueRate: 0.023 },
  'grass-carp': { moves: ['grass-run', 'deep-run', 'dive'], warning: 1.15, attack: 3.0, recovery: 3.2, biteWindow: 2.25, nibblePattern: 'slow-drag', pressure: 1.42, fatigueRate: 0.025 },
  'silver-carp': { moves: ['deep-run', 'jump', 'dive'], warning: 1.15, attack: 2.9, recovery: 3.15, biteWindow: 2.2, nibblePattern: 'slow-drag', pressure: 1.32, fatigueRate: 0.026 },
  'crucian-carp': { moves: ['perch-pause', 'small-dart', 'deep-run'], warning: 1.35, attack: 1.85, recovery: 3.7, biteWindow: 2.1, nibblePattern: 'taps', pressure: 0.88, fatigueRate: 0.036 },
  'common-bream': { moves: ['perch-pause', 'dive', 'deep-run'], warning: 1.3, attack: 2.15, recovery: 3.6, biteWindow: 2.35, nibblePattern: 'slow-drag', pressure: 1.0, fatigueRate: 0.032 },
  'roach': { moves: ['small-dart', 'perch-pause', 'switchback'], warning: 1.35, attack: 1.45, recovery: 3.9, biteWindow: 2.3, nibblePattern: 'taps', pressure: 0.73, fatigueRate: 0.042 },
  'tench': { moves: ['dive', 'grass-run', 'perch-pause'], warning: 1.25, attack: 2.5, recovery: 3.45, biteWindow: 2.25, nibblePattern: 'slow-drag', pressure: 1.1, fatigueRate: 0.03 },
};
export interface FishBehavior {
  move: FishMove | 'steady' | 'recover';
  telegraph: boolean;
  force: number;
  direction: number;
  jumping: boolean;
  diving: boolean;
  progress: number;
  /** Progress through the current warning, including a switchback's second side. */
  warningProgress: number;
  cycle: number;
}
function draw(seed: number, cycle: number, channel: number) {
  let n = (Math.floor(seed * 0xffffffff) ^ Math.imul(cycle + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15; n = Math.imul(n, 0x846ca68b); n ^= n >>> 16;
  return (n >>> 0) / 0x100000000;
}
interface Beat { cycle: number; start: number; warning: number; attack: number; recovery: number; move: FishMove; direction: number; switchWarning: number }
// Only the current beat is cached. This bounds memory and avoids replaying a long
// schedule every physics step, while backwards queries remain deterministic.
const beats = new Map<string, Beat>();
function makeBeat(species: FishId, seed: number, novice: boolean, cycle: number, start: number): Beat {
  const p = FISH_BEHAVIORS[species], count = p.moves.length;
  // Every group includes the species' full move vocabulary, in a seeded order.
  const offset = Math.floor(draw(seed, Math.floor(cycle / count), 4) * count);
  const move = p.moves[(cycle % count + offset) % count];
  const warning = Math.max(novice ? 1.25 : .85, p.warning * (.86 + draw(seed, cycle, 0) * .28));
  const switchWarning = Math.max(.85, warning * .9);
  let attack = p.attack * (.78 + draw(seed, cycle, 1) * .44);
  if (move === 'switchback') attack += switchWarning;
  return { cycle, start, warning, attack, recovery: p.recovery * (.76 + draw(seed, cycle, 2) * .48), move,
    direction: draw(seed, cycle, 3) < .5 ? -1 : 1, switchWarning };
}
/** Seeded, variable-length beats consume no RNG during play or at landing. */
export function fishBehaviorAt(species: FishId, seconds: number, seed: number, fatigue = 0, novice = false): FishBehavior {
  const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0, opening = novice ? 3.8 : 3;
  if (time < opening) return { move: 'steady', telegraph: false, force: .52, direction: 0, jumping: false, diving: false, progress: time / opening, warningProgress: 0, cycle: -1 };
  const key = `${species}:${seed}:${novice}`;
  let beat = beats.get(key);
  if (!beat || time < beat.start) beat = makeBeat(species, seed, novice, 0, opening);
  while (time >= beat.start + beat.warning + beat.attack + beat.recovery) {
    beat = makeBeat(species, seed, novice, beat.cycle + 1, beat.start + beat.warning + beat.attack + beat.recovery);
  }
  beats.set(key, beat); if (beats.size > 32) beats.delete(beats.keys().next().value!);
  const local = time - beat.start, progress = Math.max(0, Math.min(1, (local - beat.warning) / beat.attack));
  const switchAt = beat.warning + (beat.attack - beat.switchWarning) / 2;
  const switching = beat.move === 'switchback' && local >= switchAt;
  const switchWarning = switching && local < switchAt + beat.switchWarning;
  const telegraph = local < beat.warning || switchWarning;
  const attacking = local >= beat.warning && local < beat.warning + beat.attack && !switchWarning;
  const direction = switching ? -beat.direction : beat.direction;
  const strength = ({ 'small-dart': 1.3, 'perch-pause': .35, 'grass-run': 1.85, 'deep-run': 1.95, dive: 1.7, jump: 1.65, switchback: 1.85, 'last-run': 2.05 } as const)[beat.move];
  return { move: telegraph || attacking ? beat.move : 'recover', telegraph,
    force: (telegraph ? .7 : attacking ? strength * (.94 + draw(seed, beat.cycle, 5) * .12) : .28) * (1 - Math.max(0, Math.min(1, fatigue)) * .32),
    direction: telegraph || attacking ? direction : direction * .2,
    jumping: beat.move === 'jump' && attacking, diving: (beat.move === 'dive' || beat.move === 'deep-run') && attacking,
    progress, warningProgress: telegraph ? Math.max(0, Math.min(1, switchWarning ? (local - switchAt) / beat.switchWarning : local / beat.warning)) : 0,
    cycle: beat.cycle };
}
/** A short, readable inspection before the existing committed bite. No RNG,
 * extra waiting time or failure decision is introduced by these light touches. */
export function biteFeedbackAt(species: FishId, secondsToBite: number): { stage: BiteStage; pulse: number } {
  if (!Number.isFinite(secondsToBite) || secondsToBite <= 0 || secondsToBite >= 2.2) return { stage: 'quiet', pulse: 0 };
  if (secondsToBite > 1.65) return { stage: 'approach', pulse: Math.sin((2.2 - secondsToBite) / .55 * Math.PI) };
  if (secondsToBite > 1.1) {
    const progress = (1.65 - secondsToBite) / .55;
    return { stage: 'taste', pulse: nibbleAt(species, progress) * Math.sin(progress * Math.PI) };
  }
  if (secondsToBite > .7) return { stage: 'quiet', pulse: 0 };
  const progress = 1 - secondsToBite / .7;
  return { stage: 'taste', pulse: nibbleAt(species, progress) * Math.sin(progress * Math.PI) };
}
export function nibbleAt(species: FishId, progress: number): number {
  if (progress <= 0 || progress >= 1) return 0;
  const pattern = FISH_BEHAVIORS[species].nibblePattern;
  if (pattern === 'slow-drag') return .15 + progress * .7;
  if (pattern === 'strike') return .15 + Math.max(0, Math.sin(progress * Math.PI * 3)) * .65;
  if (pattern === 'sideways') return .25 + Math.sin(progress * Math.PI * 5) ** 2 * .6;
  return .12 + Math.max(0, Math.sin(progress * Math.PI * 6)) * .8;
}
