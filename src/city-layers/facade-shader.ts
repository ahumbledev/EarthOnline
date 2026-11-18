import { HONG_KONG } from './cities/hong-kong.ts';

/**
 * GLSL for the base-city facade (see facade-material.ts). Lengths are metres.
 * A wall fragment knows how far along its wall it is, how high above the
 * building's base, the wall's width and top, and the building's style and seed.
 * Styles: 0 low-rise, 1 tong lau, 2 composite block, 3 residential tower,
 * 4 curtain wall, 5 podium, 6 infrastructure; 8 projecting sign, 9 shop canopy,
 * 10 concrete ledge or coping, 11 air-conditioner unit, 12 drain pipe, 13 awning,
 * 14 sheet-metal exhaust duct (seed under 64) or its cowl, 15 window cage (boxes
 * whose wall width and top are the face's own width and height).
 * Flags (high four bits): 1 wall, 2 roof, 4 grounded, 8 back-lane wall. A lane
 * wall keeps its drawn windows (no photographed front), has a back-lane street
 * floor and the lane's grime, and a drip stain under each air-conditioner unit
 * the map hung on it: map and shader pick the same bays with bcLaneHash
 * The shared hash keeps wall weathering aligned with relief geometry.
 */
export const FACADE_PARS_VERTEX = /* glsl */`
attribute vec2 uv1;
attribute vec2 uv2;
varying vec2 vBcUv;
varying vec2 vBcWall;
varying vec3 vBcWorld;
varying vec3 vBcNormal;
flat varying vec3 vBcInfo;
`;

export const FACADE_VERTEX = /* glsl */`
vBcUv = uv;
vBcWall = uv1 * 0.01;
{
  float bcFlags = floor(uv2.x / 16.0);
  vBcInfo = vec3(uv2.x - bcFlags * 16.0, uv2.y / 255.0, bcFlags);
}
vBcWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vBcNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

export const FACADE_PARS_FRAGMENT = /* glsl */`
uniform float uBcSunArc, uBcSunBake, uBcNight, uBcTime, uBcShadowExtent, uBcLane, uBcShops;
uniform vec3 uBcSunDir, uBcSunColor, uBcSkyTop, uBcSkyHorizon, uBcShadowCenter, uBcShadowRight, uBcShadowUp;
uniform sampler2D tBcSign, tBcSignTall;
uniform mediump sampler2DArray tBcPanel;
uniform vec4 uBcPanel[24];        // per photographed panel: bays, storeys, metres per bay, metres per storey
uniform vec2 uBcStylePanels[7];   // per style: first panel layer, number of panels
varying vec2 vBcUv;
varying vec2 vBcWall;
varying vec3 vBcWorld;
varying vec3 vBcNormal;
flat varying vec3 vBcInfo;
vec3 bcAlbedo; float bcRoughness; float bcMetalness; vec3 bcEmissive; float bcSunMask;
// glass: how much of the fragment mirrors the sky, and the pane's own facing
float bcGlass; vec3 bcGlassNormal; float bcStreet;

float bcHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float bcHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bcNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bcHash(i), bcHash(i + vec2(1.0, 0.0)), f.x), mix(bcHash(i + vec2(0.0, 1.0)), bcHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float bcFbm(vec2 p) { return bcNoise(p) * 0.55 + bcNoise(p * 2.07 + 13.1) * 0.3 + bcNoise(p * 4.3 + 71.7) * 0.15; }
/** Coverage of an axis-aligned box of half size h centred on the origin, one pixel soft. */
float bcBox(vec2 p, vec2 h, float px) { vec2 d = h - abs(p); return clamp(d.x / px + 0.5, 0.0, 1.0) * clamp(d.y / px + 0.5, 0.0, 1.0); }
/** Coverage of a line of half width w at distance d from its centre; thinner than a pixel fades instead of flickering. */
float bcLine(float d, float w, float px) { return clamp((w - abs(d)) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * w / px + 0.25); }
vec3 bcSrgb(vec3 c) { return pow(c, vec3(2.2)); }
/** An integer hash the map's lane rule computes too, so relief and paint agree exactly. */
uint bcLaneHash(uint s, uint w, uint a, uint b) {
  uint h = (s * 0x9E3779B1u) ^ (w * 0x85EBCA77u) ^ (a * 0xC2B2AE3Du) ^ (b * 0x27D4EB2Fu);
  h ^= h >> 15u; h *= 0x2C1B3C6Du; h ^= h >> 12u; h *= 0x297A2D39u; h ^= h >> 15u;
  return h;
}
float bcByte(uint h, uint k) { return float((h >> (8u * k)) & 255u) / 255.0; }
// Back lanes (mirrored by the map): share of bays with a unit by style, and the height above the floor where units stop.
const float BC_LANE_SHARE[4] = float[4](0.18, 0.24, 0.21, 0.13);
const float BC_LANE_CEILING = 26.0;
// Street-floor goods by the trade on the board (shop-signs.ts order): hue, how far it wanders, how strong it is.
const vec3 BC_TRADE_GOODS[32] = vec3[32](
  vec3(0.08, 0.1, 0.5), vec3(0.0, 1.0, 0.8), vec3(0.07, 0.12, 0.3), vec3(0.07, 0.07, 0.62),
  vec3(0.08, 0.1, 0.5), vec3(0.12, 0.2, 0.4), vec3(0.9, 0.3, 0.45), vec3(0.58, 0.2, 0.14),
  vec3(0.0, 1.0, 0.6), vec3(0.1, 0.32, 0.9), vec3(0.03, 0.04, 0.75), vec3(0.6, 0.4, 0.35),
  vec3(0.6, 0.5, 0.25), vec3(0.12, 0.08, 0.45), vec3(0.3, 0.8, 0.75), vec3(0.09, 0.05, 0.7),
  vec3(0.05, 0.7, 0.6), vec3(0.55, 0.2, 0.25), vec3(0.08, 0.1, 0.5), vec3(0.08, 0.1, 0.5),
  vec3(0.08, 0.1, 0.5), vec3(0.99, 0.05, 0.65), vec3(0.38, 0.08, 0.5), vec3(0.0, 1.0, 0.65),
  vec3(0.02, 0.1, 0.65), vec3(0.0, 1.0, 0.28), vec3(0.0, 1.0, 0.9), vec3(0.07, 0.5, 0.4),
  vec3(0.0, 1.0, 0.6), vec3(0.0, 1.0, 0.85), vec3(0.6, 0.3, 0.3), vec3(0.55, 0.4, 0.4));

/**
 * A room behind an opening. p: point on the opening's plane, metres from the
 * room's centre line and floor-to-ceiling middle; dir: the eye's ray in wall
 * space (x along the wall, y up, z into the room, z > 0); size: room width and
 * height. Returns where the ray lands (xyz) and on what: 0 back wall, 1 side
 * wall, 2 ceiling, 3 floor.
 */
vec4 bcRoom(vec2 p, vec3 dir, vec2 size, float depth) {
  vec3 inv = 1.0 / max(abs(dir), vec3(1e-4));
  float tx = (dir.x > 0.0 ? size.x * 0.5 - p.x : p.x + size.x * 0.5) * inv.x;
  float ty = (dir.y > 0.0 ? size.y * 0.5 - p.y : p.y + size.y * 0.5) * inv.y;
  float tz = depth * inv.z;
  float t = max(0.0, min(tx, min(ty, tz)));
  float kind = tz <= min(tx, ty) ? 0.0 : (tx < ty ? 1.0 : (dir.y > 0.0 ? 2.0 : 3.0));
  return vec4(vec3(p, 0.0) + dir * t, kind);
}

${HONG_KONG.parameters}
`;

export const FACADE_FRAGMENT = /* glsl */`
{
  int bcStyle = int(vBcInfo.x + 0.5);
  float bcSeed = vBcInfo.y, bcFlags = vBcInfo.z;
  bool bcIsWall = mod(bcFlags, 2.0) > 0.5, bcIsRoof = mod(floor(bcFlags * 0.5), 2.0) > 0.5, bcGrounded = mod(floor(bcFlags * 0.25), 2.0) > 0.5;
  bool bcLane = bcFlags > 7.5 && bcIsWall && bcGrounded && bcStyle < 4 && uBcLane > 0.5;
  vec3 bcN = normalize(vBcNormal), bcV = normalize(cameraPosition - vBcWorld);
  float h1 = bcHash11(bcSeed * 91.7 + 3.1), h2 = bcHash11(bcSeed * 47.3 + 11.9), h3 = bcHash11(bcSeed * 23.9 + 5.7);
  bcAlbedo = vec3(0.3); bcRoughness = 0.92; bcMetalness = 0.0; bcEmissive = vec3(0.0); bcSunMask = 1.0;
  bcGlass = 0.0; bcGlassNormal = bcN; bcStreet = 0.0;
  if (bcStyle == 8) {
    // a sign box standing out from the wall: the trade top to bottom on both broad faces, a lit box at night
    vec2 face = vBcWall, f = vBcUv;
    float px = max(max(length(vec2(dFdx(f.x), dFdy(f.x))), length(vec2(dFdx(f.y), dFdy(f.y)))), 1e-4);
    bcStreet = 0.6;
    if (face.x > 0.45 && abs(bcN.y) < 0.5) {
      float k = floor(bcHash11(bcSeed * 311.7 + 0.5) * 32.0);
      float fit = min(1.0, face.y / (4.2 * face.x));
      vec2 cuv = vec2(0.5 + (f.x / face.x - 0.5) / fit, 0.5 + (0.5 - f.y / face.y) * face.y / (4.0 * face.x * fit));
      vec3 board = texture2D(tBcSignTall, (vec2(mod(k, 8.0), floor(k / 8.0)) + clamp(cuv, vec2(0.04, 0.012), vec2(0.96, 0.988))) / vec2(8.0, 4.0)).rgb;
      float frame = 1.0 - bcBox(f - face * 0.5, face * 0.5 - 0.045, px);
      bcAlbedo = mix(board * 0.9, vec3(0.05), frame); bcRoughness = 0.42;
      bcEmissive = board * (1.0 - frame) * step(0.22, bcHash11(bcSeed * 77.1 + 9.0)) * uBcNight * 1.2;
    } else { bcAlbedo = vec3(0.05, 0.05, 0.055); bcRoughness = 0.5; bcMetalness = 0.6; }
  } else if (bcStyle == 9) {
    // a canopy over the shops: painted concrete or sheet, dark underneath
    float tint = bcHash11(bcSeed * 53.3 + 2.0), stain = bcFbm(vBcWorld.xz * 0.8 + bcSeed * 40.0);
    vec3 sheet = tint < 0.5 ? vec3(0.2, 0.2, 0.19) : tint < 0.75 ? vec3(0.05, 0.13, 0.09) : vec3(0.16, 0.07, 0.05);
    bcAlbedo = sheet * (0.7 + 0.5 * stain) * (bcN.y < -0.5 ? 0.5 : 1.0);
    bcStreet = 1.0;
  } else if (bcStyle == 10) {
    // a concrete ledge, floor slab or coping: dark underneath, stained where water sits on top and runs off the edge
    float along = dot(vBcWorld.xz, vec2(0.83, 1.21));
    float stain = bcFbm(vBcWorld.xz * 1.3 + bcSeed * 40.0), run = bcFbm(vec2(along * 2.6, vBcWorld.y * 0.2));
    vec3 tone = mix(vec3(0.5, 0.49, 0.46), vec3(0.64, 0.6, 0.53), h1);
    bcAlbedo = tone * (0.72 + 0.4 * stain) * (bcN.y < -0.5 ? 0.5 : bcN.y > 0.5 ? 0.82 - 0.25 * run : 1.0 - 0.32 * smoothstep(0.5, 0.85, run));
    bcStreet = 0.5;
  } else if (bcStyle == 11) {
    // an air-conditioner unit: louvred front with its fan, plain sides, rust where the casing has gone
    vec2 f = vBcUv, face = vBcWall;
    float px = max(max(length(vec2(dFdx(f.x), dFdy(f.x))), length(vec2(dFdx(f.y), dFdy(f.y)))), 1e-4);
    vec3 shell = mix(vec3(0.64, 0.64, 0.6), vec3(0.5, 0.5, 0.47), h2) * (0.85 + 0.3 * bcFbm(f * 6.0 + bcSeed * 9.0));
    if (abs(bcN.y) < 0.5 && face.x > 0.6) {
      float louvre = mix(0.85, 0.68 + 0.32 * step(0.5, fract(f.y * 24.0)), 1.0 - min(1.0, px * 30.0));
      float fan = 1.0 - smoothstep(0.16, 0.18, length(f - face * 0.5 - vec2(0.1 * (h1 < 0.5 ? -1.0 : 1.0), 0.0)));
      float rim = 1.0 - bcBox(f - face * 0.5, face * 0.5 - 0.03, px);
      shell = mix(shell * louvre, shell * 0.3, fan * 0.85);
      shell = mix(shell, shell * 1.12, rim);
    }
    shell = mix(shell, vec3(0.4, 0.24, 0.14), 0.45 * smoothstep(0.58, 0.85, bcFbm(f * 3.0 + bcSeed * 31.0)));
    bcAlbedo = shell * (bcN.y < -0.5 ? 0.5 : 1.0); bcRoughness = 0.6; bcMetalness = 0.25; bcStreet = 0.3;
  } else if (bcStyle == 12) {
    // a drain pipe: cast iron or painted, a bracket every couple of metres, rust below each one; shaded round
    // across the faces that run along it (an upright stack or a branch along the wall)
    vec2 f = vBcUv, face = vBcWall;
    bool lengthwise = face.y >= face.x;
    float along = lengthwise ? f.y : f.x, across = lengthwise ? f.x / max(face.x, 1e-3) : f.y / max(face.y, 1e-3);
    float px = max(length(vec2(dFdx(along), dFdy(along))), 1e-4);
    float at = fract(along / 1.9), bracket = bcLine(at - 0.5, 0.03, px / 1.9);
    vec3 pipe = h1 < 0.45 ? vec3(0.07, 0.07, 0.075) : h1 < 0.8 ? vec3(0.56, 0.55, 0.51) : vec3(0.42, 0.3, 0.2);
    pipe *= 0.8 + 0.3 * bcFbm(vec2(along * 1.7, bcSeed * 60.0));
    pipe = mix(pipe, vec3(0.38, 0.22, 0.12), 0.5 * smoothstep(0.5, 0.2, at) * step(0.5, h2));
    float round_ = mix(0.55 + 0.45 * sin(3.14159 * clamp(across, 0.0, 1.0)), 1.0, step(0.5, abs(bcN.y)) * float(lengthwise));
    bcAlbedo = mix(pipe, pipe * 1.3 + 0.03, bracket) * round_; bcRoughness = 0.55; bcMetalness = 0.5; bcStreet = 0.3;
  } else if (bcStyle == 13) {
    // a canvas awning: one colour or two in stripes, faded by sun and rain, dark seen from below
    float stripe = step(0.5, fract(vBcUv.x / 0.3));
    vec3 dye = mix(vec3(0.5), 0.5 + 0.5 * cos(6.2831853 * (h1 + vec3(0.0, 0.33, 0.67))), 0.6) * 0.62;
    vec3 other = h2 < 0.55 ? vec3(0.8, 0.78, 0.7) : dye * 0.55;
    vec3 cloth = mix(dye, other, stripe * step(0.35, h3));
    cloth *= 0.72 + 0.34 * bcFbm(vBcWorld.xz * 1.1 + bcSeed * 23.0);
    cloth = mix(cloth, vec3(dot(cloth, vec3(0.333))), 0.25);
    bcAlbedo = cloth * (bcN.y < 0.0 ? 0.55 : 1.0); bcRoughness = 0.88; bcStreet = 1.0;
  } else if (bcStyle == 14) {
    // a kitchen exhaust duct of galvanised sheet: a flange at every 1.2 m joint, the seam up its face, grease and
    // soot run down from each joint; some were painted once and the paint has flaked. Seed 64 and up: its cowl.
    vec2 f = vBcUv, face = vBcWall;
    float px = max(max(length(vec2(dFdx(f.x), dFdy(f.x))), length(vec2(dFdx(f.y), dFdy(f.y)))), 1e-4);
    bool cowl = bcSeed * 255.0 > 63.5, upright = abs(bcN.y) < 0.5;
    vec3 zinc = mix(vec3(0.6, 0.61, 0.6), vec3(0.47, 0.49, 0.5), h2) * (0.88 + 0.22 * bcFbm(f * vec2(0.9, 0.3) + bcSeed * 17.0));
    vec3 coat = h1 < 0.5 ? vec3(0.7, 0.68, 0.6) : vec3(0.4, 0.47, 0.44);
    float painted = step(0.66, h3) * (1.0 - smoothstep(0.5, 0.68, bcFbm(f * 2.6 + bcSeed * 5.0)));
    vec3 sheet = mix(zinc, coat, painted);
    float joint = (fract(f.y / 1.2) - 0.5) * 1.2;      // metres from the nearest joint
    float flange = upright ? bcLine(joint, 0.022, px) : 0.0;
    float drip = upright ? smoothstep(0.0, 0.08, -joint) * (1.0 - smoothstep(0.1, 0.55, -joint)) * smoothstep(0.35, 0.75, bcFbm(vec2(f.x * 7.0 + bcSeed * 3.0, f.y * 0.6))) : 0.0;
    float soot = smoothstep(0.45, 0.85, bcFbm(vec2(f.x * 2.2 + bcSeed * 9.0, f.y * 0.12)));
    float seam = upright && face.x > 0.3 ? bcLine(f.x - face.x * 0.5, 0.01, px) : 0.0;
    sheet *= (1.0 - 0.45 * drip) * (1.0 - 0.3 * soot) * (1.0 - 0.25 * seam);
    sheet = mix(sheet, sheet * 1.25 + 0.02, flange);
    if (cowl) sheet = mix(sheet * 0.55, sheet, step(0.5, fract(f.y / 0.07))) * (upright ? 1.0 : 0.7);
    bcAlbedo = sheet * (bcN.y < -0.5 ? 0.45 : 1.0);
    bcRoughness = mix(0.4, 0.8, max(painted, max(drip, soot * 0.6))); bcMetalness = mix(0.7, 0.15, max(painted, soot * 0.5)); bcStreet = 0.4;
  } else if (bcStyle == 15) {
    // a window cage: welded bars standing out from a lane window, a plate floor and a sheet roof. Between the bars
    // the front shows the window behind (dark glass mirroring the sky, lit at night), the sides the shaded wall.
    vec2 f = vBcUv, face = vBcWall;
    float px = max(max(length(vec2(dFdx(f.x), dFdy(f.x))), length(vec2(dFdx(f.y), dFdy(f.y)))), 1e-4);
    vec3 iron = h1 < 0.5 ? vec3(0.07, 0.07, 0.07) : h1 < 0.78 ? vec3(0.27, 0.35, 0.3) : vec3(0.58, 0.58, 0.55);
    iron = mix(iron, vec3(0.36, 0.2, 0.11), 0.5 * smoothstep(0.55, 0.8, bcFbm(f * 4.0 + bcSeed * 13.0)));
    if (abs(bcN.y) > 0.5) {
      bcAlbedo = bcN.y < 0.0 ? iron * 0.55 : vec3(0.3, 0.29, 0.27) * (0.75 + 0.4 * bcFbm(f * 5.0 + bcSeed * 7.0));
      bcRoughness = 0.7; bcMetalness = 0.3;
    } else {
      float front = step(0.6, face.x);
      float bars = max(bcLine((fract(f.x / 0.1) - 0.5) * 0.1, 0.007, px), bcLine((fract(f.y / 0.3) - 0.5) * 0.3, 0.01, px));
      float bar = max(bars, 1.0 - bcBox(f - face * 0.5, face * 0.5 - 0.022, px));
      vec2 w = f - face * 0.5;
      float mullion = front * max(bcLine(w.x, 0.02, px), bcLine(abs(w.y) - (face.y * 0.5 - 0.1), 0.02, px));
      vec3 behind = mix(mix(vec3(0.16, 0.16, 0.15), vec3(0.04, 0.045, 0.05), front), vec3(0.45, 0.45, 0.42), mullion);
      bcAlbedo = mix(behind, iron, bar);
      bcRoughness = mix(mix(0.85, 0.1, front), 0.6, bar); bcMetalness = mix(0.0, 0.45, bar);
      bcGlass = front * (1.0 - bar) * (1.0 - mullion) * 0.7;
      bcEmissive = vec3(1.0, 0.82, 0.6) * 0.35 * front * (1.0 - bar) * (1.0 - mullion) * uBcNight * step(0.55, h2);
    }
    bcStreet = 0.3;
  } else if (bcIsWall) {
    float u = vBcUv.x, v = vBcUv.y, W = vBcWall.x, top = vBcWall.y;
    float px = max(max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(v), dFdy(v)))), 1e-4);
    vec3 T = normalize(vec3(bcN.z, 0.0, -bcN.x) + 1e-5);
    float viewN = max(dot(bcV, bcN), 0.14);
    vec2 viewT = vec2(dot(bcV, T), bcV.y) / viewN;
    vec3 ray = vec3(-dot(bcV, T), -bcV.y, viewN);       // the eye's ray in wall space, z into the wall
    float sunN = dot(uBcSunDir, bcN);
    vec2 sunT = vec2(dot(uBcSunDir, T), uBcSunDir.y) / max(sunN, 0.08);
    // weathering shared by the whole wall
    float old = bcStyle == 1 ? mix(0.55, 1.0, h2) : bcStyle == 2 ? mix(0.35, 0.95, h2) : bcStyle == 0 ? mix(0.3, 0.8, h2) : mix(0.05, 0.4, h2);
    if (bcLane) old = mix(0.8, 1.0, h2);       // nobody repaints a back lane
    float big = bcFbm(vec2(u * 0.11 + bcSeed * 37.0, v * 0.08));
    float streak = bcFbm(vec2(u * 2.1 + bcSeed * 11.0, v * 0.06));
    vec3 tone = bcSrgb(BC_WALLS[bcStyle * 6 + int(min(5.0, floor(h1 * 6.0)))]);
    vec3 wall = tone * (0.86 + 0.26 * big);
    wall *= 1.0 - 0.24 * old * smoothstep(0.42, 0.78, streak);
    // repainted and re-tiled patches, then the tiles themselves where they are large enough to see
    vec2 patchCell = floor(vec2(u / 3.1, v / 2.6) + bcSeed * 9.0);
    wall *= 1.0 + (bcLane ? 0.2 : 0.07) * old * (bcHash(patchCell) - 0.5) * step(0.55, bcHash(patchCell + 4.0));
    if (bcStyle == 2 || bcStyle == 3) {
      vec2 tile = vec2(u, v) / 0.075;
      float joint = max(bcLine(fract(tile.x) - 0.5, 0.06, px / 0.075), bcLine(fract(tile.y) - 0.5, 0.06, px / 0.075));
      wall *= (1.0 - 0.1 * joint) * (0.97 + 0.06 * bcHash(floor(tile) + bcSeed) * (1.0 - min(1.0, px * 14.0)));
    }
    // a back lane: years of damp, kitchen soot and dripping, mottled dark and green-black toward the foot
    float laneRuns = bcFbm(vec2(u * 3.4 + bcSeed * 7.0, v * 0.05));
    if (bcLane) {
      float damp = bcFbm(vec2(u * 0.45 + bcSeed * 19.0, v * 0.22)), soot = bcFbm(vec2(u * 0.18 + bcSeed * 5.0, v * 0.03 + 7.0));
      wall = mix(wall, vec3(dot(wall, vec3(0.3, 0.5, 0.2))), 0.3);                  // sun never reaches the paint to fade it evenly
      wall *= mix(0.95, 0.55, smoothstep(0.3, 0.8, damp)) * (1.0 - 0.42 * smoothstep(0.45, 0.85, laneRuns));
      wall *= 1.0 - 0.35 * smoothstep(0.5, 0.9, soot);
      wall = mix(wall, wall * vec3(0.66, 0.74, 0.62), 0.75 * (1.0 - smoothstep(0.0, 2.6, v)) * (0.4 + 0.6 * damp));
    }
    float parapet = bcStyle == 4 ? 0.0 : 1.05;
    float G = bcGrounded && bcStyle != 6 ? (bcStyle >= 4 ? 5.4 : 4.3) : 0.0;
    float body = max(top - G - parapet, 1.0);
    float nf = max(1.0, floor(body / BC_FLOOR[bcStyle] + 0.5)), fh = body / nf;
    float fv = (v - G) / fh, fi = floor(fv), fy = fract(fv) * fh;
    float nb = max(1.0, floor(W / BC_BAY[bcStyle] + 0.4)), bw = W / nb;
    float bu = u / bw, bi = floor(bu), bx = (fract(bu) - 0.5) * bw;
    vec2 cell = vec2(bi, fi) + bcSeed * vec2(113.0, 71.0);
    float w1 = bcHash(cell), w2 = bcHash(cell + 7.7), w3 = bcHash(cell + 19.3);
    vec3 col = wall; float rough = 0.9, metal = 0.0; vec3 glow = vec3(0.0); float sunMask = 1.0, glassy = 0.0; vec3 glassN = bcN;
    // rain staining from the top edge, splash at the foot
    col *= 1.0 - 0.22 * old * smoothstep(top - 3.2, top, v) * (0.4 + 0.6 * streak);
    if (G == 0.0 && bcGrounded) col *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, 1.4, v));
    if (bcGrounded) bcStreet = exp(-max(v, 0.0) / 10.0) * (bcLane ? 0.4 : 1.0);
    bool upper = v > G && v < top - parapet;
    if (bcLane && v < top - parapet) {
      // water off every slab edge, and a rust and dirt stain under each air-conditioner unit the map hung here
      // (the first floor's units drip onto the street floor below them)
      if (upper) col *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 1.3, (1.0 - fract(fv)) * fh)) * smoothstep(0.3, 0.7, laneRuns);
      uint su = uint(bcSeed * 255.0 + 0.5), wcm = uint(W * 100.0 + 0.5);
      float stain = 0.0;
      for (int k = 0; k < 2; k++) {
        float cf = fi + float(k), floorV = G + cf * fh;
        if (cf < 0.0 || cf >= nf || floorV + 0.88 > BC_LANE_CEILING) continue;
        uint h = bcLaneHash(su, wcm, uint(max(bi, 0.0)), uint(cf));
        if (float(h & 65535u) >= BC_LANE_SHARE[bcStyle] * 65536.0) continue;
        float below = floorV + 0.36 - v, reach = 1.2 + 1.5 * bcByte(h, 3u);
        float across = abs(u - (bi + 0.5) * bw - (bcByte(h, 2u) - 0.5) * 0.36 * bw);
        float spread = mix(0.46, 0.16, clamp(below / reach, 0.0, 1.0));
        float s = step(0.0, below) * (1.0 - smoothstep(reach * 0.45, reach, below)) * (1.0 - smoothstep(spread * 0.3, spread, across));
        stain = max(stain, s * (0.45 + 0.55 * bcNoise(vec2(u * 7.0, v * 1.2) + float(h & 255u))));
      }
      col = mix(col, col * vec3(0.46, 0.38, 0.3), 0.85 * stain);
    }
    // each pane sits a little off true, so neighbours mirror different parts of the sky
    vec2 paneTilt = (vec2(bcHash(cell + 41.0), bcHash(cell + 53.0)) - 0.5) * 0.05;
    // a lane wall is a back or a side, not the photographed street front
    int panelCount = bcStyle < 7 && !bcLane ? int(uBcStylePanels[bcStyle].y + 0.5) : 0;
    if (upper && panelCount > 0 && W > 1.7) {
      // a photographed front, one photographed bay to each bay of this wall
      float layer = uBcStylePanels[bcStyle].x + min(float(panelCount) - 1.0, floor(h3 * float(panelCount)));
      vec4 shape = uBcPanel[int(layer + 0.5)];
      float bays = max(1.0, floor(W / shape.z + 0.5)), storeys = max(1.0, floor(body / shape.w + 0.5));
      vec2 at = vec2(u / (W / bays) / shape.x, (v - G) / (body / storeys) / shape.y);
      vec4 photo = textureGrad(tBcPanel, vec3(fract(at.x), 1.0 - fract(at.y), layer), vec2(dFdx(at.x), -dFdx(at.y)), vec2(dFdy(at.x), -dFdy(at.y)));
      vec2 window = floor(at * shape.xy) + bcSeed * vec2(113.0, 71.0);
      float light = dot(photo.rgb, vec3(0.3, 0.59, 0.11));
      // a photograph already carries the shade of its own street; lift it back toward the bare surface
      vec3 front = photo.rgb * mix(1.22, 1.0, photo.a) * (0.92 + 0.16 * big);
      // lean the wall (not the glass) toward this building's own tone and weather it a little more
      front = mix(front, front * tone / max(dot(tone, vec3(0.333)), 0.05), 0.22 * (1.0 - photo.a));
      front *= 1.0 - 0.16 * old * smoothstep(0.45, 0.8, streak) * (1.0 - photo.a);
      col = front; rough = mix(0.88, 0.12, photo.a);
      float lit = step(1.0 - BC_OCCUPIED[bcStyle], bcHash(window)) * uBcNight;
      float warm = bcHash(window + 19.3);
      vec3 lamp = bcStyle == 4 ? vec3(0.86, 0.93, 1.0) : warm < 0.45 ? vec3(1.0, 0.68, 0.38) : warm < 0.8 ? vec3(1.0, 0.86, 0.66) : vec3(0.72, 0.85, 1.0);
      // a lit room shows through the photographed window: its frames, curtains and clutter stay readable
      glow = lamp * lit * photo.a * (photo.rgb * 0.8 + 0.06) * (0.45 + 0.75 * bcHash(window + 61.0));
      glassy = photo.a * 0.6;
      glassN = normalize(bcN + T * paneTilt.x + vec3(0.0, paneTilt.y, 0.0));
    } else if (bcStyle == 4 && v > G) {
      // curtain wall: mullions at every bay, a transom and spandrel at every floor
      float spandrel = 1.0 - smoothstep(1.05, 1.05 + px, fy);
      float mullion = max(bcLine(abs(bx) - bw * 0.5, 0.035, px), max(bcLine(fy, 0.045, px), bcLine(fy - fh, 0.045, px)));
      col = tone * mix(0.5, 0.8, spandrel) * (0.94 + 0.12 * (w3 - 0.5));
      metal = mix(0.6, 0.4, spandrel); rough = mix(0.08, 0.22, spandrel);
      float floorLit = step(0.62, bcHash(vec2(fi, bcSeed * 57.0))), bayLit = step(0.25, bcHash(vec2(floor(bu / 3.0), fi) + bcSeed * 17.0));
      vec4 office = bcRoom(vec2(bx, fy - fh * 0.5), ray, vec2(bw * 3.0, fh), 9.0);
      float ceiling = office.w == 2.0 ? 0.6 + 0.4 * step(0.6, fract(office.z * 0.45)) : office.w == 0.0 ? 0.55 : 0.32;
      glow = vec3(0.86, 0.93, 1.0) * uBcNight * floorLit * bayLit * (1.0 - spandrel) * ceiling * 0.7;
      glassy = mix(0.95, 0.5, spandrel) * (1.0 - mullion);
      glassN = normalize(bcN + T * paneTilt.x + vec3(0.0, paneTilt.y, 0.0));
      col = mix(col, vec3(0.16, 0.17, 0.18), mullion); metal = mix(metal, 0.7, mullion); rough = mix(rough, 0.45, mullion); glow *= 1.0 - mullion;
    } else if (upper && bcStyle != 6 && W > 1.7) {
      float ww, wh, sill, depth;
      if (bcStyle == 1) { ww = bw - 0.5; wh = 1.6; sill = 0.92; depth = 0.16; }
      else if (bcStyle == 2) { ww = min(bw - 0.85, 1.95); wh = 1.32; sill = 0.98; depth = 0.13; }
      else if (bcStyle == 3) { ww = min(bw - 0.95, 2.2); wh = 1.55; sill = 0.78; depth = 0.1; }
      else if (bcStyle == 5) { ww = bw - 1.0; wh = 1.5; sill = 1.3; depth = 0.1; }
      else { ww = min(bw - 1.1, 1.5); wh = 1.2; sill = 1.05; depth = 0.12; }
      // across a lane: the small high windows of kitchens and bathrooms (the map hangs its units under these sills)
      if (bcLane) { ww = min(bw - 0.9, 1.15); wh = 1.15; sill = 1.0; depth = 0.12; }
      bool hasWindow = bcStyle != 5 || bcHash(vec2(fi, bcSeed * 43.0)) > 0.55;
      vec2 half_ = vec2(ww, wh) * 0.5;
      vec2 p = vec2(bx, fy - (sill + half_.y));
      // floor line and the dirt that gathers under each sill
      col *= 1.0 - 0.1 * bcLine(fy, 0.03, px) * step(1.5, float(bcStyle));
      float under = bcBox(vec2(p.x, p.y + half_.y + 0.55), vec2(half_.x, 0.55), px);
      col *= 1.0 - 0.26 * old * under * (0.35 + 0.65 * streak) * float(hasWindow);
      if (bcStyle == 5) {
        // cladding panels
        vec2 joint = vec2(fract(u / 1.2) * 1.2, fract(v / 0.75) * 0.75);
        col *= 1.0 - 0.22 * max(bcLine(joint.x, 0.012, px), bcLine(joint.y, 0.012, px));
        rough = 0.55; metal = 0.25;
      }
      // drain pipes on some bay lines of the older blocks (a lane wall has the map's own stacks)
      if ((bcStyle == 1 || bcStyle == 2) && !bcLane) {
        float edge = (0.5 - abs(fract(bu) - 0.5)) * bw, line = floor(bu + 0.5);
        float has = step(0.55, bcHash(vec2(line, bcSeed * 91.0)));
        float pipe = bcLine(edge - 0.16, 0.055, px) * has;
        float shade = bcLine(edge - 0.16 + sign(fract(bu) - 0.5) * sunT.x * 0.09, 0.055, px) * has * step(0.0, sunN);
        sunMask *= 1.0 - 0.6 * shade * (1.0 - pipe);
        col = mix(col, mix(vec3(0.07), vec3(0.62, 0.6, 0.56), step(0.5, bcHash(vec2(line, bcSeed * 7.0)))), pipe);
      }
      if (hasWindow) {
        float opening = bcBox(p, half_, px);
        vec2 q = p - viewT * depth;                     // where the eye's ray meets the glass plane
        float pane = bcBox(q, half_, px) * opening;     // the rest of the opening is its reveal
        vec3 reveal = wall * 0.5;
        // frame, mullions and (tong lau) a transom
        float frame = 1.0 - bcBox(q, half_ - 0.05, px);
        float panes = bcStyle == 1 ? max(2.0, floor(ww / 0.62)) : bcStyle == 3 ? 3.0 : 2.0;
        float mx = (fract((q.x + half_.x) / ww * panes + 0.5) - 0.5) * ww / panes;
        frame = max(frame, bcLine(mx, 0.022, px));
        if (bcStyle == 1) frame = max(frame, bcLine(q.y - half_.y * 0.42, 0.022, px));
        vec3 frameCol = bcStyle == 3 ? vec3(0.62, 0.63, 0.63) : mix(vec3(0.5, 0.5, 0.48), vec3(0.2, 0.16, 0.12), step(0.7, h3));
        // behind the glass: a room, and in front of it a curtain or blind drawn some of the way
        vec4 room = bcRoom(vec2(q.x, q.y + sill + half_.y - fh * 0.5), ray, vec2(bw, fh - 0.25), 3.6);
        vec3 paper = mix(vec3(0.62, 0.56, 0.46), vec3(0.5, 0.56, 0.6), step(0.6, w3)) * (0.7 + 0.6 * bcHash(cell + 61.0));
        float surface = room.w == 0.0 ? 0.62 : room.w == 2.0 ? 1.0 : room.w == 3.0 ? 0.3 : 0.5;
        surface *= 0.55 + 0.45 * smoothstep(-fh * 0.5, fh * 0.4, room.y);
        vec3 inside = (room.w == 2.0 ? vec3(0.9, 0.88, 0.84) : paper) * surface;
        float kind = w2;                                // none, drawn, half drawn, blind let down
        vec3 cloth = (kind < 0.5 ? vec3(0.78, 0.72, 0.6) : kind < 0.75 ? vec3(0.55, 0.62, 0.72) : vec3(0.84, 0.83, 0.78)) * (0.8 + 0.4 * w3);
        float edge = kind < 0.55 ? q.x * (w3 > 0.5 ? 1.0 : -1.0) + half_.x * (w3 * 1.3 - 0.35) : half_.y * (w3 * 1.5 - 0.5) - q.y;
        float drawn = kind < 0.22 ? 0.0 : kind < 0.4 ? 1.0 : 1.0 - smoothstep(-0.03, 0.03, kind < 0.8 ? -edge : edge);
        float fold = kind < 0.8 ? 0.82 + 0.18 * sin(q.x * 34.0 + w3 * 9.0) : 0.86 + 0.14 * step(0.5, fract(q.y * 16.0));
        fold = mix(1.0, fold, 1.0 - min(1.0, px * 10.0));
        vec3 glass = mix(inside * 0.12, cloth * fold * 0.4, drawn * 0.9);
        float lit = step(1.0 - BC_OCCUPIED[bcStyle], w1) * uBcNight;
        vec3 lamp = w3 < 0.45 ? vec3(1.0, 0.68, 0.38) : w3 < 0.8 ? vec3(1.0, 0.86, 0.66) : vec3(0.72, 0.85, 1.0);
        vec3 lightIn = lamp * lit * mix(inside * 1.5, cloth * fold * 0.85, drawn);
        if (bcLane) {
          // a lane window: frosted bathroom glass or the glass louvres of a kitchen, often lit by a bare tube
          float frosted = step(w2, 0.4), louvred = step(0.4, w2) * step(w2, 0.62);
          glass = mix(glass, vec3(0.38, 0.4, 0.39) * (0.8 + 0.2 * bcNoise(q * 7.0 + w1 * 9.0)), frosted);
          glass = mix(glass, glass * (0.5 + 0.5 * step(0.5, fract(q.y / 0.1))), louvred * (1.0 - min(1.0, px * 18.0)));
          lightIn = mix(lightIn, mix(vec3(0.85, 0.95, 1.0), lamp, step(0.6, w3)) * lit * 0.5, frosted);
        }
        // the head and jamb of the opening shade the glass
        float sunIn = sunN > 0.0 ? bcBox(q + sunT * depth, half_, px) : 0.0;
        vec3 winCol = mix(glass, frameCol, frame); float winRough = mix(0.08, 0.45, frame), winMetal = mix(0.0, 0.6, frame);
        col = mix(col, mix(reveal, winCol, pane), opening);
        rough = mix(rough, mix(0.9, winRough, pane), opening);
        metal = mix(metal, winMetal * pane, opening);
        glow = lightIn * (1.0 - frame) * pane * opening;
        glassy = (1.0 - frame) * pane * opening * mix(1.0, 0.75, drawn);
        glassN = normalize(bcN + T * paneTilt.x + vec3(0.0, paneTilt.y, 0.0));
        sunMask *= mix(1.0, mix(0.35, sunIn, pane), opening);
        if (bcLane && w3 > 0.42) {
          // a steel grille over the opening, a hand's width proud of the wall, black or painted green
          vec2 g = p + half_ + 0.05;
          float bars = max(bcLine((fract(g.x / 0.11) - 0.5) * 0.11, 0.009, px), bcLine((fract(g.y / 0.42) - 0.5) * 0.42, 0.013, px));
          float grille = max(bars, 1.0 - bcBox(p, half_ + 0.03, px)) * bcBox(p, half_ + 0.05, px);
          vec3 iron = h3 < 0.5 ? vec3(0.07, 0.07, 0.07) : vec3(0.3, 0.38, 0.33);
          col = mix(col, iron, grille); rough = mix(rough, 0.6, grille); metal = mix(metal, 0.4, grille);
          glow *= 1.0 - grille; glassy *= 1.0 - grille;
        }
        // a window air conditioner in a lower corner of the opening, standing 0.3 m proud (a lane wall has the map's units)
        if ((bcStyle == 1 || bcStyle == 2 || bcStyle == 0) && !bcLane && bcHash(cell + 3.3) > 0.38) {
          vec2 ac = p - vec2((w2 > 0.5 ? 1.0 : -1.0) * (half_.x - 0.37), -half_.y + 0.2), acHalf = vec2(0.33, 0.2);
          vec2 front = ac + viewT * 0.3;
          float face = bcBox(front, acHalf, px), foot = bcBox(ac, acHalf, px), body_ = max(face, foot);
          vec3 box = mix(vec3(0.5, 0.5, 0.47), vec3(0.62, 0.6, 0.53), w3) * (0.8 + 0.2 * step(0.5, fract(front.y * 26.0)) * (1.0 - min(1.0, px * 30.0)));
          col = mix(col, mix(box * 0.55, box, face), body_);
          rough = mix(rough, 0.6, body_); metal = mix(metal, 0.3, body_); glow *= 1.0 - body_; glassy *= 1.0 - body_;
          float acShade = sunN > 0.0 ? max(bcBox(ac + sunT * 0.3, acHalf, px), bcBox(ac + sunT * 0.15, acHalf, px)) : 0.0;
          sunMask = mix(sunMask * (1.0 - 0.85 * acShade), 1.0, face);
          col *= 1.0 - 0.3 * old * bcBox(vec2(ac.x, ac.y + acHalf.y + 0.7), vec2(0.22, 0.7), px) * (1.0 - body_) * streak;
        }
      }
    } else if (bcLane && v <= G && W > 2.6) {
      // the street floor of a back lane: render over a tiled dado, steel back doors and roller shutters, meter
      // cabinets, a bulkhead lamp over each door lit at night (the map hangs a hood over some, from the same hash)
      uint su = uint(bcSeed * 255.0 + 0.5), wcm = uint(W * 100.0 + 0.5);
      float ns = max(1.0, floor(W / 3.6 + 0.5)), cw = W / ns;
      float ci = clamp(floor(u / cw), 0.0, ns - 1.0);
      uint hc = bcLaneHash(su, wcm, uint(ci), 1000u);
      float k1 = bcByte(hc, 0u), k2 = bcByte(hc, 1u), k3 = bcByte(hc, 2u);
      bool door = k1 < 0.42, cabinet = k1 >= 0.56 && k1 < 0.74;
      float dw = door ? 0.95 + 0.25 * k2 : min(cw - 0.8, 2.6), head = door ? 2.15 : 2.6;
      float dc = (ci + 0.5) * cw + (k3 - 0.5) * max(0.0, cw - dw - 0.8);
      bool hasDoor = k1 < 0.56 && dw >= 0.8;
      vec2 dp = vec2(u - dc, v - head * 0.5);
      // glazed tiles to 1.2 m in some lanes, and grime splashed up from the ground
      vec2 tt = vec2(u, v) / 0.15;
      float tj = max(bcLine(fract(tt.x) - 0.5, 0.05, px / 0.15), bcLine(fract(tt.y) - 0.5, 0.05, px / 0.15));
      vec3 dado = mix(vec3(0.72, 0.74, 0.7), vec3(0.52, 0.62, 0.56), step(0.75, h1)) * (1.0 - 0.18 * tj) * (0.9 + 0.1 * bcHash(floor(tt) + bcSeed));
      col = mix(col, dado * (0.75 + 0.25 * streak), step(0.5, h3) * (1.0 - smoothstep(1.18, 1.2 + px, v)));
      col *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.7, v)) * (0.5 + 0.5 * laneRuns);
      float opening = hasDoor ? bcBox(dp, vec2(dw, head) * 0.5, px) : 0.0;
      float frame = opening * (1.0 - bcBox(dp, vec2(dw * 0.5 - 0.05, head * 0.5 - 0.04), px));
      // a steel door: flush panels, a pull, chipped paint, rust at the foot; or a roller shutter in a wider opening
      vec3 paintD = k2 < 0.3 ? vec3(0.16, 0.29, 0.21) : k2 < 0.55 ? vec3(0.4, 0.42, 0.43) : k2 < 0.8 ? vec3(0.36, 0.13, 0.1) : vec3(0.6, 0.56, 0.48);
      float seams = max(bcLine(dp.y - 0.12, 0.01, px), bcLine(dp.y + head * 0.5 - 0.3, 0.01, px));
      float pull = bcBox(dp - vec2(dw * 0.5 - 0.15, 0.0), vec2(0.02, 0.12), px);
      float chips = smoothstep(0.6, 0.8, bcFbm(vec2(u, v) * 3.0 + k3 * 20.0));
      vec3 leaf = paintD * (0.85 + 0.15 * bcFbm(vec2(u * 2.0, v * 0.5) + k2 * 9.0)) * (1.0 - 0.18 * seams);
      leaf = mix(leaf, vec3(0.36, 0.22, 0.13), max(chips * 0.6, 0.7 * (1.0 - smoothstep(0.0, 0.35, v)) * smoothstep(0.4, 0.7, laneRuns)));
      leaf = mix(leaf, vec3(0.55, 0.55, 0.52), pull);
      float crown = mix(0.86, 0.6 + 0.4 * sin(fract(v / 0.075) * 3.14159), 1.0 - min(1.0, px * 18.0));
      vec3 shutter = mix(vec3(0.5, 0.52, 0.55), vec3(0.42, 0.47, 0.42), step(0.5, k2)) * crown * (1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.9, v)));
      col = mix(col, mix(door ? leaf : shutter, vec3(0.2, 0.2, 0.21), frame), opening);
      rough = mix(rough, door ? 0.55 : 0.45, opening); metal = mix(metal, 0.45, opening);
      // a meter cabinet where there is no door
      vec2 cp = vec2(u - (ci + 0.5) * cw - (k3 - 0.5) * max(0.0, cw - 1.4), v - 1.55);
      float cabinetShape = cabinet ? bcBox(cp, vec2(0.32, 0.45), px) : 0.0;
      vec3 cab = mix(vec3(0.5, 0.52, 0.5), vec3(0.34, 0.4, 0.36), step(0.5, k2)) * mix(1.0, 0.6 + 0.4 * step(0.5, fract(cp.y / 0.05)), step(0.25, cp.y) * (1.0 - min(1.0, px * 20.0)));
      cab *= 1.0 - 0.2 * bcLine(cp.x, 0.006, px);
      col = mix(col, mix(cab, cab * 0.4, 1.0 - bcBox(cp, vec2(0.3, 0.43), px)), cabinetShape);
      metal = mix(metal, 0.4, cabinetShape); rough = mix(rough, 0.5, cabinetShape);
      // a bulkhead lamp over the door, lit at night, its light spread on the wall around it
      vec2 lp = vec2(u - dc, v - head - 0.13);
      float lampShape = hasDoor ? bcBox(lp, vec2(0.12, 0.06), px) : 0.0, onAtNight = step(0.3, k3) * uBcNight;
      col = mix(col, vec3(0.8, 0.8, 0.74), lampShape);
      float pool = hasDoor ? exp(-dot(lp * vec2(1.0, 1.6), lp * vec2(1.0, 1.6)) / 1.1) : 0.0;
      glow = vec3(1.0, 0.9, 0.72) * (lampShape * 2.2 + col * pool * 0.45) * onAtNight;
      glassy = 0.0;
      sunMask *= 1.0 - 0.6 * opening * (1.0 - smoothstep(0.0, 0.3, head - v));
    } else if (v <= G && W > 2.6) {
      // street floor: tiled piers with grime and bills, a fascia board per shop, then a shutter,
      // an open stall, a glazed shopfront or an eatery
      float ns = max(1.0, floor(W / 4.4 + 0.5)), sw = W / ns;
      float su = u / sw, si = floor(su), sx = (fract(su) - 0.5) * sw;
      vec2 shop = vec2(si, 77.0) + bcSeed * vec2(57.0, 13.0);
      float s1 = bcHash(shop), s2 = bcHash(shop + 5.1), s3 = bcHash(shop + 9.7), s4 = bcHash(shop + 23.3);
      float pierHalf = 0.18 + 0.1 * h1;
      float inner = sw - 2.0 * pierHalf;
      float inside = bcBox(vec2(sx, 0.0), vec2(inner * 0.5, 1.0), px);
      float boardHigh = G - 0.22, boardLow = boardHigh - (0.85 + 0.45 * s4);
      float board = bcBox(vec2(sx, v - (boardLow + boardHigh) * 0.5), vec2(sw * 0.5 - 0.08, (boardHigh - boardLow) * 0.5), px);
      float k = floor(s1 * 32.0);
      vec2 signUv = vec2(clamp(sx / ((boardHigh - boardLow) * 2.0) + 0.5, 0.04, 0.96), clamp(1.0 - (v - boardLow) / (boardHigh - boardLow), 0.06, 0.94));
      vec3 sign = texture2D(tBcSign, (vec2(mod(k, 4.0), floor(k / 4.0)) + signUv) / vec2(4.0, 8.0)).rgb;
      // a board that has hung over a street for years: sun-faded, rain-run, dust on its upper edge
      sign *= (0.82 + 0.18 * bcFbm(vec2(u * 0.9, v * 0.5) + s1 * 31.0)) * (1.0 - 0.25 * old * smoothstep(0.5, 0.85, bcFbm(vec2(u * 3.1 + s2 * 17.0, v * 0.12))));
      sign = mix(sign, vec3(dot(sign, vec3(0.333))), 0.12 + 0.25 * old * s4);
      float front = inside * (1.0 - step(boardLow, v));
      float shut = step(s2, 0.24 + 0.3 * uBcNight);
      // what is inside follows the trade on the board: 0 eatery, 1 bright counters (pharmacy, glasses, watches, jade,
      // phone parts), 2 produce (fruit, flowers), 3 hanging clothes and cloth, 4 food on show (roast meat, bread, meat),
      // 5 a service counter (exchange, salon, laundry, clinic, estate agent, tutor), 6 goods on shelves
      int trade = int(k);
      int kind = uBcShops < 0.5 ? (s3 >= 0.78 ? 0 : 6)
        : (trade == 0 || trade == 4 || trade == 18 || trade == 19 || trade == 20) ? 0
        : (trade == 1 || trade == 12 || trade == 13 || trade == 22 || trade == 29) ? 1
        : (trade == 9 || trade == 14) ? 2
        : (trade == 23 || trade == 27 || trade == 28) ? 3
        : (trade == 10 || trade == 15 || trade == 21) ? 4
        : (trade == 5 || trade == 6 || trade == 11 || trade == 17 || trade == 30 || trade == 31) ? 5 : 6;
      float glazed = step(0.42, s3) * step(s3, 0.78), eatery = kind == 0 ? 1.0 : 0.0;
      // piers: small tiles, splash grime at the foot, bills pasted at hand height
      {
        vec2 pt = vec2(u, v) / 0.1;
        float pj = max(bcLine(fract(pt.x) - 0.5, 0.05, px / 0.1), bcLine(fract(pt.y) - 0.5, 0.05, px / 0.1));
        col *= 1.0 - 0.13 * pj * (1.0 - min(1.0, px * 12.0));
        col *= 1.0 - 0.38 * mix(0.5, 1.0, old) * (1.0 - smoothstep(0.0, 1.2, v)) * (0.45 + 0.55 * streak);
        vec2 bill = vec2(u / 0.42, (v - 0.9) / 0.56), cellB = floor(bill) + bcSeed * 31.0;
        float pasted = step(0.9, v) * step(v, 2.02) * step(0.6, bcHash(cellB)) * bcBox(fract(bill) - 0.5, vec2(0.4, 0.43), px / 0.45);
        vec3 paper = mix(vec3(0.82, 0.8, 0.72), 0.5 + 0.5 * cos(6.2831853 * (bcHash(cellB + 3.0) + vec3(0.0, 0.33, 0.67))), 0.3 * step(0.5, bcHash(cellB + 5.0)));
        paper *= 0.72 + 0.28 * bcNoise(vec2(u, v) * 11.0) - 0.25 * step(0.5, fract(v * 23.0)) * step(0.35, abs(fract(bill.x) - 0.5) * 0.0 + bcHash(cellB + 9.0)) * (1.0 - min(1.0, px * 40.0)) * 0.6;
        col = mix(col, paper, pasted * (1.0 - inside) * 0.92);
      }
      // the room behind an open front
      vec4 hit = bcRoom(vec2(sx, v - boardLow * 0.5), ray, vec2(inner, boardLow), mix(5.0, 7.5, s4));
      vec2 shelf = hit.w == 0.0 ? hit.xy : hit.w == 1.0 ? hit.zy : hit.xz;
      float rowH = 0.34, row = floor(shelf.y / rowH), lift = fract(shelf.y / rowH);
      float pitch = mix(0.09, 0.26, bcHash(vec2(row, s3 * 17.0)));
      float along = shelf.x / pitch + row * 7.3, slot = floor(along);
      float stock = bcHash(vec2(slot, row) + s3 * 31.0);
      // each shelf carries one line of goods, so colour runs along it instead of scattering
      vec3 family = 0.5 + 0.5 * cos(6.2831853 * (bcHash(vec2(row, s1 * 13.0)) + vec3(0.0, 0.33, 0.67)));
      vec3 goods = mix(vec3(0.42, 0.38, 0.32), family, 0.28) * (0.45 + 0.55 * stock);
      vec3 shelfEdge = vec3(0.74, 0.72, 0.66);
      vec3 shopLight = vec3(1.0, 0.93, 0.8);
      float yA = shelf.y + boardLow * 0.5;                    // height above the shop floor where the eye's ray lands
      if (uBcShops > 0.5) {
        // the trade's own goods: a hue, how far it wanders and how strong it is (BC_TRADE_GOODS)
        vec3 g = BC_TRADE_GOODS[trade];
        float hue = g.x + (bcHash(vec2(row, s1 * 13.0)) - 0.5) * g.y + (stock - 0.5) * g.y * 0.4;
        vec3 tint = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) - hue));   // hue as on a colour wheel: 0 red, 1/6 yellow, 1/3 green
        goods = mix(vec3(0.5, 0.47, 0.42), tint, g.z) * (0.4 + 0.6 * stock);
        // white shelving and cold bright light in the counters and offices, warm bulbs over food and produce
        shelfEdge = kind == 1 || kind == 5 ? vec3(0.9, 0.9, 0.88) : kind == 6 && s2 > 0.55 ? vec3(0.42, 0.3, 0.2) : shelfEdge;
        shopLight = kind == 1 || kind == 5 ? vec3(1.0, 1.04, 1.12) * 1.3 : kind == 2 || kind == 4 ? vec3(1.12, 0.9, 0.66) : vec3(1.0, 0.95, 0.86);
        if (kind == 1) {
          // small packets, densely stocked, above a lit glass counter
          float fine = shelf.x / mix(0.05, 0.11, bcHash(vec2(row, s3 * 5.0))) + row * 3.1;
          goods = mix(vec3(0.6, 0.58, 0.55), 0.5 + 0.5 * cos(6.2831853 * (bcHash(vec2(floor(fine), row) + s1 * 3.0) + vec3(0.0, 0.33, 0.67))), g.z)
            * (0.55 + 0.45 * bcHash(vec2(floor(fine), row + 9.0)));
          goods *= 1.0 - 0.45 * step(fract(fine), 0.12);
          if (yA < 0.95 && hit.w != 3.0) goods = mix(vec3(0.75, 0.8, 0.82), goods * 1.3, step(0.3, yA) * step(yA, 0.85));
        }
      }
      goods = mix(goods, vec3(0.8, 0.78, 0.7), step(0.8, stock) * 0.5);
      goods *= 1.0 - 0.5 * step(fract(along), 0.1);
      goods = mix(vec3(0.05, 0.045, 0.04), goods, step(0.12, lift) * step(lift, 0.5 + 0.45 * stock));
      goods = mix(goods, shelfEdge, step(lift, 0.1));
      if (uBcShops > 0.5 && kind == 3) {
        // clothes on two rails along the walls, each garment its own colour, hems at different lengths
        float tier = step(1.2, yA), rail = tier > 0.5 ? min(2.1, boardLow - 0.15) : 1.15;
        float strip = floor(shelf.x / 0.075 + tier * 17.0), drop = 0.72 + 0.2 * bcHash(vec2(strip, s3 * 7.0));
        vec3 g = BC_TRADE_GOODS[trade];
        vec3 cloth = mix(vec3(0.45, 0.43, 0.4), 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) - g.x - (bcHash(vec2(strip, s1 * 9.0)) - 0.5) * g.y)), g.z)
          * (0.45 + 0.55 * bcHash(vec2(strip, 3.0 + s2)));
        cloth *= 0.8 + 0.2 * smoothstep(0.0, 0.25, fract(shelf.x / 0.075));
        float hung = step(rail - drop, yA) * step(yA, rail);
        goods = mix(vec3(0.62, 0.6, 0.57) * 0.55, cloth, hung);
        goods = mix(goods, vec3(0.7, 0.7, 0.68), bcLine(yA - rail - 0.02, 0.012, 0.01));
      } else if (uBcShops > 0.5 && kind == 4 && trade != 15) {
        // roast meat or fresh meat hung on hooks along a rail at head height, a chopping counter below
        float hook = floor(shelf.x / 0.32), at = fract(shelf.x / 0.32) - 0.5;
        float len = 0.45 + 0.25 * bcHash(vec2(hook, s3 * 11.0)), top_ = min(2.15, boardLow - 0.2);
        float body_ = bcBox(vec2(at * 0.32, yA - (top_ - 0.06 - len * 0.5)), vec2(0.09 + 0.03 * bcHash(vec2(hook, 5.0)), len * 0.5), 0.02);
        vec3 meat = trade == 10 ? mix(vec3(0.42, 0.13, 0.05), vec3(0.62, 0.3, 0.1), bcHash(vec2(hook, 1.0))) : mix(vec3(0.62, 0.2, 0.18), vec3(0.8, 0.5, 0.45), bcHash(vec2(hook, 2.0)));
        goods = mix(vec3(0.72, 0.72, 0.68) * (yA < 0.95 ? 0.6 : 1.0), meat * (0.75 + 0.25 * sin(at * 9.0 + 1.0)), body_ * step(1.0, yA));
        goods = mix(goods, vec3(0.6, 0.6, 0.6), bcLine(yA - top_, 0.012, 0.01));
      } else if (uBcShops > 0.5 && kind == 5) {
        // a counter, white walls, framed notices and price boards
        vec2 frameAt = fract(vec2(shelf.x / 0.9, (yA - 1.35) / 0.6)) - 0.5;
        float notice = step(1.35, yA) * step(yA, 1.95) * bcBox(frameAt, vec2(0.36, 0.24), 0.02) * step(0.35, bcHash(floor(vec2(shelf.x / 0.9, 0.0)) + s1));
        goods = mix(vec3(0.84, 0.84, 0.82), mix(vec3(0.9, 0.88, 0.8), 0.5 + 0.5 * cos(6.2831853 * (s1 + vec3(0.0, 0.33, 0.67))), 0.35), notice);
        goods = mix(goods, mix(vec3(0.42, 0.3, 0.22), vec3(0.75, 0.75, 0.74), step(0.5, s2)), step(yA, 1.0));
      }
      // an eatery: tiled dado, menu papers above it
      vec2 menuCell = floor(shelf / vec2(0.46, 0.3)) + s1 * 9.0, menuAt = fract(shelf / vec2(0.46, 0.3)) - 0.5;
      float dado = step(shelf.y, -boardLow * 0.5 + 1.25);
      vec3 tiles = vec3(0.74, 0.77, 0.73) * (1.0 - 0.18 * max(bcLine(fract(shelf.x / 0.15) - 0.5, 0.06, 0.2), bcLine(fract(shelf.y / 0.15) - 0.5, 0.06, 0.2)));
      vec3 menu = mix(vec3(0.62, 0.58, 0.5), mix(vec3(0.85, 0.2, 0.14), vec3(0.93, 0.8, 0.3), step(0.5, bcHash(menuCell))) * (0.7 + 0.3 * step(0.5, fract(shelf.y * 31.0))),
        step(0.45, bcHash(menuCell + 4.0)) * bcBox(menuAt, vec2(0.4, 0.36), 0.03));
      vec3 lining = mix(goods, mix(menu, tiles, dado), eatery);
      vec2 floorTile = floor(hit.xz / 0.4);
      vec3 floorCol = mix(vec3(0.2, 0.19, 0.175), vec3(0.3, 0.27, 0.23), eatery) * (0.86 + 0.14 * mod(floorTile.x + floorTile.y, 2.0));
      if (uBcShops > 0.5 && kind == 2 && hit.w == 3.0 && hit.z < 2.2) {
        // fruit heaped in crates by the door, or buckets of cut flowers
        vec2 piece = hit.xz / 0.11, at = fract(piece) - 0.5;
        float pick = bcHash(floor(piece / vec2(4.0, 3.0)) + s3 * 13.0);
        vec3 fruit = trade == 14 ? mix(vec3(0.2, 0.42, 0.12), 0.5 + 0.5 * cos(6.2831853 * (bcHash(floor(piece)) + vec3(0.0, 0.33, 0.67))), step(0.45, bcHash(floor(piece) + 3.0)))
          : pick < 0.3 ? vec3(0.95, 0.48, 0.08) : pick < 0.5 ? vec3(0.75, 0.1, 0.08) : pick < 0.7 ? vec3(0.42, 0.62, 0.12) : pick < 0.85 ? vec3(0.95, 0.82, 0.18) : vec3(0.42, 0.12, 0.3);
        floorCol = fruit * (0.45 + 0.55 * sqrt(max(0.0, 1.0 - 3.6 * dot(at, at))));
      }
      vec3 shopCol = hit.w == 2.0 ? vec3(0.3) + vec3(1.0, 1.02, 1.05) * step(0.84, fract(hit.z * 0.7 + 0.2)) * step(abs(hit.x), inner * 0.34)
        : hit.w == 3.0 ? floorCol : lining * (hit.w == 0.0 ? 0.9 : 0.7);
      shopCol *= mix(1.0, 0.42, smoothstep(1.0, 5.5, hit.z));
      shopCol *= mix(vec3(1.0), vec3(1.08, 0.98, 0.84), eatery);
      if (uBcShops > 0.5) shopCol *= shopLight / vec3(1.0, 0.93, 0.8);
      // a glazed front: aluminium mullions, a transom, a tiled stall riser, one door with a push bar
      float nm = max(2.0, floor(inner / 1.3 + 0.5)), gx = (sx + inner * 0.5) / inner * nm;
      float gm = (fract(gx) - 0.5) * inner / nm, door = step(abs(floor(gx) - floor(s4 * nm)), 0.5);
      float riser = glazed * (1.0 - door) * (1.0 - smoothstep(0.45, 0.45 + px, v));
      float mull = max(bcLine(abs(gm) - inner / nm * 0.5, 0.035, px), max(bcLine(v - (boardLow - 0.5), 0.03, px), bcLine(v - 0.45, 0.03, px) * (1.0 - door)));
      mull = glazed * max(mull, door * bcLine(v - 1.05, 0.022, px) * step(abs(gm), 0.3));
      vec3 riserCol = mix(vec3(0.2, 0.21, 0.22), vec3(0.5, 0.36, 0.3), step(0.5, s1)) * (1.0 - 0.2 * bcLine(fract(u / 0.2) - 0.5, 0.05, px / 0.2)) * (1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.3, v)));
      vec3 open = shopCol * mix(0.3, 0.2, glazed);
      open = mix(open, riserCol, riser);
      open = mix(open, vec3(0.3, 0.31, 0.32), mull);
      // the shutter: curved slats that catch the light on their crowns, guide rails, a bottom bar, rust and notices
      float slat = fract(v / 0.075), crown = 0.6 + 0.4 * sin(slat * 3.14159);
      crown = mix(0.86, crown, 1.0 - min(1.0, px * 18.0));
      vec3 paint = s3 < 0.4 ? vec3(0.5, 0.52, 0.55) : s3 < 0.65 ? vec3(0.42, 0.47, 0.56) : s3 < 0.85 ? vec3(0.62, 0.6, 0.52) : vec3(0.3, 0.42, 0.36);
      vec3 shutter = paint * crown;
      shutter *= 1.0 - 0.32 * (1.0 - smoothstep(0.0, 0.9, v)) - 0.2 * smoothstep(0.5, 0.8, bcFbm(vec2(u * 1.3, v * 0.2) + s1 * 9.0));
      shutter = mix(shutter, vec3(0.36, 0.2, 0.12), 0.55 * smoothstep(0.62, 0.8, bcFbm(vec2(u * 2.3, v * 0.6) + s4 * 23.0)) * (1.0 - smoothstep(0.0, 1.4, v)));
      vec2 note = vec2(sx / 0.5, v / 0.4) + s1 * 7.0;
      float stuck = step(0.86, bcHash(floor(note))) * step(0.8, v) * step(v, 2.0) * bcBox(fract(note) - 0.5, vec2(0.3, 0.36), px / 0.45);
      shutter = mix(shutter, vec3(0.86, 0.84, 0.76) * (0.78 + 0.22 * bcNoise(vec2(u, v) * 14.0)), stuck);
      float rails = max(1.0 - bcBox(vec2(sx, 0.0), vec2(inner * 0.5 - 0.06, 1.0), px), 1.0 - smoothstep(0.1, 0.1 + px, v));
      shutter = mix(shutter, vec3(0.24, 0.25, 0.26), rails);
      col = mix(col, mix(open, shutter, shut), front);
      rough = mix(rough, mix(mix(0.6, 0.1, glazed * (1.0 - riser) * (1.0 - mull)), 0.42, shut), front);
      metal = mix(metal, mix(0.5 * mull, 0.55, shut), front);
      glow = shopCol * shopLight * front * (1.0 - shut) * (1.0 - riser) * (1.0 - mull) * mix(mix(0.2, 0.15, glazed), 0.8, uBcNight);
      glassy = front * (1.0 - shut) * glazed * (1.0 - riser) * (1.0 - mull) * 0.85;
      glassN = bcN;
      col = mix(col, sign, board); rough = mix(rough, 0.5, board); metal = mix(metal, 0.0, board);
      // a dark frame round the board and the shade it throws on the front below
      col = mix(col, vec3(0.06), board * (1.0 - bcBox(vec2(sx, v - (boardLow + boardHigh) * 0.5), vec2(sw * 0.5 - 0.12, (boardHigh - boardLow) * 0.5 - 0.04), px)));
      glow = mix(glow, sign * 0.95 * uBcNight * step(0.3, s3), board);
      glassy *= 1.0 - board;
      sunMask *= 1.0 - 0.7 * front * (1.0 - smoothstep(0.0, 0.5, boardLow - v));
      // dirt where the wall meets the pavement, and the soffit line above the board
      col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.16, v)) * (1.0 - front * 0.5);
      col *= 1.0 - 0.35 * smoothstep(G - 0.2, G, v);
    } else if (bcStyle == 6) {
      // bare concrete of a footbridge or flyover: formwork panels, tie holes, runs of water from every joint and ledge
      vec2 formPanel = vec2(u / 2.4, v / 1.2), inPanel = fract(formPanel);
      float joint = max(bcLine(inPanel.x - 0.5 + 0.5 * sign(0.5 - inPanel.x), 0.012 / 2.4, px / 2.4), bcLine(inPanel.y - 0.5 + 0.5 * sign(0.5 - inPanel.y), 0.012 / 1.2, px / 1.2));
      vec2 tie = abs(fract(formPanel * vec2(2.0, 2.0)) - 0.5) * vec2(1.2, 0.6);
      float hole = (1.0 - smoothstep(0.025, 0.04, length(tie))) * (1.0 - min(1.0, px * 30.0));
      float pour = bcHash(floor(formPanel) + bcSeed * 13.0);
      col *= (0.9 + 0.16 * pour) * (1.0 - 0.3 * joint) * (1.0 - 0.35 * hole);
      float runs = smoothstep(0.45, 0.8, bcFbm(vec2(u * 2.6 + bcSeed * 7.0, v * 0.09)));
      col *= 1.0 - 0.3 * runs * smoothstep(top - 2.5, top, v) - 0.18 * runs;
      col = mix(col, col * vec3(0.8, 0.86, 0.74), 0.5 * smoothstep(0.55, 0.8, bcFbm(vec2(u * 0.4, v * 0.5) + 51.0)) * (1.0 - smoothstep(0.0, 1.5, v)));
      rough = 0.95;
    } else if (v >= top - parapet && parapet > 0.0) {
      col *= mix(1.0, 1.12, bcLine(v - top + 0.07, 0.07, px));
    }
    bcAlbedo = col; bcRoughness = rough; bcMetalness = metal; bcEmissive = glow; bcSunMask = sunMask; bcGlass = glassy; bcGlassNormal = glassN;
  } else if (bcIsRoof) {
    vec2 r = vBcUv;
    float n1 = bcFbm(r * 0.31 + bcSeed * 20.0), n2 = bcFbm(r * 1.9 + 5.0);
    vec3 roof = mix(vec3(0.115, 0.115, 0.11), vec3(0.22, 0.215, 0.2), n1);
    if (h2 > 0.74) roof = mix(roof, vec3(0.07, 0.14, 0.09), 0.75);
    else if (h2 > 0.56) roof = mix(roof, vec3(0.2, 0.075, 0.055), 0.65);
    // felt laid in strips, stains where water ponds, moss in the damp corners
    vec2 strip = fract(r / vec2(1.0, 9.0));
    float rpx = max(length(fwidth(r)), 1e-4);
    float seam = bcLine(strip.x - 0.5, 0.02, rpx) * (1.0 - min(1.0, rpx * 6.0));
    float pond = smoothstep(0.55, 0.75, bcFbm(r * 0.12 + bcSeed * 31.0));
    roof *= (1.0 - 0.25 * seam) * (1.0 - 0.3 * pond);
    roof = mix(roof, roof * vec3(0.75, 0.95, 0.7), 0.4 * smoothstep(0.62, 0.8, n1) * pond);
    bcAlbedo = roof * (0.8 + 0.4 * n2); bcRoughness = mix(0.92, 0.6, pond);
  } else {
    bcAlbedo = vec3(0.09);
  }
}
`;

/** Replaces three's ambient-occlusion step: the light map's sky share and sun interval. */
export const FACADE_LIGHT = /* glsl */`
{
  #ifdef USE_AOMAP
    vec3 bcBake = texture2D(aoMap, vAoMapUv).rgb;
  #else
    vec3 bcBake = vec3(1.0, 0.0, 1.0);
  #endif
  float bcSky = bcBake.r;
  // A wall that sees little sky is still lit by the street around it.
  reflectedLight.indirectDiffuse *= mix(0.3, 1.0, bcSky);
  reflectedLight.indirectSpecular *= mix(0.3, 1.0, smoothstep(0.0, 0.55, bcSky));
  float bcSun = smoothstep(bcBake.g - 0.03, bcBake.g + 0.03, uBcSunArc) * (1.0 - smoothstep(bcBake.b - 0.03, bcBake.b + 0.03, uBcSunArc));
  vec3 bcRel = vBcWorld - uBcShadowCenter;
  float bcOut = max(abs(dot(bcRel, uBcShadowRight)), abs(dot(bcRel, uBcShadowUp)));
  float bcFar = uBcShadowExtent > 0.0 ? smoothstep(uBcShadowExtent * 0.78, uBcShadowExtent * 0.98, bcOut) : 1.0;
  float bcDirect = mix(1.0, bcSun, bcFar * uBcSunBake) * bcSunMask;
  reflectedLight.directDiffuse *= bcDirect;
  reflectedLight.directSpecular *= bcDirect;
  // sunlight thrown back by the street and the fronts across it; at night, the glow of the street itself
  vec3 bcFill = uBcSunColor * vec3(1.0, 0.94, 0.86) * 0.11 * uBcSunBake * (0.45 + 0.55 * (1.0 - bcSky))
    + vec3(1.0, 0.66, 0.4) * 1.0 * uBcNight * bcStreet;
  reflectedLight.indirectDiffuse += bcFill * material.diffuseColor * RECIPROCAL_PI;
  // glass mirrors the sky where the mirrored ray clears the street, and the fronts across it where it does not
  if (bcGlass > 0.001) {
    vec3 bcEye = normalize(cameraPosition - vBcWorld);
    vec3 bcR = reflect(-bcEye, bcGlassNormal);
    float bcClear = smoothstep((1.0 - bcSky) * 0.9 - 0.3, (1.0 - bcSky) * 0.9 + 0.15, bcR.y);
    vec3 bcAbove = mix(uBcSkyHorizon, uBcSkyTop, smoothstep(0.0, 0.75, bcR.y));
    // What stands across the street: fronts of differing tone, storey bands with darker window rows,
    // the upper part in sun when the sun is on that side, the street itself darker below eye level.
    float bcTurn = atan(bcR.z, bcR.x), bcRise = bcR.y / max(length(bcR.xz), 0.05);
    float bcBlock = bcHash(vec2(floor(bcTurn * 9.0), 3.0)), bcStorey = fract(bcRise * 11.0 + bcBlock * 5.0);
    float bcRow = smoothstep(0.3, 0.38, bcStorey) * (1.0 - smoothstep(0.72, 0.8, bcStorey)) * step(0.3, fract(bcTurn * 61.0 + bcBlock * 9.0));
    vec3 bcFront = mix(vec3(0.3, 0.29, 0.27), vec3(0.52, 0.47, 0.42), bcBlock) * (1.0 - 0.55 * bcRow);
    float bcLitSide = smoothstep(-0.2, 0.5, -dot(normalize(vec3(bcR.x, 0.0, bcR.z) + 1e-5), vec3(uBcSunDir.x, 0.0, uBcSunDir.z))) * smoothstep(0.05, 0.5, bcRise);
    vec3 bcAcross = bcFront * mix(vec3(0.03, 0.035, 0.05), mix(vec3(0.34, 0.36, 0.4), uBcSunColor * 0.2, bcLitSide), uBcSunBake) * (0.6 + 0.4 * bcSky);
    bcAcross = mix(bcAcross, bcAcross * 0.45, smoothstep(0.02, -0.25, bcRise));
    float bcFresnel = 0.09 + 0.91 * pow(1.0 - saturate(dot(bcEye, bcGlassNormal)), 5.0);
    totalEmissiveRadiance += mix(bcAcross, bcAbove, bcClear) * bcFresnel * bcGlass;
  }
}
`;
