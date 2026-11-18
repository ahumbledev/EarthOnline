import type { FishMove } from './fish-behavior.ts';

export interface FightResponseState {
  behavior: FishMove | 'steady' | 'recover';
  telegraph: boolean;
  pullDirection: number;
  rodDirection: number;
  rodAngle: number;
  tension: number;
  drag: number;
}
export type FightResponseReason = 'inactive' | 'warning' | 'tension-low' | 'tension-high'
  | 'drag-too-loose' | 'drag-too-tight' | 'release-reel' | 'hold-reel'
  | 'steer-left' | 'steer-right' | 'lower-tip' | 'raise-tip' | 'controlled';
export interface FightResponseResult {
  eligible: boolean;
  correct: boolean;
  sideTarget: -1 | 0 | 1;
  angleTarget: -1 | 0 | 1;
  reelTarget: 'hold' | 'release' | null;
  reason: FightResponseReason;
}
const attacks: readonly FishMove[] = ['small-dart', 'perch-pause', 'grass-run', 'deep-run', 'dive', 'jump', 'switchback', 'last-run'];

/** The HUD and the fixed-step fight use one definition of a valid response.
 * Warning targets predict the next action, but never count as a counter. */
export function evaluateFightResponse(state: FightResponseState, reeling: boolean): FightResponseResult {
  const { behavior: move } = state;
  const attack = attacks.includes(move as FishMove);
  const pullSide = Number.isFinite(state.pullDirection) ? Math.sign(state.pullDirection) : 0;
  const sideTarget = !attack || move === 'jump' ? 0 : -pullSide as -1 | 0 | 1;
  const angleTarget = move === 'jump' ? -1 : move === 'dive' ? 1 : 0;
  const reelTarget = !attack ? null : move === 'perch-pause' ? 'hold' : 'release';
  const result: FightResponseResult = { eligible: false, correct: false, sideTarget, angleTarget, reelTarget, reason: 'inactive' };
  if (!attack || ![state.pullDirection, state.rodDirection, state.rodAngle, state.tension, state.drag].every(Number.isFinite)
    || move !== 'jump' && sideTarget === 0) return result;
  if (state.telegraph) return { ...result, reason: 'warning' };
  result.eligible = true;
  if (state.tension < .18) result.reason = 'tension-low';
  else if (state.tension > .86) result.reason = 'tension-high';
  else if (state.drag < .2) result.reason = 'drag-too-loose';
  else if (state.drag > (move === 'jump' || move === 'dive' || move === 'perch-pause' ? .75 : .65)) result.reason = 'drag-too-tight';
  else if (reelTarget === 'release' && reeling) result.reason = 'release-reel';
  else if (reelTarget === 'hold' && !reeling) result.reason = 'hold-reel';
  else if (angleTarget === -1 && state.rodAngle >= -.35) result.reason = 'lower-tip';
  else if (angleTarget === 1 && state.rodAngle <= .35) result.reason = 'raise-tip';
  else if (sideTarget !== 0 && state.rodDirection * sideTarget <= .5) result.reason = sideTarget < 0 ? 'steer-left' : 'steer-right';
  else { result.correct = true; result.reason = 'controlled'; }
  return result;
}
