/**
 * The stone openings of the twelve photographed Montréal panels that get relief
 * (greystone_1–4, warehouse_1–4, plex_1–4, in the package's panel order), traced by eye
 * from the panel images. The map package (tools/base-city/cities/montreal_relief.py,
 * OPENINGS) puts stone sills and lintels at exactly these openings. When the photographs
 * are not drawn (low graphics, or before they load) the procedural windows use the same
 * openings, so the stone still frames a window. Fractions of one panel repeat, y up.
 * The panel shapes repeat panels.json (bays, storeys, metres per bay, metres per storey).
 */
export const MONTREAL_OPENINGS = /* glsl */`
const vec4 MTL_TRACED_SHAPE[12] = vec4[12](
  vec4(3.0, 2.0, 2.6, 3.6), vec4(3.0, 1.0, 2.8, 3.5), vec4(1.0, 1.0, 3.6, 4.0), vec4(2.0, 2.0, 3.0, 3.9),
  vec4(2.0, 1.0, 3.0, 3.5), vec4(1.0, 1.0, 2.8, 3.5), vec4(3.0, 1.0, 2.8, 3.6), vec4(4.0, 1.0, 2.4, 3.5),
  vec4(1.0, 1.0, 4.2, 3.5), vec4(1.0, 1.0, 3.7, 3.5), vec4(1.0, 1.0, 3.1, 3.1), vec4(1.0, 1.0, 2.7, 3.1));
const vec4 MTL_TRACED[72] = vec4[72](
  // greystone_1
  vec4(0.073, 0.665, 0.326, 0.95), vec4(0.39, 0.665, 0.65, 0.95), vec4(0.716, 0.665, 0.963, 0.95), vec4(0.073, 0.12, 0.326, 0.465), vec4(0.39, 0.12, 0.65, 0.465), vec4(0.716, 0.12, 0.963, 0.465),
  // greystone_2
  vec4(0.146, 0.16, 0.289, 0.805), vec4(0.333, 0.16, 0.471, 0.805), vec4(0.737, 0.16, 0.875, 0.805), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // greystone_3
  vec4(0.24, 0.146, 0.708, 0.727), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // greystone_4
  vec4(0.156, 0.753, 0.432, 0.91), vec4(0.659, 0.753, 0.945, 0.91), vec4(0.138, 0.258, 0.411, 0.44), vec4(0.632, 0.258, 0.958, 0.44), vec4(-1.0), vec4(-1.0),
  // warehouse_1
  vec4(0.104, 0.242, 0.318, 0.88), vec4(0.651, 0.242, 0.867, 0.88), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // warehouse_2
  vec4(0.172, 0.26, 0.797, 0.776), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // warehouse_3
  vec4(0.078, 0.177, 0.232, 0.815), vec4(0.357, 0.177, 0.526, 0.815), vec4(0.734, 0.177, 0.896, 0.815), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // warehouse_4
  vec4(0.052, 0.151, 0.172, 0.815), vec4(0.302, 0.151, 0.422, 0.815), vec4(0.547, 0.151, 0.667, 0.815), vec4(0.802, 0.151, 0.927, 0.815), vec4(-1.0), vec4(-1.0),
  // plex_1
  vec4(0.24, 0.22, 0.484, 0.86), vec4(0.594, 0.22, 0.839, 0.86), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // plex_2
  vec4(0.185, 0.318, 0.466, 0.878), vec4(0.557, 0.318, 0.836, 0.878), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // plex_3
  vec4(0.344, 0.24, 0.93, 0.89), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0),
  // plex_4
  vec4(0.294, 0.22, 0.607, 0.81), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0), vec4(-1.0));

/**
 * The traced opening nearest a wall point, laid out exactly as the photographed panel the
 * facade would pick for this building (same panel, repeat size and mirroring). u: metres
 * along the wall; vb: metres above the first upper storey line. Returns the opening's half
 * size, the point relative to its centre (along the wall, up), how high its foot stands
 * above its storey line, and the storey height.
 */
bool mtlTracedOpening(float u, float vb, float W, float body, int style, float h1, float h3,
    out vec2 halfSize, out vec2 local, out float sillH, out float storeyH) {
  int layer = style * 4 + int(min(3.0, floor(h3 * 4.0)));
  vec4 shape = MTL_TRACED_SHAPE[layer];
  float bays = max(1.0, floor(W / shape.z + 0.5)), storeys = max(1.0, floor(body / shape.w + 0.5));
  float tw = W / bays * shape.x, th = body / storeys * shape.y;
  float col = floor(u / tw);
  float fx = fract(u / tw), fy = fract(vb / th);
  bool mirrored = mod(col + floor(h1 * 5.0), 2.0) > 0.5;
  if (mirrored) fx = 1.0 - fx;
  vec2 at = vec2(fx * tw, fy * th);
  float best = 1e9; vec4 o = vec4(-1.0);
  for (int i = 0; i < 6; i++) {
    vec4 r = MTL_TRACED[layer * 6 + i];
    if (r.x < 0.0) break;
    vec2 d = abs(at - vec2(r.x + r.z, r.y + r.w) * 0.5 * vec2(tw, th)) - vec2(r.z - r.x, r.w - r.y) * 0.5 * vec2(tw, th);
    float dist = max(d.x, d.y);
    if (dist < best) { best = dist; o = r; }
  }
  if (o.x < 0.0) return false;
  halfSize = vec2(o.z - o.x, o.w - o.y) * 0.5 * vec2(tw, th);
  local = at - vec2(o.x + o.z, o.y + o.w) * 0.5 * vec2(tw, th);
  if (mirrored) local.x = -local.x;
  storeyH = th / shape.y;
  sillH = mod(o.y * th, storeyH);
  return true;
}
`;
