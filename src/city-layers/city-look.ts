import * as THREE from 'three';

/**
 * The street's colour script. One table decides how the city looks at each
 * phase of the day: where the key light comes from and what colour it is, what
 * colour the shade is, how the sky grades from horizon to zenith, how thick and
 * what colour the air is, and how the final picture is graded.
 *
 * Four phases are authored and neighbouring phases blend by sun height, so the
 * picture moves continuously: day, golden hour (sun near the horizon), blue
 * hour (sun just below it, sky still luminous, lamps on) and night.
 *
 * Blues are authored slightly toward cyan: the filmic tone curve pulls a
 * saturated blue toward violet, and a street lit violet reads as a tint, not as
 * night.
 *
 * The art direction: saturated and high in contrast. Warm key against cool
 * shade by day; orange light against blue ambience at dusk; at night a dark,
 * cool base lit by a low blue moon key and by the city's own coloured light.
 */
export interface CityPhase {
  /** Sky colour straight up, at the horizon toward the sun, and at the horizon away from it. */
  zenith: string; horizon: string; antisolar: string;
  /** Halo and disc of the sun (or the afterglow once it has set). */
  sunGlow: string; sunHalo: number;
  /** Shadow-casting key light: the sun by day, a moon/sky key after sunset. */
  key: string; keyIntensity: number;
  /** Hemisphere fill from the sky and from the ground bounce. */
  skyFill: string; groundFill: string; fillIntensity: number;
  environment: number; exposure: number;
  /** Air: colour, density per metre (exponential), and the glow of haze looking toward the sun. */
  haze: string; hazeDensity: number; inscatter: string; inscatterStrength: number;
  cloudLit: string; cloudShade: string; cloudOpacity: number;
  /** Light pollution hugging the horizon. */
  cityGlow: string; cityGlowStrength: number;
  stars: number;
  /** Final grade: saturation and contrast around mid grey, and split toning. */
  saturation: number; contrast: number;
  shadowTint: [number, number, number]; highlightTint: [number, number, number];
  bloom: number; bloomThreshold: number;
}

export const CITY_PHASES: Readonly<Record<'day' | 'golden' | 'dusk' | 'night', CityPhase>> = Object.freeze({
  day: {
    zenith: '#2a66c8', horizon: '#bcdcf4', antisolar: '#a9cdee',
    sunGlow: '#fff0d2', sunHalo: .55,
    key: '#fff1dc', keyIntensity: 4.6,
    skyFill: '#cfd8e4', groundFill: '#b3a792', fillIntensity: 1.05,
    environment: .26, exposure: 1,
    haze: '#bdd7f0', hazeDensity: .00042, inscatter: '#ffe6bf', inscatterStrength: .35,
    cloudLit: '#ffffff', cloudShade: '#93abc9', cloudOpacity: .85,
    cityGlow: '#000000', cityGlowStrength: 0,
    stars: 0,
    saturation: 1.06, contrast: 1.08,
    shadowTint: [.975, .995, 1.03], highlightTint: [1.025, 1.005, .975],
    bloom: .12, bloomThreshold: 1.15,
  },
  golden: {
    zenith: '#3c62b4', horizon: '#ffad62', antisolar: '#d7a3bb',
    sunGlow: '#ff9440', sunHalo: 1.25,
    key: '#ffa95e', keyIntensity: 3.9,
    skyFill: '#aeb0c8', groundFill: '#ad8468', fillIntensity: .82,
    environment: .28, exposure: 1.06,
    haze: '#e9b092', hazeDensity: .00085, inscatter: '#ff9c58', inscatterStrength: .95,
    cloudLit: '#ffbf85', cloudShade: '#6f6399', cloudOpacity: .9,
    cityGlow: '#000000', cityGlowStrength: 0,
    stars: 0,
    saturation: 1.1, contrast: 1.1,
    shadowTint: [.955, .98, 1.05], highlightTint: [1.07, 1.005, .92],
    bloom: .22, bloomThreshold: 1.05,
  },
  dusk: {
    zenith: '#131d5e', horizon: '#f0704a', antisolar: '#3a4aa0',
    sunGlow: '#ff6a3a', sunHalo: .7,
    key: '#a8d2ff', keyIntensity: .78,
    skyFill: '#5c84b4', groundFill: '#34414e', fillIntensity: .7,
    environment: .26, exposure: 1.15,
    haze: '#34509c', hazeDensity: .001, inscatter: '#ff865a', inscatterStrength: .45,
    cloudLit: '#c06c88', cloudShade: '#1c2352', cloudOpacity: .88,
    cityGlow: '#ff9a6e', cityGlowStrength: .1,
    stars: .25,
    saturation: 1.08, contrast: 1.07,
    shadowTint: [.95, .99, 1.05], highlightTint: [1.02, 1, .97],
    bloom: .26, bloomThreshold: .98,
  },
  night: {
    zenith: '#040719', horizon: '#33244a', antisolar: '#1d1c3e',
    sunGlow: '#000000', sunHalo: 0,
    key: '#9cc6ff', keyIntensity: .82,
    skyFill: '#44597e', groundFill: '#2a2f3c', fillIntensity: 1.0,
    environment: .2, exposure: 1.2,
    haze: '#1c1d3d', hazeDensity: .0011, inscatter: '#000000', inscatterStrength: 0,
    cloudLit: '#3b3052', cloudShade: '#0a0c1e', cloudOpacity: .8,
    cityGlow: '#f08aa8', cityGlowStrength: .13,
    stars: 1,
    saturation: 1.12, contrast: 1.08,
    shadowTint: [.95, .985, 1.06], highlightTint: [1.03, 1, .97],
    bloom: .26, bloomThreshold: 1.05,
  },
});

/** Sun heights (sine of elevation, as `sampleDaylight` reports) at which each phase is pure. */
export const PHASE_HEIGHT = Object.freeze({ night: -.34, dusk: -.15, golden: .03, day: .42 });

export interface CityLook {
  /** Phase weights, summing to one. */
  day: number; golden: number; dusk: number; night: number;
  /** True once the moon/sky key has taken over from the sun. */
  moonKey: boolean;
  /** Street lamps, signs and windows: 0 by day, 1 from sunset on. */
  lamps: number;
  zenith: THREE.Color; horizon: THREE.Color; antisolar: THREE.Color; sunGlow: THREE.Color; sunHalo: number; sunDisc: number;
  key: THREE.Color; keyIntensity: number;
  skyFill: THREE.Color; groundFill: THREE.Color; fillIntensity: number;
  environment: number; exposure: number;
  haze: THREE.Color; hazeDensity: number; inscatter: THREE.Color; inscatterStrength: number;
  cloudLit: THREE.Color; cloudShade: THREE.Color; cloudOpacity: number;
  cityGlow: THREE.Color; cityGlowStrength: number; stars: number;
  saturation: number; contrast: number; shadowTint: THREE.Vector3; highlightTint: THREE.Vector3;
  bloom: number; bloomThreshold: number;
}

export function createCityLook(): CityLook {
  const color = () => new THREE.Color();
  return {
    day: 1, golden: 0, dusk: 0, night: 0, moonKey: false, lamps: 0,
    zenith: color(), horizon: color(), antisolar: color(), sunGlow: color(), sunHalo: 0, sunDisc: 0,
    key: color(), keyIntensity: 0, skyFill: color(), groundFill: color(), fillIntensity: 0,
    environment: 0, exposure: 1, haze: color(), hazeDensity: 0, inscatter: color(), inscatterStrength: 0,
    cloudLit: color(), cloudShade: color(), cloudOpacity: 0, cityGlow: color(), cityGlowStrength: 0, stars: 0,
    saturation: 1, contrast: 1, shadowTint: new THREE.Vector3(1, 1, 1), highlightTint: new THREE.Vector3(1, 1, 1),
    bloom: 0, bloomThreshold: 1,
  };
}

type PhaseName = keyof typeof CITY_PHASES;
type ColorField = 'zenith' | 'horizon' | 'antisolar' | 'sunGlow' | 'key' | 'skyFill' | 'groundFill' | 'haze' | 'inscatter' | 'cloudLit' | 'cloudShade' | 'cityGlow';
type NumberField = 'sunHalo' | 'fillIntensity' | 'environment' | 'exposure' | 'hazeDensity' | 'inscatterStrength' | 'cloudOpacity' | 'cityGlowStrength' | 'stars' | 'saturation' | 'contrast' | 'bloom' | 'bloomThreshold';
const colorFields: ColorField[] = ['zenith', 'horizon', 'antisolar', 'sunGlow', 'key', 'skyFill', 'groundFill', 'haze', 'inscatter', 'cloudLit', 'cloudShade', 'cityGlow'];
const numberFields: NumberField[] = ['sunHalo', 'fillIntensity', 'environment', 'exposure', 'hazeDensity', 'inscatterStrength', 'cloudOpacity', 'cityGlowStrength', 'stars', 'saturation', 'contrast', 'bloom', 'bloomThreshold'];
const phaseColors = Object.fromEntries((Object.keys(CITY_PHASES) as PhaseName[]).map(name => [name,
  Object.fromEntries(colorFields.map(field => [field, new THREE.Color(CITY_PHASES[name][field])]))])) as Record<PhaseName, Record<ColorField, THREE.Color>>;

const smooth = (edge0: number, edge1: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** The two neighbouring phases at this sun height and how far toward the brighter one. */
export function cityPhaseBlend(sunHeight: number): { from: PhaseName; to: PhaseName; t: number } {
  const h = Number.isFinite(sunHeight) ? sunHeight : 1;
  if (h >= PHASE_HEIGHT.golden) return { from: 'golden', to: 'day', t: smooth(PHASE_HEIGHT.golden, PHASE_HEIGHT.day, h) };
  if (h >= PHASE_HEIGHT.dusk) return { from: 'dusk', to: 'golden', t: smooth(PHASE_HEIGHT.dusk, PHASE_HEIGHT.golden, h) };
  return { from: 'night', to: 'dusk', t: smooth(PHASE_HEIGHT.night, PHASE_HEIGHT.dusk, h) };
}

/** Fill `out` for a sun height. Allocation-free; safe to call every frame. */
export function sampleCityLook(sunHeight: number, out: CityLook): CityLook {
  const h = Number.isFinite(sunHeight) ? sunHeight : 1, { from, to, t } = cityPhaseBlend(h);
  const a = CITY_PHASES[from], b = CITY_PHASES[to];
  out.day = out.golden = out.dusk = out.night = 0; out[from] += 1 - t; out[to] += t;
  for (const field of colorFields) out[field].copy(phaseColors[from][field]).lerp(phaseColors[to][field], t);
  for (const field of numberFields) out[field] = a[field] + (b[field] - a[field]) * t;
  for (let i = 0; i < 3; i++) {
    out.shadowTint.setComponent(i, a.shadowTint[i] + (b.shadowTint[i] - a.shadowTint[i]) * t);
    out.highlightTint.setComponent(i, a.highlightTint[i] + (b.highlightTint[i] - a.highlightTint[i]) * t);
  }
  // The key hands over while it is dark: the sun fades out as it touches the
  // horizon and the moon key only then fades in from the opposite side, so a
  // shadow never swings across the street while it is visible.
  out.moonKey = h < -.02;
  const sunKey = Math.max(0, h) ** .4 * smooth(-.02, .16, h);
  const moonRise = smooth(-.04, -.2, h);
  const dayKey = CITY_PHASES.day.keyIntensity, goldenKey = CITY_PHASES.golden.keyIntensity;
  if (out.moonKey) {
    out.key.copy(phaseColors.dusk.key).lerp(phaseColors.night.key, out.night);
    out.keyIntensity = moonRise * (CITY_PHASES.dusk.keyIntensity + (CITY_PHASES.night.keyIntensity - CITY_PHASES.dusk.keyIntensity) * out.night);
  } else {
    const warm = 1 - smooth(PHASE_HEIGHT.golden, PHASE_HEIGHT.day, h);
    out.key.copy(phaseColors.day.key).lerp(phaseColors.golden.key, warm);
    out.keyIntensity = sunKey * (dayKey + (goldenKey - dayKey) * warm);
  }
  out.sunDisc = smooth(-.03, .04, h);
  out.lamps = smooth(.12, -.06, h);
  return out;
}
