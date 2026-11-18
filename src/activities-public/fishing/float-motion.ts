import type { FishingPhase } from './gameplay.ts';
import type { BiteStage, FishingFeedback } from './feedback.ts';

const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Displacement relative to the authored waterline, in metres. */
export function floatMotion(phase: FishingPhase, phaseTime: number, time: number, nibble = 0, exposedHeight = .24,
  feedback?: Readonly<FishingFeedback>, options: { biteStage?: BiteStage; reducedMotion?: boolean } = {}) {
  if (feedback) {
    const bounded = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    const stage = options.biteStage ?? (phase === 'bite' ? 'take' : nibble > 0 ? 'taste' : 'quiet');
    const active = phase === 'waiting' || phase === 'bite';
    const pulse = active ? bounded(feedback.bitePulse) : 0;
    const load = bounded(feedback.load), surge = bounded(feedback.surge);
    const depth = stage === 'take' ? 1.08 : stage === 'taste' ? .18 : stage === 'approach' ? .06 : 0;
    const height = Number.isFinite(exposedHeight) ? Math.max(0, exposedHeight) : .24;
    const dip = height * depth * pulse;
    // The shared bite pulse is the sole bite clock. Reduced motion preserves
    // its depth cue, while removing ambient bobbing and secondary side tilt.
    const wave = options.reducedMotion ? 0 : Math.sin((Number.isFinite(time) ? time : 0) * 1.6) * .004;
    const tilt = options.reducedMotion ? 0 : active ? pulse * (stage === 'take' ? .11 : .035)
      : phase === 'reeling' ? load * (.14 + surge * .035) : 0;
    return { y: wave - dip, tilt, dip, biteStage: stage, bitePulse: pulse, load, feedbackDriven: true };
  }
  const wave = Math.sin(time * 1.6) * .004;
  let dip = 0, tilt = Math.sin(time * 1.4) * .018;
  if (phase === 'waiting' && nibble > 0) {
    const taps = Math.max(0, Math.sin(nibble * Math.PI * 4));
    dip = taps * .026 * ease(nibble * 3);
    tilt += taps * .055;
  }
  if (phase === 'bite') {
    const t = Math.max(0, phaseTime);
    if (t < .2) dip = .07 * ease(t / .2);
    else if (t < .5) dip = .07 - .04 * ease((t - .2) / .3);
    else if (t < .9) dip = .03 + .225 * ease((t - .5) / .4);
    else if (t < 1.5) dip = .255;
    else if (t < 2.15) dip = .255 - .16 * ease((t - 1.5) / .65);
    else dip = .095 + .16 * ease((t - 2.15) / .55);
    tilt = .075 + Math.sin(t * 4) * .035;
  }
  if (phase === 'reeling') tilt = .18 + Math.sin(time * 2.1) * .045;
  dip *= exposedHeight / .24;
  return { y: wave - dip, tilt, dip, biteStage: options.biteStage ?? (phase === 'bite' ? 'take' : 'quiet'),
    bitePulse: 0, load: 0, feedbackDriven: false };
}
