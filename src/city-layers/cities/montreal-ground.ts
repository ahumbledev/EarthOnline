/** Only Montréal declares these uniforms; Hong Kong's compiled GLSL stays unchanged. */
export const MONTREAL_GROUND_PARS = /* glsl */`
uniform sampler2D tBcTerrain;
uniform vec2 uBcTerrainOrigin, uBcTerrainSize;
uniform float uBcTerrainStep, uBcTerrainNodata, uBcTerrainEnabled;

float bcTerrainHeight(vec2 worldXZ, float fallback) {
  if (uBcTerrainEnabled < 0.5) return fallback;
  vec2 grid = (worldXZ - uBcTerrainOrigin) / uBcTerrainStep;
  if (any(lessThan(grid, vec2(0.0))) || any(greaterThan(grid, uBcTerrainSize - 1.0))) return fallback;
  vec2 node = min(floor(grid), uBcTerrainSize - 2.0), part = grid - node;
  vec2 a = (node + 0.5) / uBcTerrainSize, texel = 1.0 / uBcTerrainSize;
  // Manual interpolation works without the OES_texture_float_linear extension.
  vec4 h = vec4(texture2D(tBcTerrain, a).r,
    texture2D(tBcTerrain, a + vec2(texel.x, 0.0)).r,
    texture2D(tBcTerrain, a + vec2(0.0, texel.y)).r,
    texture2D(tBcTerrain, a + texel).r);
  if (any(equal(h, vec4(uBcTerrainNodata)))) return fallback;
  return mix(mix(h.x, h.y, part.x), mix(h.z, h.w, part.x), part.y);
}
`;
