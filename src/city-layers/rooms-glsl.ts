import * as THREE from 'three';

/**
 * Rooms behind window glass by interior mapping: each pane looks into a box
 * (back wall with furniture and a doorway, side walls, floor, ceiling with a
 * light panel), traced from the eye ray in the pane's own frame. No geometry
 * or textures; the room size follows world position, so neighbouring panes
 * of one room share it, and the picture moves with parallax as you walk.
 *
 * `tokyoRoomLight` is shared by every Tokyo window material: x is the daylight
 * that reaches into a room, y the strength of the lamps in occupied rooms at night.
 */
export const tokyoRoomLight = { value: new THREE.Vector2(.2, 0) };

export const ROOMS_GLSL = /* glsl */ `
  uniform vec2 tokyoRoomLight;
  float tkRoomHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  // Radiance seen through a window at world point wp on a wall facing n (unit, horizontal), for an eye at cameraPosition.
  // facing: cosine between the eye ray and the wall normal, for the caller's Fresnel. lit: whether the room's lamps are on.
  // origin: where the room grid starts (along the wall, height); cell: room width and storey height.
  vec3 tokyoRoom(vec3 wp, vec3 n, vec2 origin, vec2 cell, float occupancy, out float facing, out float lit) {
    vec3 t = vec3(-n.z, 0.0, n.x);
    const float RD = 4.6;
    float RW = cell.x, RH = cell.y;
    vec2 q = vec2(dot(wp, t), wp.y) - origin;
    vec2 room = floor(q / cell);
    vec3 o = vec3(q - room * cell, 0.0);
    vec3 v = normalize(wp - cameraPosition), d = vec3(dot(v, t), v.y, -dot(v, n));
    d.z = max(d.z, 1e-3); d.x = abs(d.x) < 1e-4 ? 1e-4 : d.x; d.y = abs(d.y) < 1e-4 ? 1e-4 : d.y;
    vec3 far = vec3((d.x > 0.0 ? RW - o.x : -o.x) / d.x, (d.y > 0.0 ? RH - o.y : -o.y) / d.y, RD / d.z);
    float tt = min(min(far.x, far.y), far.z); vec3 hit = o + d * tt;
    float seed = tkRoomHash(vec3(room, floor(dot(wp, n) * 0.25) + 3.0));
    vec3 paint = mix(vec3(0.66, 0.63, 0.57), vec3(0.55, 0.59, 0.6), step(0.5, seed)) * (0.85 + 0.3 * fract(seed * 7.0));
    vec3 c;
    if (tt == far.z) {
      float furniture = step(hit.y, 0.75 + 0.6 * fract(seed * 13.0)) * step(0.35, fract(hit.x / 1.3 + seed));
      float door = step(abs(hit.x - RW * (0.2 + 0.6 * fract(seed * 5.0))), 0.45) * step(hit.y, 2.1) * step(0.6, fract(seed * 3.0));
      c = paint * 0.8 * (1.0 - 0.55 * furniture) * (1.0 - 0.6 * door);
    } else if (tt == far.y) c = d.y > 0.0 ? vec3(0.78, 0.78, 0.76) : mix(vec3(0.3, 0.26, 0.22), vec3(0.36, 0.37, 0.38), step(0.5, fract(seed * 11.0)));
    else c = paint * 0.68;
    float daylight = mix(1.0, 0.35, smoothstep(0.0, RD, hit.z));
    lit = step(1.0 - occupancy, tkRoomHash(vec3(room, 11.0)));
    float warm = tkRoomHash(vec3(room, 17.0));
    vec3 lamp = mix(vec3(1.0, 0.78, 0.52), vec3(0.86, 0.93, 1.0), step(0.55, warm)) * (0.55 + 0.6 * fract(warm * 9.0));
    float panel = (tt == far.y && d.y > 0.0) ? step(abs(fract(hit.x / 1.7) - 0.5), 0.12) * step(abs(hit.z - 1.8), 0.6) : 0.0;
    facing = clamp(-dot(v, n), 0.0, 1.0);
    // Far away a room is a few pixels: show its average so the picture never shimmers.
    float footprint = length(fwidth(wp));
    float detail = 1.0 - smoothstep(0.08, 0.35, footprint);
    c = mix(paint * 0.62, c, detail); panel *= detail; daylight = mix(0.62, daylight, detail);
    return c * (tokyoRoomLight.x * daylight + tokyoRoomLight.y * lit * lamp * (0.55 + 0.45 * smoothstep(RD, 0.0, hit.z))) + lamp * panel * tokyoRoomLight.y * lit * 1.5;
  }
`;
