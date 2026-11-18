import * as THREE from 'three';

/**
 * Tokyo's camera and air for each hour, shared by the source Shibuya renderer
 * and the continuous core (Kabukicho and Akihabara draw through the same chain).
 *
 * The source HDR fixes the sun's direction; the hour changes its strength and
 * colour, the haze and the grade, so late afternoon reads warm and low-contrast
 * in the shade, and night is a dark street lit by its own signs rather than a
 * darkened day.
 */
export const TOKYO_LOOK = {
  day: { saturation: 1.17, curve: .2, shadowTint: [.975, .99, 1.02], highlightTint: [1.02, 1.0, .975], bloom: .05, key: .2, fog: [.78, .83, .9], fogDensity: .0019 },
  golden: { saturation: 1.18, curve: .22, shadowTint: [.94, .98, 1.06], highlightTint: [1.05, 1.0, .9], bloom: .08, key: .2, fog: [1.0, .82, .64], fogDensity: .0024, sun: [1, .75, .5] },
  night: { saturation: 1.22, curve: .18, shadowTint: [.94, .97, 1.07], highlightTint: [1.03, 1.0, .97], bloom: .45, key: .11, fog: [.035, .033, .045], fogDensity: .0024, spill: .8, fill: .3 },
  lens: { fringe: .0028, sharpen: .36, grain: .6 },
  /** Rooms behind upper-floor glass and photographed windows: daylight level, and night lamp strength. */
  rooms: { day: .09, night: .4 },
  /** How much of the photographed sky's lower half is replaced by the street's own bounce. */
  bounce: { albedo: .15, canyon: .62, tint: [1.0, .95, .87], lane: [.44, .42, .39] },
  ao: { radius: 1.15, distanceExponent: 1.5, thickness: 1.6, scale: 1.3, samples: 16, blend: 1.0 },
};

/** Daylight, night and late-sun warmth for a world hour (0..24). */
export function hourLook(hour: number) {
  const height = Math.sin((hour - 6) * Math.PI / 12);
  const daylight = THREE.MathUtils.smoothstep(height, -.12, .25), night = 1 - daylight;
  // Warmth rises over the last two and a half hours of sun and the first two of morning.
  const warmth = (1 - THREE.MathUtils.smoothstep(height, .1, .58)) * THREE.MathUtils.smoothstep(height, -.16, .02);
  return { daylight, night, warmth };
}

const mix3 = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
/** The grade for an hour: day blended toward golden by warmth, then toward night. */
export function gradeFor(hour: number, horizon?: number[]) {
  const { daylight, night, warmth } = hourLook(hour), { golden } = TOKYO_LOOK, dark = TOKYO_LOOK.night;
  // Distant haze takes the colour of the sky at the horizon behind it, so the skyline does not glow against it.
  const day = horizon ? { ...TOKYO_LOOK.day, fog: mix3(TOKYO_LOOK.day.fog, horizon, .7) } : TOKYO_LOOK.day;
  const lit = (key: 'saturation' | 'curve' | 'bloom' | 'key' | 'fogDensity') => THREE.MathUtils.lerp(THREE.MathUtils.lerp(day[key], golden[key], warmth), dark[key], night);
  const lit3 = (key: 'shadowTint' | 'highlightTint' | 'fog') => mix3(mix3(day[key], golden[key], warmth), dark[key], night);
  return { daylight, night, warmth, saturation: lit('saturation'), curve: lit('curve'), bloom: lit('bloom'), key: lit('key'), fogDensity: lit('fogDensity'),
    shadowTint: lit3('shadowTint'), highlightTint: lit3('highlightTint'), fog: lit3('fog'), sunTint: mix3([1, 1, 1], golden.sun, warmth) };
}

/** Mean radiance of the band of sky just above the horizon (equirectangular rows, zenith first). */
export function horizonColour(data: Float32Array, width: number, height: number) {
  const sum = [0, 0, 0]; let count = 0;
  for (let j = Math.floor(height * .46); j < Math.floor(height / 2); j++) for (let i = 0; i < width; i++) {
    const k = (j * width + i) * 4; for (let c = 0; c < 3; c++) sum[c] += data[k + c]; count++;
  }
  return sum.map(v => v / Math.max(1, count));
}

/**
 * A street does not see sky below the horizon: it sees pavement and the fronts
 * opposite, lit by the sun and warm-grey. Replace the photographed lower half of
 * the lighting copy of the HDR (never the visible background) with that bounce,
 * so shade on walls and under canopies is neutral grey instead of sky blue.
 */
export function replaceLowerHemisphere(data: Float32Array, width: number, height: number, groundIrradiance: THREE.Vector3) {
  const { albedo, canyon, tint } = TOKYO_LOOK.bounce;
  const lum = .2126 * groundIrradiance.x + .7152 * groundIrradiance.y + .0722 * groundIrradiance.z;
  const tintLum = .2126 * tint[0] + .7152 * tint[1] + .0722 * tint[2];
  const radiance = albedo * canyon * lum / Math.PI / tintLum, bounce = tint.map(v => v * radiance);
  const horizon = Math.floor(height / 2), blend = Math.max(1, Math.round(height * .035));
  for (let j = horizon; j < height; j++) {
    const t = THREE.MathUtils.smoothstep(j - horizon, 0, blend);
    for (let i = 0; i < width; i++) {
      const k = (j * width + i) * 4;
      for (let c = 0; c < 3; c++) data[k + c] += (bounce[c] - data[k + c]) * t;
    }
  }
  return bounce;
}
