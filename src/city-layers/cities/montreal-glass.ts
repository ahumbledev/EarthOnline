/**
 * What a Montréal window mirrors: the fronts across the street, with their
 * stone, their windows and, after dark, their lit rooms and shops; the sky
 * above their cornices; the street below. A street is taken as 15 m wide and
 * the fronts across as one to five storeys in 12 m lots. It is an inferred
 * street, not the real one, but it gives glass the busy, dark-and-light
 * reflection of a city window instead of one flat colour.
 *
 * `V` points from the pane to the eye, `N` is the pane's facing, `along` the
 * pane's position along its wall and `height` above the street, both metres.
 */
export const MONTREAL_GLASS = /* glsl */`
vec3 mtlStreetMirror(vec3 V, vec3 N, float along, float height, float seed) {
  vec3 R = reflect(-V, N);
  float out_ = max(dot(R, N), 0.035);
  vec3 tang = normalize(vec3(N.z, 0.0, -N.x) + 1e-5);
  float t = 15.0 / out_;
  vec2 hit = vec2(along + dot(R, tang) * t, height + R.y * t);
  float lot = floor(hit.x / 12.0 + seed * 7.0), lotSeed = bcHash(vec2(lot, seed * 31.0));
  float cornice = 7.5 + 12.0 * lotSeed;
  vec2 fp = max(fwidth(hit), vec2(1e-3));
  vec3 sky = mix(uBcSkyHorizon, uBcSkyTop, smoothstep(0.0, 0.7, R.y));
  if (hit.y < 0.0) {
    // the street between: dark paving, a little sky in it when wet after dark
    return mix(vec3(0.05, 0.05, 0.048) * (0.4 + 0.6 * uBcSunBake), sky * 0.2, 0.2);
  }
  vec3 stone = lotSeed < 0.6 ? mix(vec3(0.5, 0.48, 0.43), vec3(0.62, 0.6, 0.55), fract(lotSeed * 7.0)) : vec3(0.42, 0.22, 0.15);
  float lit = 0.12 + 0.55 * uBcSunBake;
  vec3 front = stone * lit * (0.8 + 0.4 * bcNoise(hit * vec2(0.6, 0.9) + lot));
  // windows of the storeys across: a dark pane with the sky in it, or a lit room after dark
  vec2 cell = vec2(hit.x / 2.9, (hit.y - 4.0) / 3.3);
  vec2 local = (fract(cell) - 0.5) * vec2(2.9, 3.3);
  // a reflection is never quite in focus: soften edges by more than a pixel
  float soft = max(max(fp.x, fp.y) * 2.5, 0.35);
  float window = bcBox(local - vec2(0.0, 0.15), vec2(0.62, 0.9), soft) * step(4.0, hit.y);
  float roomLit = step(0.62, bcHash(floor(cell) + lot * 3.1)) * uBcNight;
  vec3 pane = mix(sky * 0.35, vec3(1.0, 0.72, 0.42) * 0.38, roomLit);
  front = mix(front, pane, window);
  // shop fronts across: dark glass by day, a warm band of lit shops at night
  float shopBand = (1.0 - step(3.4, hit.y)) * step(0.5, hit.y);
  float shopLit = step(0.42, bcHash(vec2(floor(hit.x / 4.6), lot + 9.0))) * uBcNight;
  front = mix(front, mix(vec3(0.03) + sky * 0.08, vec3(1.0, 0.78, 0.5) * 0.45, shopLit), shopBand * (1.0 - bcLine(fract(hit.x / 4.6) - 0.5, 0.05, soft / 4.6)));
  float sky_ = smoothstep(cornice - soft, cornice + soft, hit.y);
  return mix(front, sky, sky_);
}
`;
