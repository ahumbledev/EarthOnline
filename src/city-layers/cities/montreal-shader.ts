import { MONTREAL_ROOFS } from './montreal-roofs.ts';
import { MONTREAL_SHOPFRONT } from './montreal-shops.ts';
import { MONTREAL_RELIEF } from './montreal-relief.ts';

/** Montréal appearance only. Geometry, sunlight and photo-panel sampling share layout 2. */
export const MONTREAL_FRAGMENT = /* glsl */`
{
  int bcStyle = int(vBcInfo.x + 0.5);
  float bcSeed = vBcInfo.y, bcFlags = vBcInfo.z;
  bool bcIsWall = mod(bcFlags, 2.0) > 0.5, bcIsRoof = mod(floor(bcFlags * 0.5), 2.0) > 0.5;
  bool bcGrounded = mod(floor(bcFlags * 0.25), 2.0) > 0.5;
  vec3 bcN = normalize(vBcNormal), bcV = normalize(cameraPosition - vBcWorld);
  float h1 = bcHash11(bcSeed * 91.7 + 3.1), h2 = bcHash11(bcSeed * 47.3 + 11.9), h3 = bcHash11(bcSeed * 23.9 + 5.7);
  bool distant = distance(cameraPosition, vBcWorld) > 240.0;
  bcAlbedo = vec3(0.3); bcRoughness = 0.92; bcMetalness = 0.0; bcEmissive = vec3(0.0); bcSunMask = 1.0;
  bcGlass = 0.0; bcGlassNormal = bcN; bcStreet = 0.0;
  if (bcStyle == 8) {
    // Small perpendicular trade plaque: full words across both broad faces.
    vec2 face = max(vBcWall, vec2(0.001)), f = vBcUv;
    float px = max(length(fwidth(f)), 1e-4);
    bcAlbedo = vec3(0.035, 0.03, 0.025); bcRoughness = 0.65;
    if (face.x > 0.35 && face.y > 0.25 && abs(bcN.y) < 0.5) {
      float k = floor(bcHash11(bcSeed * 311.7 + 0.5) * 24.0);
      vec2 at = clamp(vec2(f.x / face.x, 1.0 - f.y / face.y), vec2(0.02), vec2(0.98));
      vec3 board = texture2D(tBcSignTall, (vec2(mod(k, 8.0), floor(k / 8.0)) + at) / vec2(8.0, 4.0)).rgb;
      float frame = 1.0 - bcBox(f - face * 0.5, face * 0.5 - 0.035, px);
      bcAlbedo = mix(board, vec3(0.035), frame); bcStreet = 0.25;
    }
  } else if (bcStyle == 9) {
    // Woven canvas awning, never a luminous or concrete Hong Kong canopy.
    float stripe = step(0.5, fract(vBcUv.x / 0.34 + h2));
    vec3 cloth = h1 < 0.34 ? vec3(0.055, 0.16, 0.105) : h1 < 0.67 ? vec3(0.22, 0.055, 0.04) : vec3(0.075, 0.095, 0.16);
    cloth = mix(cloth, vec3(0.58, 0.54, 0.44), stripe * step(0.45, h3) * 0.85);
    float weave = bcNoise(vBcUv * 90.0) * (1.0 - min(1.0, length(fwidth(vBcUv)) * 60.0));
    bcAlbedo = cloth * (0.94 + 0.12 * weave) * (bcN.y < -0.2 ? 0.6 : 1.0); bcRoughness = 0.98; bcStreet = 0.3;
  } else if (bcStyle >= 10) {
${MONTREAL_RELIEF}
  } else if (bcIsRoof) {
${MONTREAL_ROOFS}
  } else if (bcIsWall && bcStyle < 7) {
    float u = vBcUv.x, v = vBcUv.y, W = vBcWall.x, top = vBcWall.y;
    bool stoneTower = bcStyle == 0 && top > 45.0;
    float px = max(max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(v), dFdy(v)))), 1e-4);
    vec3 T = normalize(vec3(bcN.z, 0.0, -bcN.x) + 1e-5);
    float viewN = max(dot(bcV, bcN), 0.14);
    vec2 viewT = vec2(dot(bcV, T), bcV.y) / viewN;
    vec3 ray = vec3(-dot(bcV, T), -bcV.y, viewN);
    float sunN = dot(uBcSunDir, bcN);
    vec2 sunT = vec2(dot(uBcSunDir, T), uBcSunDir.y) / max(sunN, 0.08);
    vec3 tone = stoneTower ? bcSrgb(vec3(0.76, 0.74, 0.68)) : bcSrgb(BC_WALLS[bcStyle * 6 + int(min(5.0, floor(h1 * 6.0)))]);
    float grain = bcFbm(vec2(u * 0.9 + bcSeed * 37.0, v * 1.3));
    vec3 wall = tone * (0.94 + 0.12 * grain);
    bool brick = bcStyle == 1 || (bcStyle == 2 && h3 > 0.42);
    float wallShade = 1.0, wallJoint = 0.0;
    if (bcStyle == 0 || bcStyle == 1 || bcStyle == 2 || bcStyle == 5) {
      wall = mtlMasonry(vec2(u, v), px, brick, stoneTower, bcSeed, tone, vec3(dot(uBcSunDir, T), uBcSunDir.y, sunN), wallShade, wallJoint);
    }
    float parapet = bcStyle == 4 || bcStyle == 6 ? 0.0 : 0.45;
    bool shopFloor = bcGrounded && (bcStyle == 0 || bcStyle == 1 || bcStyle == 3 || bcStyle == 4);
    float G = shopFloor ? (bcStyle == 4 ? 4.5 : 3.8) : 0.0;
    float streetV = v;
    if (shopFloor) {
      float shops = max(1.0, floor(W / 4.6 + 0.5)), shopWidth = W / shops;
      float shopIndex = clamp(floor(u / shopWidth), 0.0, shops - 1.0);
      float centreU = (shopIndex + 0.5) * shopWidth;
      vec2 centreXZ = vBcWorld.xz + T.xz * (centreU - u);
      float bayGround = bcTerrainHeight(centreXZ, vBcWorld.y - v);
      streetV = vBcWorld.y - bayGround;
      // Official fronts can split at the first-floor cornice below the full G height.
      // Keep usable shop windows while rejecting low retaining-wall slivers.
      shopFloor = vBcWorld.y - v + top >= bayGround + 2.6;
    }
    // weathering in layers: broad mottling, soot washed down from the cornice in runs,
    // a grimy band along the street and splash at the foot, a slightly different tone per storey
    float old = mix(0.3, 1.0, h2);
    float big = bcFbm(vec2(u * 0.11 + bcSeed * 37.0, v * 0.08));
    float runs = bcFbm(vec2(u * 1.9 + bcSeed * 11.0, v * 0.055));
    float weather = (0.92 + 0.16 * big) * (1.0 - 0.32 * old * smoothstep(top - 7.0, top - 0.3, v) * smoothstep(0.36, 0.78, runs));
    weather *= 1.0 - 0.1 * old * (1.0 - smoothstep(0.0, 3.2, streetV)) - 0.16 * (1.0 - smoothstep(0.0, 0.5, streetV));
    vec3 weatherTint = mix(vec3(1.0), vec3(1.02, 0.99, 0.93), 0.6 * (1.0 - weather));
    wall *= weather * weatherTint;
    float bare = 1.0;
    float body = max(top - G - parapet, 1.0);
    float nf = max(1.0, floor(body / BC_FLOOR[bcStyle] + 0.5)), fh = body / nf;
    float fv = (v - G) / fh, fi = floor(fv), fy = fract(fv) * fh;
    float nb = max(1.0, floor(W / BC_BAY[bcStyle] + 0.4)), bw = W / nb;
    float bu = u / bw, bi = floor(bu), bx = (fract(bu) - 0.5) * bw;
    vec2 cell = vec2(bi, fi) + bcSeed * vec2(113.0, 71.0);
    float w1 = bcHash(cell), w2 = bcHash(cell + 7.7), w3 = bcHash(cell + 19.3);
    vec3 col = wall; float rough = 0.9, metal = 0.0; vec3 glow = vec3(0.0); float sunMask = 1.0, glassy = 0.0; vec3 glassN = bcN;
    bool upper = streetV > G && v < top - parapet;
    if (bcGrounded) bcStreet = 0.4 * exp(-max(streetV, 0.0) / 8.0);
    vec2 paneTilt = (vec2(bcHash(cell + 41.0), bcHash(cell + 53.0)) - 0.5) * 0.025;
    bool office = stoneTower || bcStyle == 3 || bcStyle == 4;
    vec3 lamp = office ? vec3(1.0, 0.88, 0.70) : vec3(1.0, 0.62 + 0.16 * w3, 0.32 + 0.17 * w3);
    int panelCount = int(uBcStylePanels[bcStyle].y + 0.5);
    if (upper && !stoneTower && bcStyle != 6 && panelCount > 0 && W > 1.7) {
      float layer = uBcStylePanels[bcStyle].x + min(float(panelCount) - 1.0, floor(h3 * float(panelCount)));
      vec4 shape = uBcPanel[int(layer + 0.5)];
      float bays = max(1.0, floor(W / shape.z + 0.5)), storeys = max(1.0, floor(body / shape.w + 0.5));
      vec2 at = vec2(u / (W / bays) / shape.x, (v - G) / (body / storeys) / shape.y);
      // mirror every other repeat: the photograph runs on without a seam and repeats half as often
      float mirrored = mod(floor(at.x) + floor(h1 * 5.0), 2.0);
      float photoX = mirrored > 0.5 ? 1.0 - fract(at.x) : fract(at.x);
      vec4 photo = textureGrad(tBcPanel, vec3(photoX, 1.0 - fract(at.y), layer), vec2(dFdx(at.x), -dFdx(at.y)), vec2(dFdy(at.x), -dFdy(at.y)));
      vec2 window = floor(at * shape.xy) + bcSeed * vec2(113.0, 71.0);
      vec3 front = photo.rgb * mix(1.15, 1.0, photo.a) * (0.94 + 0.12 * grain);
      front = mix(front, front * tone / max(dot(tone, vec3(0.333)), 0.05), 0.12 * (1.0 - photo.a));
      front *= mix(mix(1.0, weather, 0.6), 1.0, photo.a);
      col = front; rough = mix(0.88, 0.13, photo.a); bare = 0.0;
      float occupancy = office ? bcHash(vec2(floor(window.x / 3.0), window.y)) : bcHash(window);
      float lit = step(1.0 - BC_OCCUPIED[bcStyle], occupancy) * uBcNight;
      // a lit window shows a room: its ceiling and lamp, papered walls, a floor, and a curtain or blind
      vec3 roomLight = vec3(0.0);
      if (lit > 0.0) {
        vec2 cellXY = at * shape.xy, cellSize = vec2(W / (bays * shape.x), body / (storeys * shape.y));
        vec2 local = (fract(cellXY) - 0.5) * cellSize;
        float r1 = bcHash(window + 3.7), r2 = bcHash(window + 9.1), r3 = bcHash(window + 15.3);
        vec3 paper = r1 < 0.4 ? vec3(0.78, 0.7, 0.56) : r1 < 0.7 ? vec3(0.62, 0.64, 0.6) : r1 < 0.85 ? vec3(0.72, 0.5, 0.38) : vec3(0.5, 0.56, 0.62);
        vec3 inside = paper * 0.55;
        if (!distant) {
          vec4 hit = bcRoom(local, ray, vec2(cellSize.x * 1.8, cellSize.y * 0.96), 3.0 + 2.5 * r3);
          vec3 at3 = vec3(hit.x, hit.y + cellSize.y * 0.48, hit.z);
          float lampGlow = exp(-dot(vec2(hit.x, hit.z - 1.8), vec2(hit.x, hit.z - 1.8)) * 0.6);
          inside = hit.w == 2.0 ? vec3(0.92, 0.88, 0.8) * (0.45 + 1.2 * lampGlow)
            : hit.w == 3.0 ? mix(vec3(0.24, 0.15, 0.09), vec3(0.42, 0.36, 0.3), step(0.6, r2)) * 0.7
            : paper * (hit.w == 0.0 ? 0.8 : 0.62);
          // a picture or a shelf on the back wall, furniture in the lower part of the room
          float picture = bcBox(vec2(hit.x - (r2 - 0.5) * 0.8, at3.y - 1.6), vec2(0.28, 0.2), 0.01) * step(hit.w, 0.5) * step(0.45, r3);
          inside = mix(inside, vec3(0.25, 0.2, 0.16) + 0.3 * vec3(r1, r2, r3), picture);
          float furniture = step(at3.y, 0.85) * step(hit.w, 1.5) * step(0.35, fract(hit.x * 0.6 + r1));
          inside = mix(inside, inside * 0.35, furniture);
          inside *= 0.55 + 0.45 * smoothstep(-0.2, 1.8, at3.y);
        }
        // curtains drawn in from the sides, or a blind let down, lit from behind
        float kind = r2;
        vec2 q = local - viewT * 0.18;
        float halfW = cellSize.x * 0.5;
        float edge = kind < 0.55 ? halfW - abs(q.x) - halfW * (0.15 + 0.6 * r3) : q.y - cellSize.y * (0.42 - 0.7 * r3);
        float drawn = kind < 0.15 ? 0.0 : 1.0 - smoothstep(-0.02, 0.02, -edge);
        vec3 cloth = (kind < 0.55 ? mix(vec3(0.85, 0.72, 0.52), vec3(0.75, 0.5, 0.42), r1) : vec3(0.88, 0.85, 0.78)) * (0.75 + 0.25 * sin(q.x * 30.0 + r3 * 9.0) * step(kind, 0.55));
        roomLight = mix(inside, cloth * 0.75, drawn * 0.92);
      }
      glow = lamp * lit * photo.a * roomLight * (office ? 0.75 : 1.0);
      glassy = photo.a * 0.65 * (1.0 - 0.6 * lit);
      glassN = normalize(bcN + T * paneTilt.x + vec3(0.0, paneTilt.y, 0.0));
    } else if (upper && bcStyle == 4) {
      float spandrel = 1.0 - smoothstep(0.8, 0.8 + px, fy);
      float mullion = max(bcLine(abs(bx) - bw * 0.5, 0.035, px), bcLine(fy, 0.045, px));
      col = tone * mix(0.48, 0.8, spandrel); metal = 0.4; rough = mix(0.1, 0.28, spandrel); bare = 0.0;
      float lit = step(1.0 - BC_OCCUPIED[bcStyle], bcHash(vec2(floor(bu / 3.0), fi) + bcSeed * 17.0));
      glow = lamp * lit * uBcNight * (1.0 - spandrel) * 0.4;
      glassy = mix(0.9, 0.4, spandrel) * (1.0 - mullion);
      col = mix(col, vec3(0.08), mullion); glow *= 1.0 - mullion;
    } else if (upper && bcStyle != 6 && W > 1.6) {
      float ww = min(bw - 0.85, stoneTower ? 1.35 : bcStyle == 1 ? 2.1 : bcStyle == 3 ? 2.5 : bcStyle == 5 ? 1.25 : 1.15);
      float wh = min(fh - (stoneTower ? 0.45 : 0.8), stoneTower ? 2.8 : bcStyle == 1 ? 2.25 : bcStyle == 3 ? 1.55 : bcStyle == 5 ? 3.4 : 1.95);
      float sill = stoneTower ? 0.25 : bcStyle == 3 ? 0.8 : 0.65;
      float depth = bcStyle == 0 || bcStyle == 5 ? 0.32 : bcStyle == 1 ? 0.27 : 0.22;
      vec2 half_ = vec2(ww, wh) * 0.5, p = vec2(bx, fy - (sill + wh * 0.5));
      // Without the photographs (low graphics, or before they load) the windows stand where the
      // photographed panel has them, so the map's stone sills and lintels still frame a window.
      if (bcStyle <= 2 && !stoneTower && W > 1.7) {
        vec2 tracedHalf, tracedAt; float tracedSill, tracedStorey;
        if (mtlTracedOpening(u, v - G, W, body, bcStyle, h1, h3, tracedHalf, tracedAt, tracedSill, tracedStorey)) {
          half_ = tracedHalf; p = tracedAt; sill = tracedSill; fh = tracedStorey; bw = tracedHalf.x * 2.0 + 0.9;
          ww = tracedHalf.x * 2.0; wh = tracedHalf.y * 2.0;
        }
      }
      // water off each sill carries soot down the wall below it in a narrowing stain
      float dripY = p.y + half_.y + 0.12;
      float drip = bcBox(vec2(p.x, dripY + 0.7), vec2(half_.x * (0.85 - 0.25 * smoothstep(0.0, -1.4, dripY)), 0.7), px) * smoothstep(0.35, 0.75, bcFbm(vec2(u * 3.1, v * 0.4) + bcSeed));
      col *= 1.0 - 0.3 * old * drip;
      float surround = bcBox(p, half_ + vec2(0.13, 0.11), px);
      float lintel = bcBox(p - vec2(0.0, half_.y + 0.12), vec2(half_.x + 0.2, 0.11), px);
      float stoneSill = bcBox(p + vec2(0.0, half_.y + 0.07), vec2(half_.x + 0.18, 0.07), px);
      // Tall stone shafts use continuous recessed window strips and pale vertical piers.
      if (stoneTower) col = mix(col, wall * 0.56, bcBox(vec2(bx, 0.0), vec2(half_.x + 0.12, 1.0), px));
      else col = mix(col, mix(vec3(0.34, 0.32, 0.28), wall * 1.25, 0.65), max(max(surround, lintel), stoneSill));
      float opening = bcBox(p, half_, px);
      vec2 q = p - viewT * depth;
      float pane = bcBox(q, half_, px) * opening;
      float frame = 1.0 - bcBox(q, half_ - 0.055, px);
      if (bcStyle == 0 || bcStyle == 2) {
        // Double-hung sash with a horizontal meeting rail; some paired casements.
        frame = max(frame, bcLine(q.y, 0.035, px));
        if (h3 > 0.65) frame = max(frame, bcLine(q.x, 0.028, px));
      } else {
        float panes = bcStyle == 1 ? 3.0 : bcStyle == 3 ? 3.0 : 2.0;
        float mx = (fract((q.x + half_.x) / ww * panes + 0.5) - 0.5) * ww / panes;
        frame = max(frame, bcLine(mx, 0.025, px));
        frame = max(frame, bcLine(q.y - half_.y * 0.25, 0.025, px));
      }
      vec3 frameCol = stoneTower ? vec3(0.11, 0.13, 0.12) : h3 < 0.4 ? vec3(0.5, 0.46, 0.37) : h3 < 0.7 ? vec3(0.045, 0.075, 0.06) : vec3(0.055, 0.035, 0.025);
      vec3 inside = vec3(0.16, 0.13, 0.1);
      if (!distant) {
        vec4 room = bcRoom(vec2(q.x, q.y + sill + half_.y - fh * 0.5), ray, vec2(bw, fh - 0.25), 4.0);
        float surface = room.w == 0.0 ? 0.55 : room.w == 2.0 ? 0.9 : room.w == 3.0 ? 0.25 : 0.4;
        inside = vec3(0.62, 0.55, 0.44) * surface;
      }
      float curtain = step(0.58, w2) * (1.0 - smoothstep(-0.03, 0.03, q.x + half_.x * (w3 - 0.3)));
      inside = mix(inside, vec3(0.43, 0.38, 0.3), curtain);
      float occupancy = office ? bcHash(vec2(floor(bi / 3.0), fi) + bcSeed * 13.0) : w1;
      float lit = step(1.0 - BC_OCCUPIED[bcStyle], occupancy) * uBcNight;
      vec3 paneCol = mix(inside * 0.1, frameCol, frame);
      col = mix(col, mix(wall * 0.38, paneCol, pane), opening); bare *= 1.0 - opening;
      rough = mix(rough, mix(0.13, 0.62, frame), pane * opening);
      glow = inside * lamp * lit * (office ? 0.8 : 1.35) * (1.0 - frame) * pane * opening;
      glassy = (1.0 - frame) * pane * opening * mix(0.85, 0.55, curtain);
      glassN = normalize(bcN + T * paneTilt.x + vec3(0.0, paneTilt.y, 0.0));
      float sunIn = sunN > 0.0 ? bcBox(q + sunT * depth, half_, px) : 0.0;
      sunMask *= mix(1.0, mix(0.32, sunIn, pane), opening);
    } else if (shopFloor && streetV >= 0.0 && streetV <= G && W > 2.6) {
${MONTREAL_SHOPFRONT}
    }
    if (bcStyle == 0 || bcStyle == 1 || bcStyle == 2 || bcStyle == 5) {
      float cornice = bcBox(vec2(0.0, v - top + 0.22), vec2(1.0, 0.16), px);
      col = mix(col, wall * 1.25, cornice); glow *= 1.0 - cornice;
    }
    sunMask *= mix(1.0, wallShade, bare);
    if (glassy > 0.001 && !distant) {
      // the street mirrored in the glass; the shared sky reflection keeps a share for what the bake knows of the sky
      // shop glass is large and clean: it mirrors the street opposite more than a sash window does
      float fresnel = (streetV < G ? 0.07 : 0.05) + 0.91 * pow(1.0 - max(dot(bcV, glassN), 0.0), 5.0);
      // an upper window seen from the street is mostly sky and the fronts opposite, its room in shadow
      glow += mtlStreetMirror(bcV, glassN, u, max(streetV, 0.0), bcSeed) * fresnel * glassy * (streetV < G ? 1.0 : 1.7);
      glassy *= 0.35;
    }
    bcAlbedo = col; bcRoughness = rough; bcMetalness = metal; bcEmissive = glow; bcSunMask = sunMask; bcGlass = glassy; bcGlassNormal = glassN;
  }
}
`;
