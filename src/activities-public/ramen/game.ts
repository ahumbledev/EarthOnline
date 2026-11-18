export interface NoodleGameplayConfig { roundSeconds: number; targetFolds: number; stretchSpeed: number; tearThreshold: number }

export type RamenStage = 'ready' | 'kneading' | 'pulling' | 'won' | 'failed';
export type RamenNotice = 'ready' | 'knead' | 'pull' | 'too-short' | 'too-long' | 'relax' | 'folded' | 'served' | 'torn' | 'timeout';
export interface RamenState {
  readonly config: Readonly<NoodleGameplayConfig>;
  readonly stage: RamenStage;
  readonly remaining: number;
  readonly kneaded: number;
  readonly length: number;
  readonly tension: number;
  readonly folds: number;
  readonly quality: number;
  readonly notice: RamenNotice;
}
export const FOLD_MIN = .6;
export const FOLD_MAX = .85;
export const KNEAD_SECONDS = 3;
export const DEFAULT_RAMEN_CONFIG: Readonly<NoodleGameplayConfig> = {
  roundSeconds: 90, targetFolds: 4, stretchSpeed: .32, tearThreshold: 1,
};

function bounded(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** Initialize a practice round with bounded timings and tension. */
export function createRamenState(input: NoodleGameplayConfig = DEFAULT_RAMEN_CONFIG): RamenState {
  const config = Object.freeze({
    roundSeconds: bounded(input.roundSeconds, 30, 300, DEFAULT_RAMEN_CONFIG.roundSeconds),
    targetFolds: Math.round(bounded(input.targetFolds, 1, 8, DEFAULT_RAMEN_CONFIG.targetFolds)),
    stretchSpeed: bounded(input.stretchSpeed, .1, .8, DEFAULT_RAMEN_CONFIG.stretchSpeed),
    tearThreshold: bounded(input.tearThreshold, .5, 2, DEFAULT_RAMEN_CONFIG.tearThreshold),
  });
  return { config, stage: 'ready', remaining: config.roundSeconds, kneaded: 0, length: 0, tension: 0, folds: 0, quality: 100, notice: 'ready' };
}

export function startRamen(state: RamenState): RamenState {
  return state.stage === 'ready' ? { ...state, stage: 'kneading', notice: 'knead' } : state;
}

/** Reject suspended/invalid frames; tiny substeps bound changes at stage transitions. */
export function advanceRamen(state: RamenState, input: { deltaSeconds: number; knead: boolean; pull: boolean }): RamenState {
  if ((state.stage !== 'kneading' && state.stage !== 'pulling') || !Number.isFinite(input.deltaSeconds) || input.deltaSeconds <= 0 || input.deltaSeconds > .25) return state;
  let next = state;
  const steps = Math.ceil(input.deltaSeconds / .01), dt = input.deltaSeconds / steps;
  for (let i = 0; i < steps && (next.stage === 'kneading' || next.stage === 'pulling'); i++) {
    const remaining = Math.max(0, next.remaining - dt);
    if (remaining < 1e-8) { next = { ...next, remaining: 0, stage: 'failed', notice: 'timeout' }; break; }
    if (next.stage === 'kneading') {
      const kneaded = Math.min(1, next.kneaded + (input.knead ? dt / KNEAD_SECONDS : 0));
      next = { ...next, remaining, kneaded, stage: kneaded >= 1 - 1e-8 ? 'pulling' : 'kneading', notice: kneaded >= 1 - 1e-8 ? 'pull' : 'knead' };
      continue;
    }
    const length = Math.max(0, next.length + (input.pull ? next.config.stretchSpeed : -.025) * dt);
    // Stretching heats the gluten. Relaxing releases tension without losing the fold window immediately.
    const stress = input.pull ? next.config.stretchSpeed * (.65 + length * 1.7) : -.7;
    const tension = Math.max(0, next.tension + stress * dt);
    const torn = tension >= next.config.tearThreshold || length > 1.08;
    next = { ...next, remaining, length: Math.min(1.1, length), tension: Math.min(next.config.tearThreshold, tension),
      stage: torn ? 'failed' : 'pulling', notice: torn ? 'torn' : next.notice };
  }
  return next;
}

export function foldRamen(state: RamenState): RamenState {
  if (state.stage !== 'pulling') return state;
  if (state.length < FOLD_MIN) return { ...state, notice: 'too-short' };
  if (state.length > FOLD_MAX) return { ...state, notice: 'too-long' };
  if (state.tension > state.config.tearThreshold * .72) return { ...state, notice: 'relax' };
  const folds = state.folds + 1;
  const penalty = Math.abs(state.length - .725) * 16 + state.tension / state.config.tearThreshold * 4;
  const won = folds >= state.config.targetFolds;
  return { ...state, folds, length: 0, tension: state.tension * .12, quality: Math.max(0, state.quality - penalty),
    stage: won ? 'won' : 'pulling', notice: won ? 'served' : 'folded' };
}
