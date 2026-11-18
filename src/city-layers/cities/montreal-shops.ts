/** Integer hash shared bit for bit with `shopHash` in src/montreal/shopfronts.ts. */
export const MONTREAL_SHOP_HASH = /* glsl */`
uint mtlMix32(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; return x ^ (x >> 16u); }
float mtlShopHash(uint seed, uint wallCm, uint bay, uint salt) {
  uint h = mtlMix32((seed * 73856093u) ^ mtlMix32(wallCm + bay * 19349663u) ^ (salt * 83492791u));
  return float(h >> 8u) / 16777216.0;
}
`;

/**
 * A Montréal shopfront between stone piers: a painted fascia with the trade,
 * a glazed front on a stall riser with a transom over it, a recessed door to
 * one side, and behind the glass a room drawn by interior mapping whose fit-out
 * follows the trade on the fascia: shelves of stock, a café, a white gallery or
 * a shop counter. After dark a shop is lit, dark, or behind a roller shutter;
 * the same integer hash (`mtlShopHash`, see src/montreal/shopfronts.ts) decides
 * which lit shops spill light on the footway.
 *
 * Runs inside the wall branch of MONTREAL_FRAGMENT with its locals in scope.
 */
export const MONTREAL_SHOPFRONT = /* glsl */`
      float ns = max(1.0, floor(W / 4.6 + 0.5)), sw = W / ns;
      float su = u / sw, si = clamp(floor(su), 0.0, ns - 1.0), sx = u - (si + 0.5) * sw;
      vec2 shop = vec2(si, 77.0) + bcSeed * vec2(57.0, 13.0);
      float s1 = bcHash(shop);
      uint sSeed = uint(bcSeed * 255.0 + 0.5), sWall = uint(W * 100.0 + 0.5), sBay = uint(si);
      float sState = mtlShopHash(sSeed, sWall, sBay, 1u), sWarm = mtlShopHash(sSeed, sWall, sBay, 2u);
      float sA = mtlShopHash(sSeed, sWall, sBay, 3u), sB = mtlShopHash(sSeed, sWall, sBay, 4u), sC = mtlShopHash(sSeed, sWall, sBay, 5u);
      float k = floor(s1 * 24.0);
      // Trade on the fascia decides the fit-out: 0 shelves, 1 café, 2 gallery or boutique, 3 counter.
      float cat = (k == 1.0 || k == 13.0 || k == 22.0) ? 1.0
        : (k == 14.0 || k == 15.0 || k == 20.0 || k == 21.0 || k == 8.0) ? 2.0
        : (k == 0.0 || k == 10.0 || k == 11.0 || k == 12.0 || k == 16.0) ? 3.0 : 0.0;
      float shut = step(mix(0.9, 0.8, uBcNight), sState);
      float lightsOn = mix(1.0, step(sState, 0.58), uBcNight);
      float boardLow = G - 0.72, boardHigh = G - 0.16;
      float halfW = sw * 0.5, pier = 0.24, inner = halfW - pier;
      float riser = 0.48 + 0.14 * sB, transom = min(boardLow - 0.42, 2.6);
      float doorSide = sA < 0.5 ? -1.0 : 1.0, doorW = 1.02, doorX = doorSide * (inner - doorW * 0.5 - 0.1);
      bool hasDoor = inner > 1.35;
      vec3 frameCol = sB < 0.22 ? vec3(0.018, 0.02, 0.02) : sB < 0.4 ? vec3(0.03, 0.06, 0.045) : sB < 0.55 ? vec3(0.09, 0.025, 0.022)
        : sB < 0.7 ? vec3(0.025, 0.035, 0.065) : sB < 0.86 ? vec3(0.13, 0.075, 0.04) : vec3(0.5, 0.47, 0.39);
      vec3 shopLamp = k == 5.0 || k == 4.0 ? vec3(0.95, 0.98, 1.0) : mix(vec3(1.0, 0.93, 0.84), vec3(1.0, 0.74, 0.47), sWarm);
      // stone pier
      float front = bcBox(vec2(sx, 0.0), vec2(inner, 99.0), px) * (1.0 - step(boardLow, streetV));
      col = mix(col, col * 0.86, bcLine(abs(sx) - inner - 0.04, 0.02, px));
      // the fascia, its cornice and the shade it throws
      float board = bcBox(vec2(sx, streetV - (boardLow + boardHigh) * 0.5), vec2(halfW - 0.18, (boardHigh - boardLow) * 0.5), px);
      vec2 signUv = clamp(vec2(sx / (sw - 0.36) + 0.5, 1.0 - (streetV - boardLow) / (boardHigh - boardLow)), vec2(0.03), vec2(0.97));
      vec3 sign = texture2D(tBcSign, (vec2(mod(k, 4.0), floor(k / 4.0)) + signUv) / vec2(4.0, 8.0)).rgb;
      float moulding = bcBox(vec2(sx, streetV - boardHigh - 0.07), vec2(halfW - 0.1, 0.07), px);
      col = mix(col, wall * 1.18, moulding);
      if (front > 0.0) {
        vec2 pg = vec2(sx, streetV);
        // where the eye ray goes through the shop: the room behind the glass
        float roomH = max(boardLow + 0.4, 3.0), depthR = 4.2 + 3.0 * sC;
        vec3 paint = k == 5.0 ? vec3(0.8, 0.81, 0.8) : cat == 2.0 ? vec3(0.7, 0.69, 0.66) : cat == 1.0 ? mix(vec3(0.42, 0.25, 0.14), vec3(0.55, 0.47, 0.36), sC)
          : sC < 0.5 ? vec3(0.74, 0.72, 0.66) : mix(vec3(0.36, 0.42, 0.36), vec3(0.62, 0.52, 0.42), sA);
        vec3 inside = paint * 0.35; float fixture = 0.0;
        if (!distant) {
          vec4 hit = bcRoom(vec2(sx, streetV - roomH * 0.5), ray, vec2(inner * 2.0 + 0.6, roomH), depthR);
          vec3 at = vec3(hit.x, hit.y + roomH * 0.5, hit.z);
          if (hit.w == 2.0) {
            // ceiling and its downlights or tubes
            vec2 lampCell = fract(vec2(at.x / 1.2 + 0.5, at.z / 1.3)) - 0.5;
            fixture = cat == 0.0 || cat == 3.0 ? step(abs(lampCell.x), 0.07) * step(abs(lampCell.y), 0.3)
              : 1.0 - smoothstep(0.08, 0.13, length(lampCell * vec2(1.2, 1.3)));
            inside = vec3(0.82, 0.8, 0.76) * 0.8;
          } else if (hit.w == 3.0) {
            vec2 tile = at.xz / (cat == 3.0 ? 0.3 : 0.6);
            float check = cat == 3.0 ? mod(floor(tile.x) + floor(tile.y), 2.0) : step(0.5, fract(at.x / 0.16 + bcHash(vec2(floor(at.x / 0.16), 3.0)) * at.z * 0.2));
            inside = (cat == 3.0 ? mix(vec3(0.62, 0.6, 0.56), vec3(0.08), check) : cat == 1.0 ? vec3(0.3, 0.17, 0.09) * (0.85 + 0.3 * check) : vec3(0.36, 0.34, 0.31) * (0.9 + 0.2 * check));
            // stock and furniture standing on the floor darken it
            inside *= 0.65 + 0.35 * smoothstep(0.3, 1.2, min(inner - abs(at.x), depthR - at.z));
          } else {
            vec2 face = hit.w == 0.0 ? at.xy : vec2(at.z, at.y);
            inside = paint;
            if (cat == 0.0 || (cat == 3.0 && at.y > 1.35)) {
              // shelving: uprights every 0.9 m, boards every 0.38 m, stock of uneven width and height on them
              float bayIndex = floor(face.x / 0.9), bayAt = fract(face.x / 0.9);
              float row = floor(face.y / 0.38), lift = fract(face.y / 0.38);
              bool books = k == 2.0 || k == 19.0;
              // what is on the shelves follows the trade: books, pharmacy boxes, groceries, hardware, bread
              vec3 stockBase = vec3(0.44, 0.4, 0.35); float stockSat = 0.3, itemScale = 1.0, hueShift = sA;
              if (books) { stockSat = 0.45; }
              else if (k == 5.0) { stockBase = vec3(0.78, 0.78, 0.76); stockSat = 0.22; itemScale = 0.6; hueShift = 0.55; }
              else if (k == 4.0 || k == 9.0 || k == 23.0) { stockSat = 0.6; itemScale = 0.7; }
              else if (k == 6.0) { stockBase = vec3(0.24, 0.24, 0.25); stockSat = 0.35; itemScale = 1.4; }
              else if (k == 0.0 || k == 12.0) { stockBase = vec3(0.55, 0.36, 0.18); stockSat = 0.12; itemScale = 2.0; }
              else if (k == 3.0) { stockBase = vec3(0.16, 0.3, 0.12); stockSat = 0.5; itemScale = 1.5; }
              float itemW = books ? 0.035 + 0.02 * bcHash(vec2(bayIndex, row)) : (0.06 + 0.1 * bcHash(vec2(bayIndex, row) + sC)) * itemScale;
              float slot = floor(face.x / itemW + row * 3.7);
              float stock = bcHash(vec2(slot, row) + sC * 31.0 + hit.w * 3.1);
              float itemH = 0.45 + 0.5 * bcHash(vec2(slot + 7.1, row));
              float gap = step(0.88, bcHash(vec2(slot * 1.7, row + 11.0)));
              vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (stock * 2.0 + hueShift + vec3(0.0, 0.33, 0.67)));
              vec3 goods = mix(stockBase, hue, stockSat) * (0.28 + 0.62 * stock) * (stockBase.r > 0.7 ? 1.4 : 1.0);
              float side_ = fract(face.x / itemW);
              goods *= 0.72 + 0.28 * smoothstep(0.0, 0.2, side_) * smoothstep(1.0, 0.8, side_);
              // far away the items merge into the shelf's average colour instead of shimmering
              float blur = smoothstep(itemW * 0.4, itemW * 1.6, fwidth(face.x));
              goods = mix(goods, vec3(0.3, 0.28, 0.25), blur);
              float filled = step(0.07, lift) * step(lift, 0.07 + 0.88 * itemH) * (1.0 - gap);
              filled = mix(filled, 0.6, blur);
              inside = mix(paint * 0.22, goods, filled);
              inside = mix(inside, vec3(0.1, 0.085, 0.07), step(lift, 0.06));
              // the board above shades the top of each row
              inside *= 1.0 - 0.45 * smoothstep(0.65, 1.0, lift);
              inside = mix(inside, vec3(0.045, 0.04, 0.035), (step(bayAt, 0.03) + step(0.97, bayAt)) * (1.0 - blur));
              inside = mix(inside, paint * 0.6, step(roomH - 0.45, face.y) + step(face.y, 0.18));
              // a dépanneur's or grocer's cold cabinets along one side: glass doors lit from within
              if ((k == 4.0 || k == 9.0 || k == 23.0) && hit.w == 1.0 && face.y < 2.05 && face.y > 0.15 && (at.x > 0.0) == (sB > 0.5)) {
                float door_ = fract(face.x / 0.75);
                float shelfLine = step(0.92, fract(face.y / 0.4));
                vec3 bottles = mix(vec3(0.85, 0.9, 0.95), 0.5 + 0.5 * cos(6.2831853 * (bcHash(vec2(floor(face.x / 0.09), floor(face.y / 0.4))) + vec3(0.0, 0.33, 0.67))), 0.5);
                inside = mix(bottles * 0.8, vec3(0.08), max(shelfLine, step(door_, 0.04) + step(0.96, door_)));
                fixture = max(fixture, 0.28 * (1.0 - shelfLine));
              }
            } else if (cat == 1.0) {
              // café: wainscot, a mirror or menu board, pendant warmth
              float wainscot = step(face.y, 1.05);
              inside = mix(paint, vec3(0.2, 0.11, 0.06) * (0.85 + 0.3 * step(0.5, fract(face.x / 0.5))), wainscot);
              float board_ = bcBox(vec2(fract(face.x / 2.6) - 0.5, face.y - 1.8), vec2(0.32, 0.38), 0.01) * step(hit.w, 0.5);
              inside = mix(inside, vec3(0.05, 0.06, 0.055) + vec3(0.25) * step(0.6, fract(face.y * 9.0)) * step(0.2, fract(face.x * 7.0)) * 0.4, board_);
            } else if (cat == 2.0) {
              // gallery: white walls and framed pieces at eye height, a few per wall
              vec2 hang = vec2(fract(face.x / 1.7) - 0.5, face.y - 1.55);
              float pick = bcHash(vec2(floor(face.x / 1.7), hit.w + sC * 13.0));
              vec2 size = vec2(0.28 + 0.3 * pick, 0.24 + 0.32 * fract(pick * 7.3));
              float piece = bcBox(hang, size, 0.012) * step(0.3, pick);
              // paintings with a little texture of their own, never flat cards
              float strokes = bcNoise(hang * 18.0 + pick * 40.0) * 0.5 + bcNoise(hang * 6.0 + pick * 9.0) * 0.5;
              vec3 art = mix(vec3(0.42, 0.4, 0.36), 0.5 + 0.45 * cos(6.2831853 * (pick * 5.0 + strokes * 0.6 + vec3(0.0, 0.33, 0.67))), 0.6) * (0.7 + 0.5 * strokes);
              vec3 frameTone = k == 15.0 ? vec3(0.55, 0.42, 0.18) : vec3(0.08);
              // a salon hangs mirrors at the stations instead: dark glass with the lit room in it
              if (k == 8.0) { art = vec3(0.1, 0.11, 0.12) + paint * 0.3 * smoothstep(-0.3, 0.3, hang.y); frameTone = vec3(0.75, 0.72, 0.66); }
              float frameEdge = piece * (1.0 - bcBox(hang, size - 0.04, 0.012));
              inside = mix(inside, mix(art, frameTone, frameEdge), piece);
              if (k == 20.0) {
                // an optician's wall: rows of frames on narrow white shelves
                vec2 slotAt = vec2(fract(face.x / 0.32) - 0.5, fract(face.y / 0.26) - 0.5);
                float lens = 1.0 - smoothstep(0.035, 0.05, abs(length(vec2(abs(slotAt.x) - 0.11, slotAt.y * 1.6)) - 0.05));
                float shelf_ = step(abs(slotAt.y + 0.38), 0.05);
                float rows = step(0.9, face.y) * step(face.y, 2.2);
                inside = mix(paint, vec3(0.05), lens * rows * step(0.3, bcHash(floor(face / vec2(0.32, 0.26)))));
                inside = mix(inside, vec3(0.92), shelf_ * rows);
              }
            }
            if (cat == 3.0 && at.y <= 1.35) inside = mix(paint * 0.7, vec3(0.75, 0.74, 0.7), step(0.5, fract(face.y / 0.15 + 0.5 * floor(face.x / 0.15))) * 0.4);
          }
          // a counter across the shop, or café tables, in the middle ground
          float tMid = (cat == 3.0 ? 1.8 : 2.2) / max(ray.z, 0.05);
          vec2 mid = vec2(sx, streetV) + ray.xy * tMid;
          if (tMid < (hit.z + 0.001) / max(ray.z, 0.05)) {
            if (cat == 3.0 && mid.y < 1.05 && abs(mid.x) < inner - 0.35) {
              float glassCase = step(0.62, mid.y);
              // the case: rounds and loaves of the trade's goods on trays, in rows
              vec2 tray = vec2(mid.x / 0.17, (mid.y - 0.62) / 0.14);
              float pick = bcHash(floor(tray) + sC * 5.0);
              float round_ = 1.0 - smoothstep(0.32, 0.45, length(fract(tray) - 0.5) - 0.06 * pick);
              vec3 ware = k == 10.0 ? mix(vec3(0.62, 0.2, 0.18), vec3(0.8, 0.55, 0.5), pick) : k == 11.0 ? mix(vec3(0.85, 0.72, 0.38), vec3(0.92, 0.88, 0.75), pick)
                : k == 16.0 ? mix(vec3(0.18, 0.09, 0.05), vec3(0.45, 0.26, 0.14), pick) : mix(vec3(0.62, 0.38, 0.16), vec3(0.85, 0.66, 0.38), pick);
              vec3 caseCol = mix(vec3(0.75, 0.74, 0.7) * 0.6, ware, round_ * step(0.2, pick));
              inside = mix(vec3(0.42, 0.38, 0.33) * (0.8 + 0.2 * step(0.5, fract(mid.x / 0.6))), caseCol, glassCase);
              fixture = max(fixture, glassCase * 0.35);
            } else if ((k == 7.0 || k == 18.0) && mid.y < 1.9 && mid.y > 0.75 + 0.45 * bcHash(vec2(floor(mid.x / 0.07), 5.0)) && abs(mid.x) < inner - 0.3) {
              // a cleaner's rail of garments under plastic
              float garment = bcHash(vec2(floor(mid.x / 0.07), 2.0));
              inside = mix(vec3(0.75, 0.75, 0.78), 0.5 + 0.45 * cos(6.2831853 * (garment * 3.0 + vec3(0.0, 0.33, 0.67))), 0.35) * (0.5 + 0.5 * garment);
            } else if (cat == 1.0 && mid.y < 0.76 && mid.y > 0.7 && abs(fract(mid.x / 1.4) - 0.5) < 0.3) {
              inside = vec3(0.12, 0.07, 0.04);
            } else if (cat == 1.0 && mid.y > roomH - 0.95 && mid.y < roomH - 0.72) {
              // pendant shades
              float pendant = 1.0 - smoothstep(0.11, 0.14, length(vec2(fract(mid.x / 1.4 + 0.5) - 0.5, (mid.y - roomH + 0.8) * 0.9)));
              inside = mix(inside, vec3(0.95, 0.8, 0.55), pendant); fixture = max(fixture, pendant);
            }
          }
          // window display on the riser: stock and cards close behind the glass
          if (cat != 2.0 && ray.y < -0.02) {
            float tTop = (streetV - riser) / -ray.y;
            vec2 onTop = vec2(sx + ray.x * tTop, tTop * ray.z);
            float tFace = 0.38 / max(ray.z, 0.05);
            vec2 card = vec2(sx, streetV) + ray.xy * tFace;
            float itemH = 0.12 + 0.42 * bcHash(vec2(floor(card.x / 0.28), sC * 7.0));
            if (k == 3.0 && card.y > riser && card.y < riser + 0.9 && abs(card.x) < inner - 0.15) {
              // a florist's window: leaves and blooms banked up behind the glass
              float leaf = bcNoise(card * 14.0 + sC * 9.0), bloom = step(0.78, bcNoise(card * 22.0 + 3.0));
              float top_ = riser + 0.55 + 0.35 * bcNoise(vec2(card.x * 3.0, sA * 7.0));
              if (card.y < top_) inside = mix(vec3(0.07, 0.17, 0.06) * (0.6 + 0.8 * leaf), mix(vec3(0.85, 0.25, 0.35), vec3(0.95, 0.85, 0.4), step(0.5, bcHash(floor(card * 9.0)))), bloom);
            } else if (card.y > riser && card.y < riser + itemH && abs(card.x) < inner - 0.2 && step(0.25, bcHash(vec2(floor(card.x / 0.28), sA * 9.0))) > 0.0) {
              vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (bcHash(vec2(floor(card.x / 0.28), 5.0 + sB)) * 2.0 + vec3(0.0, 0.33, 0.67)));
              inside = mix(vec3(0.6, 0.55, 0.45), hue, k == 3.0 ? 0.9 : 0.45) * (0.55 + 0.45 * bcHash(vec2(floor(card.x / 0.28), 1.0)));
            } else if (onTop.y < 0.7 && streetV > riser) {
              inside = mix(paint * 0.5, vec3(0.5, 0.42, 0.32), 0.5);
            }
          }
          // daylight from the window falls off into the room; a lit room is even
          float depthFade = mix(1.0, 0.32, smoothstep(0.4, 5.5, hit.z));
          inside *= mix(depthFade, 1.0, lightsOn * uBcNight * 0.6);
        }
        // display glass, door, transom and frames
        float doorZone = hasDoor ? bcBox(vec2(sx - doorX, streetV - transom * 0.5), vec2(doorW * 0.5 + 0.05, transom * 0.5), px) : 0.0;
        vec2 qd = pg - viewT * 0.85;   // the door stands back in a vestibule
        float doorLeaf = bcBox(vec2(qd.x - doorX, qd.y - transom * 0.5), vec2(doorW * 0.5, transom * 0.5), px);
        float doorGlass = bcBox(vec2(qd.x - doorX, qd.y - transom * 0.5 - 0.22), vec2(doorW * 0.5 - 0.13, transom * 0.5 - 0.38), px);
        float handle = bcBox(vec2(qd.x - doorX + doorSide * 0.36, qd.y - 1.05), vec2(0.018, 0.16), px);
        float riserPanel = (1.0 - doorZone) * (1.0 - step(riser, streetV));
        float transomBar = bcLine(streetV - transom, 0.05, px);
        float outerFrame = 1.0 - bcBox(vec2(sx, streetV - boardLow * 0.5), vec2(inner - 0.07, boardLow * 0.5 - 0.06), px);
        float mullion = (1.0 - doorZone) * (inner * 2.0 - doorW > 2.4 ? bcLine(sx + doorSide * doorW * 0.5, 0.035, px) : 0.0);
        float transomLights = step(transom, streetV) * bcLine(fract(sx / 0.62) - 0.5, 0.05, px / 0.62);
        float frames = max(max(outerFrame, transomBar), max(mullion, transomLights));
        float glassArea = (1.0 - riserPanel) * (1.0 - frames);
        // inside light: daylight through the glass by day; the shop's own lamps after dark
        float on = lightsOn * (1.0 - shut);
        vec3 emitted = inside * (uBcSunBake * 0.15 + 0.015) + inside * shopLamp * on * mix(0.1, 0.55, uBcNight) + shopLamp * fixture * on * mix(0.3, 1.05, uBcNight);
        // a shop that is closed but not shuttered keeps a night light at the back
        emitted += inside * vec3(0.9, 0.95, 1.0) * 0.06 * uBcNight * (1.0 - lightsOn) * (1.0 - shut);
        vec3 doorCol = mix(frameCol, vec3(0.03), 0.2);
        vec3 vestibule = wall * 0.42 * mix(1.0, 0.7, smoothstep(0.0, 0.8, abs(pg.x - qd.x)));
        float doorGlassArea = doorZone * doorLeaf * doorGlass * (1.0 - handle);
        vec3 shopCol = mix(vec3(0.02), frameCol, frames);
        shopCol = mix(shopCol, mix(frameCol * 1.1, wall * 0.75, step(0.75, sC)) * (0.8 + 0.2 * step(0.5, fract(streetV / 0.16))), riserPanel);
        shopCol = mix(shopCol, mix(vestibule, mix(doorCol, vec3(0.02), doorGlass), doorLeaf), doorZone);
        shopCol = mix(shopCol, vec3(0.55, 0.42, 0.16), handle * doorZone * doorLeaf);
        float paneMask = max(glassArea * (1.0 - doorZone), doorGlassArea);
        // a roller shutter pulled down over the whole front
        float rib = 0.82 + 0.18 * step(0.5, fract(streetV / 0.075)) * (1.0 - min(1.0, px * 18.0));
        vec3 shutterCol = mix(vec3(0.42, 0.43, 0.44), mix(vec3(0.15, 0.2, 0.17), vec3(0.3, 0.3, 0.32), sC), step(0.55, sA)) * rib;
        shutterCol *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.6, streetV)) - 0.1 * bcFbm(vec2(sx * 1.3, streetV * 0.8) + sC * 20.0);
        shopCol = mix(shopCol, shutterCol, shut);
        paneMask *= 1.0 - shut;
        col = mix(col, shopCol, front); bare *= 1.0 - front;
        rough = mix(rough, mix(mix(0.55, 0.05, paneMask), 0.45, shut), front);
        metal = mix(metal, shut * 0.5, front);
        glow = emitted * paneMask * front;
        glassy = paneMask * front;
        glassN = normalize(bcN + T * paneTilt.x * 0.6 + vec3(0.0, paneTilt.y * 0.6, 0.0));
        // the glass is not lit by the sun as a surface: what shows is the room and the reflection
        sunMask *= mix(1.0, 0.25, paneMask * front);
        // shade under the fascia
        sunMask *= 1.0 - 0.6 * front * (1.0 - smoothstep(0.0, 0.45, boardLow - streetV));
      }
      col = mix(col, sign, board); rough = mix(rough, 0.6, board); bare *= 1.0 - board; glassy *= 1.0 - board; glow *= 1.0 - board;
      // the fascia lit from above by its own lamps where the shop is open after dark
      float fasciaLamps = 0.55 + 0.45 * cos(6.2831853 * (sx / max(sw / 3.0, 0.5)));
      glow += sign * board * uBcNight * (0.05 + 0.5 * lightsOn * (1.0 - shut) * fasciaLamps * smoothstep(boardLow, boardHigh, streetV));
      // splash and grime along the foot of the front
      col *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.3, streetV)) * (1.0 - 0.5 * board);
`;
