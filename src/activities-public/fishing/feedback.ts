/** Motion feedback shared by the rod, line and float. */
export interface FishingFeedback {
  /** Normalized contact load (0..1), from the same tension used for gameplay. */
  load: number;
  /** Effective fish pull in game units (0..2.5), before player steering. */
  fishPull: number;
  /** Bounded warning/attack pulse (0..1); consumers must not invent a new clock. */
  surge: number;
  /** Light approach/taste/take feedback (0..1). */
  bitePulse: number;
  /** Actual inward/outward line travel, metres per simulated second. */
  reelSpeed: number;
  payoutSpeed: number;
  /** Accumulated turns in this phase, derived from actual line travel; reset on phase transitions. */
  reelTurns: number;
  payoutTurns: number;
  /** Fish animation energy (0..1), shared with the current fight behavior. */
  struggle: number;
}

export type BiteStage = 'quiet' | 'approach' | 'taste' | 'take';
export const LINE_METRES_PER_TURN = .72;
export function emptyFishingFeedback(): FishingFeedback {
  return { load: 0, fishPull: 0, surge: 0, bitePulse: 0, reelSpeed: 0, payoutSpeed: 0,
    reelTurns: 0, payoutTurns: 0, struggle: 0 };
}
