/** Rendering policy is independent of Three objects and safe to test headlessly. */
export type QualityLevel = 'low' | 'balanced' | 'high';
export type QualityPreference = 'auto' | QualityLevel;
export interface RenderQuality {
  level: QualityLevel;
  pixelRatio: number;
  shadowMapSize: number;
  shadowHz: number;
  aoScale: number;
  aoSamples: number;
  bloom: boolean;
  pointLights: number;
  textureQuality: 'smooth' | 'standard' | 'high';
  /** Shadow refresh while a caster (the player, a car) is moving. */
  shadowMovingHz: number;
  /** Multisamples of the scene pass; edges fall back to FXAA at 0. */
  sceneSamples: number;
  /** Metres beyond which small street props are not drawn. A CPU-side lever: resolution does not help a draw-call-bound frame. */
  detailDistance: number;
  /** Street lamps and signs drawn as light volumes. */
  volumeLights: number;
  /** Screen-space steps of the wet-street reflection; 0 turns it off. */
  reflectionSteps: number;
}
export const QUALITY_STORAGE_KEY = 'city:graphics:v1';
export function normalizeQuality(value: unknown): QualityPreference {
  return value === 'low' || value === 'balanced' || value === 'high' ? value : 'auto';
}
export function renderQuality(level: QualityLevel, width: number, height: number, deviceRatio: number, scale = 1): RenderQuality {
  const preset = {
    low: { ratio: 1, pixels: 1_050_000, shadowMapSize: 1024, shadowHz: 15, aoScale: 0, aoSamples: 6, bloom: false, pointLights: 4, textureQuality: 'smooth' as const,
      shadowMovingHz: 20, sceneSamples: 2, detailDistance: 70, volumeLights: 32, reflectionSteps: 0 },
    balanced: { ratio: 1.25, pixels: 2_100_000, shadowMapSize: 1536, shadowHz: 24, aoScale: .5, aoSamples: 8, bloom: true, pointLights: 6, textureQuality: 'standard' as const,
      shadowMovingHz: 30, sceneSamples: 4, detailDistance: 120, volumeLights: 64, reflectionSteps: 16 },
    high: { ratio: 2, pixels: 4_200_000, shadowMapSize: 2048, shadowHz: 60, aoScale: .75, aoSamples: 12, bloom: true, pointLights: 8, textureQuality: 'high' as const,
      shadowMovingHz: 60, sceneSamples: 4, detailDistance: 240, volumeLights: 96, reflectionSteps: 24 },
  }[level];
  const area = Math.max(1, width) * Math.max(1, height);
  const ratio = Math.min(Math.max(.5, Number.isFinite(deviceRatio) ? deviceRatio : 1), preset.ratio, Math.sqrt(preset.pixels / area));
  return { level, pixelRatio: Math.max(.25, ratio * Math.min(1, Math.max(.65, scale))),
    shadowMapSize: preset.shadowMapSize, shadowHz: preset.shadowHz, aoScale: preset.aoScale,
    aoSamples: preset.aoSamples, bloom: preset.bloom, pointLights: preset.pointLights, textureQuality: preset.textureQuality,
    shadowMovingHz: preset.shadowMovingHz, sceneSamples: preset.sceneSamples, detailDistance: preset.detailDistance,
    volumeLights: preset.volumeLights, reflectionSteps: preset.reflectionSteps };
}
export interface FrameSummary { fps: number; p95: number; cpuMs: number; samples: number }
export function summarizeFrames(intervals: readonly number[], cpu: readonly number[]): FrameSummary {
  if (!intervals.length) return { fps: 0, p95: 0, cpuMs: 0, samples: 0 };
  const sorted = [...intervals].sort((a,b)=>a-b);
  return {
    fps: 1000 / (intervals.reduce((a,b)=>a+b,0) / intervals.length),
    p95: sorted[Math.floor((sorted.length - 1) * .95)],
    cpuMs: cpu.reduce((a,b)=>a+b,0) / Math.max(1,cpu.length),
    samples: intervals.length,
  };
}

// On a vsync-locked display frame times are quantized to 16.7 or 33.3 ms, so
// the slow/fast thresholds alone pump between two scales forever. Each scale that
// failed is retried only after its own backoff, which doubles while retries fail.
const RETRY_BACKOFF_MS = 45_000, MAX_RETRY_BACKOFF_MS = 900_000;
// Slowness within this many windows of an upgrade is blamed on that upgrade.
const UPGRADE_SETTLE_WINDOWS = 4;
// Share of the frame interval spent in the frame callback above which the frame is CPU-bound,
// and how many consecutive windows (1.5 s each) must agree before effects are dropped for it.
// A short spike from another program must not cost the scene its effects.
const CPU_BOUND_SHARE = .6, CPU_BOUND_WINDOWS = 4;

/** Sustained overload lowers quality; isolated uploads and tab resumes do not.
 * Automatic mode starts balanced, with a long recovery window and a memory of
 * failed scales to avoid pumping.
 * Frame samples are real foreground game frames, never loading/menu/hidden time.
 */
export function createQualityGovernor(preference: QualityPreference = 'auto') {
  let selected = normalizeQuality(preference), level: QualityLevel = selected === 'auto' ? 'balanced' : selected;
  let scale = 1, warmupMs = 0, windowMs = 0, intervals: number[] = [], cpu: number[] = [];
  let slowWindows = 0, fastWindows = 0, cpuBoundWindows = 0, sampledMs = 0;
  let upgradedFrom: number | null = null, windowsSinceUpgrade = 0;
  // Failed scales by hundredths of scale, so a lower scale's hitch keeps a higher one's history.
  const failures = new Map<number, { retryAtMs: number; strikes: number }>();
  const scaleKey = (value: number) => Math.round(value * 100);
  let summary: FrameSummary = summarizeFrames([], []);
  function resetWindow() { intervals = []; cpu = []; slowWindows = 0; fastWindows = 0; cpuBoundWindows = 0; warmupMs = 0; windowMs = 0; upgradedFrom = null; }
  function forgetFailures() { failures.clear(); upgradedFrom = null; }
  function fail(at: number, retried: boolean) {
    // A spike after holding a scale is load, not pumping: it is noted without delay.
    // Only an upgrade that fails straight away waits, and each repeat doubles the wait.
    const previous = failures.get(scaleKey(at));
    if (!retried) { if (!previous) failures.set(scaleKey(at), { strikes: -1, retryAtMs: sampledMs }); return; }
    const strikes = (previous?.strikes ?? -1) + 1;
    failures.set(scaleKey(at), { strikes, retryAtMs: sampledMs + Math.min(MAX_RETRY_BACKOFF_MS, RETRY_BACKOFF_MS * 2 ** strikes) });
  }
  return {
    get preference() { return selected; },
    get level() { return level; },
    get scale() { return scale; },
    get summary() { return summary; },
    setPreference(value: QualityPreference) {
      selected = normalizeQuality(value); level = selected === 'auto' ? 'balanced' : selected;
      scale = 1; resetWindow(); forgetFailures();
    },
    /** A new scene or a materially different canvas size changes the workload, so failed scales no longer apply. */
    resetSampling(options: { newWorkload?: boolean } = {}) { resetWindow(); if (options.newWorkload) forgetFailures(); },
    sample(intervalMs: number, cpuMs: number): boolean {
      if (!Number.isFinite(intervalMs) || intervalMs < 1 || intervalMs > 250 || !Number.isFinite(cpuMs)) return false;
      sampledMs += intervalMs;
      if (warmupMs < 2000) { warmupMs += intervalMs; return false; }
      intervals.push(intervalMs); cpu.push(Math.max(0,cpuMs));
      windowMs += intervalMs;
      if (windowMs < 1500 || intervals.length < 20) return false;
      summary = summarizeFrames(intervals,cpu);
      // P75 is less sensitive than P95 to occasional texture uploads/GC.
      const p75 = [...intervals].sort((a,b)=>a-b)[Math.floor(intervals.length * .75)];
      intervals = []; cpu = []; windowMs = 0;
      if (selected !== 'auto') return false;
      slowWindows = p75 > 22 ? slowWindows + 1 : 0;
      cpuBoundWindows = p75 > 22 && summary.cpuMs >= CPU_BOUND_SHARE * p75 ? cpuBoundWindows + 1 : 0;
      fastWindows = p75 < 17.5 && summary.cpuMs < 10 ? fastWindows + 1 : 0;
      if (upgradedFrom !== null && ++windowsSinceUpgrade > UPGRADE_SETTLE_WINDOWS) upgradedFrom = null;
      if (p75 > 40 && level !== 'low') {
        // Scales are not comparable across effect levels, so the new level starts clean.
        level = 'low'; scale = .85; slowWindows = 0; fastWindows = 0; forgetFailures(); return true;
      }
      if (slowWindows >= 2) {
        // When most of a slow frame is spent in script (submitting draw calls),
        // fewer pixels change nothing, so resolution is left alone. Only the
        // low tier draws less: once the pattern has held, go there at full
        // resolution instead of blurring the picture first.
        if (upgradedFrom === null && level !== 'low' && cpuBoundWindows >= 2) {
          if (cpuBoundWindows < CPU_BOUND_WINDOWS) return false;
          level = 'low'; scale = 1; slowWindows = 0; fastWindows = 0; cpuBoundWindows = 0; forgetFailures(); return true;
        }
        slowWindows = 0; fastWindows = 0;
        const lastGood = upgradedFrom;
        upgradedFrom = null;
        if (scale > .72) {
          fail(scale, lastGood !== null);
          scale = lastGood ?? Math.max(.7, Math.round((scale - .1) * 100) / 100); return true;
        }
        if (level !== 'low') { level = 'low'; scale = .85; forgetFailures(); return true; }
      }
      // At least 12 seconds at 60Hz between upgrades; recover resolution first.
      if (fastWindows >= 8) {
        fastWindows = 0;
        // Holding fast at a scale shows it and every lower scale are fine again.
        for (const failed of failures.keys()) if (failed <= scaleKey(scale)) failures.delete(failed);
        if (scale < 1) {
          const next = Math.min(1, Math.round((scale + .05) * 100) / 100);
          const failed = failures.get(scaleKey(next));
          if (failed && sampledMs < failed.retryAtMs) return false;
          upgradedFrom = scale; windowsSinceUpgrade = 0;
          scale = next; return true;
        }
        // Stay at the recovered low effect tier for this scene. A 60Hz vsync
        // ceiling cannot prove enough GPU headroom to restore heavier effects.
      }
      return false;
    },
  };
}
