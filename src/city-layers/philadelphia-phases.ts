interface Phase {
  zenith: string; horizon: string; antisolar: string;
  sunGlow: string; sunHalo: number;
  key: string; keyIntensity: number;
  skyFill: string; groundFill: string; fillIntensity: number;
  /** Image-based light from the captured sky/street/city. */
  environment: number; exposure: number;
  /** Metered key for auto-exposure: the linear luminance the scene's log average is brought to. */
  meterKey: number;
  /** Weight of the photographed sky in the dome (1 by day); radiance scale of the procedural sky. */
  photo: number; skyGain: number;
  /** Facades around the street in the captured environment: base radiance and lit-window share. */
  band: string; bandWindows: number;
  haze: string; hazeDensity: number; inscatter: string; inscatterStrength: number;
  cloudLit: string; cloudShade: string; cloudOpacity: number;
  cityGlow: string; cityGlowStrength: number; stars: number;
  saturation: number; contrast: number;
  shadowTint: [number, number, number]; highlightTint: [number, number, number];
  bloom: number; bloomThreshold: number;
}

export const PHILADELPHIA_PHASES: Readonly<Record<'day' | 'golden' | 'dusk' | 'night', Phase>> = Object.freeze({
  day: {
    zenith: '#3b6fb8', horizon: '#c4d6e6', antisolar: '#b1c8df', sunGlow: '#fff2dc', sunHalo: .5,
    key: '#fff0dc', keyIntensity: 5.4,
    skyFill: '#c9d6e6', groundFill: '#9c9282', fillIntensity: .18,
    environment: 1, exposure: 1, meterKey: .055, photo: 1, skyGain: 2.6,
    band: '#8c8277', bandWindows: 0,
    haze: '#c3d0dc', hazeDensity: .00042, inscatter: '#ffe9c8', inscatterStrength: .35,
    cloudLit: '#ffffff', cloudShade: '#a7b5c8', cloudOpacity: .75,
    cityGlow: '#000000', cityGlowStrength: 0, stars: 0,
    saturation: 1.08, contrast: 1.1,
    shadowTint: [1.01, 1.0, .975], highlightTint: [1.025, 1.005, .975],
    bloom: .07, bloomThreshold: 2.2,
  },
  golden: {
    zenith: '#6584ad', horizon: '#ffb47a', antisolar: '#b8bcc4', sunGlow: '#ff9f55', sunHalo: 1.2,
    key: '#ffae68', keyIntensity: 4.2,
    skyFill: '#a9b6cc', groundFill: '#8e6e58', fillIntensity: .16,
    environment: .9, exposure: 1.12, meterKey: .05, photo: 0, skyGain: 2.2,
    band: '#8f725e', bandWindows: .04,
    haze: '#e2b796', hazeDensity: .00075, inscatter: '#ffa060', inscatterStrength: .9,
    cloudLit: '#ffc896', cloudShade: '#776a95', cloudOpacity: .85,
    cityGlow: '#000000', cityGlowStrength: 0, stars: 0,
    saturation: 1.14, contrast: 1.1,
    shadowTint: [1.01, 1.0, .985], highlightTint: [1.07, 1.005, .91],
    bloom: .12, bloomThreshold: 1.6,
  },
  dusk: {
    zenith: '#1a2a68', horizon: '#ea8a5e', antisolar: '#3c4f98', sunGlow: '#ff7a48', sunHalo: .6,
    key: '#a9c4ff', keyIntensity: .55,
    skyFill: '#3d6fbc', groundFill: '#4a3a34', fillIntensity: .14,
    environment: .85, exposure: 1.5, meterKey: .03, photo: 0, skyGain: 1.6,
    band: '#2c2d3a', bandWindows: .2,
    haze: '#3a4a86', hazeDensity: .0009, inscatter: '#ff8a5c', inscatterStrength: .45,
    cloudLit: '#b8708a', cloudShade: '#232a58', cloudOpacity: .85,
    cityGlow: '#ff9f70', cityGlowStrength: .12, stars: .2,
    saturation: 1.12, contrast: 1.06,
    shadowTint: [.93, .98, 1.08], highlightTint: [1.03, 1, .96],
    bloom: .18, bloomThreshold: 1.2,
  },
  night: {
    zenith: '#07090f', horizon: '#3b3530', antisolar: '#1a1c22', sunGlow: '#000000', sunHalo: 0,
    key: '#9db6ff', keyIntensity: .32,
    skyFill: '#22355e', groundFill: '#3a2c22', fillIntensity: .12,
    environment: 1.15, exposure: 2.2, meterKey: .014, photo: 0, skyGain: 2.4,
    band: '#121218', bandWindows: .3,
    haze: '#1d1d2e', hazeDensity: .00095, inscatter: '#000000', inscatterStrength: 0,
    cloudLit: '#3a3248', cloudShade: '#08090f', cloudOpacity: .75,
    cityGlow: '#e8945a', cityGlowStrength: .09, stars: .45,
    saturation: 1.12, contrast: 1.08,
    shadowTint: [.93, .98, 1.08], highlightTint: [1.04, 1, .95],
    bloom: .22, bloomThreshold: 1.05,
  },
});
