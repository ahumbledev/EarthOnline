/**
 * Montréal masonry at its real scale: rock-faced grey limestone in courses of
 * 30–45 cm with stones of uneven length, and red brick 21.5 × 7.5 cm in
 * running bond. Each stone has a rough face and rolled edges that catch or
 * lose the sun (returned as a factor on direct light, since the facade can
 * only change albedo and the share of sun), mortar joints set back from the
 * face, and per-stone tone that fades to the wall's average before it can
 * shimmer. `p` is metres along the wall and up from its foot, `px` metres per
 * pixel, `sunW` the sun in wall space (x along, y up, z out of the wall).
 */
export const MONTREAL_MASONRY = /* glsl */`
float mtlRock(vec2 p, float seed) { return bcNoise(p * 6.5 + seed * 40.0) * 0.65 + bcNoise(p * 17.0 + seed * 13.0) * 0.35; }

vec3 mtlMasonry(vec2 p, float px, bool brick, bool tower, float seed, vec3 tone, vec3 sunW, out float sunShade, out float jointMask) {
  float courseH = brick ? 0.075 : tower ? 0.62 : 0.3 + 0.12 * fract(seed * 13.7);
  float course = floor(p.y / courseH);
  float len = brick ? 0.215 : tower ? 1.15 : mix(0.5, 1.3, bcHash(vec2(course, seed * 17.0)));
  float shift = brick ? mod(course, 2.0) * 0.5 : bcHash(vec2(course, seed * 29.0));
  vec2 cell = vec2(p.x / len + shift, p.y / courseH), id = floor(cell), f = fract(cell);
  vec2 toEdge = (0.5 - abs(f - 0.5)) * vec2(len, courseH);
  float jw = brick ? 0.005 : 0.007;
  float joint = max(bcLine(toEdge.x, jw, px), bcLine(toEdge.y, jw, px));
  // per-stone detail fades once a stone is a few pixels tall
  float near = 1.0 - smoothstep(courseH * 0.12, courseH * 0.5, px);
  float h = bcHash(id + seed * 7.1);
  vec3 c = tone * (1.0 + (brick ? 0.2 : 0.09) * (h - 0.5) * near);
  if (brick) c = mix(c, c * vec3(0.6, 0.55, 0.53), step(0.9, bcHash(id + 3.3)) * near);
  else c *= 1.0 + 0.05 * (bcNoise(p * 2.3 + seed * 9.0) - 0.5);
  // relief: a rough face whose edges roll back into the joints
  vec2 e = vec2(0.02, 0.0);
  float bevel = brick ? 0.012 : 0.035;
  float hx0 = smoothstep(0.0, bevel, toEdge.x) * smoothstep(0.0, bevel, toEdge.y);
  vec2 slope = vec2(0.0);
  if (near > 0.01) {
    float r0 = mtlRock(p, h), rx = mtlRock(p + e.xy, h), ry = mtlRock(p + e.yx, h);
    slope = vec2(rx - r0, ry - r0) / 0.02 * (brick ? 0.004 : 0.016);
    // the rolled edge leans the face away from the stone's centre
    vec2 side = sign(f - 0.5) * (1.0 - smoothstep(0.0, bevel, toEdge)) * 0.9;
    slope += side;
    slope *= near;
  }
  vec3 n = normalize(vec3(-slope, 1.0));
  float flat_ = max(sunW.z, 0.06);
  sunShade = clamp(max(dot(n, sunW), 0.0) / flat_, 0.25, 1.7);
  // the joint is set back: in shade from the stone above it when the sun is high
  sunShade *= 1.0 - 0.55 * joint * near;
  jointMask = joint;
  vec3 mortar = brick ? vec3(0.42, 0.4, 0.36) : tone * 0.8 + vec3(0.03);
  c = mix(c, mortar, joint * (brick ? 0.85 : 0.55));
  c *= mix(0.9, 1.0, hx0);
  return c;
}
`;
