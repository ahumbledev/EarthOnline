/**
 * Montréal relief pieces: boxes the map package adds to each front and roof by
 * rule (tools/base-city/cities/montreal_relief.py in the map repository).
 * Style ids: 10 dressed limestone (sills, lintels, string courses, cornices,
 * copings, shop piers), 11 painted cast iron (balcony and stair railings,
 * posts, stringers, drain pipes), 12 painted wood (balcony decks, stair
 * treads, plex cornices and brackets, shop fascia cornices), 13 galvanised
 * sheet metal (roof plant, vents, copings), 14 brick (chimneys, corbels).
 * Each face carries its own metres (vBcUv) and size (vBcWall); the building's
 * seed picks one paint or stone for all of its pieces. The baked light texel
 * and the shadow map light them like the wall behind.
 *
 * Runs inside MONTREAL_FRAGMENT with its locals (bcStyle, bcSeed, bcN, bcV,
 * h1..h3, distant) in scope. A game without this branch draws the boxes in
 * the plain fallback grey.
 */
export const MONTREAL_RELIEF = /* glsl */`
    vec2 f = vBcUv, face = max(vBcWall, vec2(0.01));
    float rpx = max(length(fwidth(f)), 1e-4);
    float fine = 1.0 - smoothstep(0.02, 0.12, rpx);        // detail that would shimmer fades with distance
    bool topFace = bcN.y > 0.5, underFace = bcN.y < -0.5;
    float edgeDist = min(min(f.x, face.x - f.x), min(f.y, face.y - f.y));
    float edgeWear = (1.0 - smoothstep(0.0, 0.018, edgeDist)) * fine;
    float grime = bcFbm(vBcWorld.xz * 1.7 + vBcWorld.y * 0.9 + bcSeed * 31.0);
    float above = vBcWorld.y - bcTerrainHeight(vBcWorld.xz, vBcWorld.y - 12.0);
    bcStreet = 0.4 * exp(-max(above, 0.0) / 8.0);
    vec3 col = vec3(0.3); float rough = 0.85, metal = 0.0;
    if (bcStyle == 10) {
      // dressed limestone a shade paler than the walls, blocks about a metre long on long bands
      vec3 stone = bcSrgb(BC_WALLS[int(min(5.0, floor(h1 * 6.0)))]) * vec3(1.1, 1.08, 1.04);
      float along = face.x > face.y ? f.x : f.y;
      float block = floor(along / (0.85 + 0.3 * h2));
      float joint = bcLine(fract(along / (0.85 + 0.3 * h2)) - 0.5, 0.006 / (0.85 + 0.3 * h2), rpx / (0.85 + 0.3 * h2)) * step(1.4, max(face.x, face.y));
      col = stone * (0.95 + 0.1 * bcHash(vec2(block, bcSeed * 17.0)) * fine) * (0.93 + 0.12 * bcNoise(f * 3.1 + bcSeed * 9.0));
      col = mix(col, stone * 0.72, joint * fine * 0.8);
      // soot settles on ledges and is washed down the front in streaks; soffits stay dark
      if (topFace) col *= 0.62 + 0.25 * grime;
      else if (underFace) col *= 0.78;
      else col *= 1.0 - 0.28 * smoothstep(0.45, 0.85, grime) * smoothstep(0.0, face.y, f.y);
      col *= 1.0 - 0.12 * edgeWear;
      rough = 0.82;
    } else if (bcStyle == 11) {
      // cast and wrought iron in the building's one paint: black, bottle green, oxblood or slate
      vec3 paint = h2 < 0.42 ? vec3(0.022, 0.022, 0.024) : h2 < 0.64 ? vec3(0.018, 0.045, 0.03)
        : h2 < 0.82 ? vec3(0.075, 0.026, 0.022) : vec3(0.06, 0.068, 0.078);
      float rust = smoothstep(0.62, 0.82, bcFbm(vBcWorld.xz * 3.7 + vBcWorld.y * 2.3 + 7.0)) * (0.5 + 0.5 * h3);
      col = mix(paint, vec3(0.16, 0.075, 0.035), rust * 0.7);
      col += vec3(0.06) * edgeWear;
      rough = mix(0.42, 0.85, rust); metal = mix(0.35, 0.1, rust);
    } else if (bcStyle == 12) {
      // painted wood: decks and treads in boards, cornices in mouldings, paint worn to grey timber
      float k = fract(h3 * 7.31);
      vec3 paint = k < 0.28 ? vec3(0.4, 0.4, 0.38) : k < 0.48 ? vec3(0.2, 0.125, 0.075) : k < 0.66 ? vec3(0.1, 0.18, 0.13)
        : k < 0.84 ? vec3(0.56, 0.52, 0.44) : vec3(0.2, 0.06, 0.045);
      vec3 timber = vec3(0.33, 0.3, 0.26);
      float peel = smoothstep(0.58, 0.78, bcFbm(f * vec2(2.2, 6.0) + vBcWorld.xz * 0.3 + bcSeed * 23.0)) * fine;
      col = mix(paint, timber, peel * (topFace ? 0.9 : 0.45));
      if (topFace) {
        // boards run along the longer side
        float across = face.x > face.y ? f.y : f.x;
        col *= 1.0 - 0.45 * bcLine(fract(across / 0.14) - 0.5, 0.04, rpx / 0.14) * fine;
        col *= 0.75 + 0.2 * grime;
      } else if (!underFace && face.y > 0.25 && face.x > 1.0) {
        // a cornice front: crown, frieze panels between the brackets, dentils along the foot
        float crown = bcLine(f.y - face.y + 0.06, 0.025, rpx) + bcLine(f.y - face.y + 0.13, 0.012, rpx);
        float panel = bcBox(vec2(fract((f.x - 0.25) / 0.72) - 0.5, f.y - face.y * 0.5) * vec2(0.72, 1.0), vec2(0.26, face.y * 0.22), rpx);
        float dentil = step(f.y, 0.07) * step(0.5, fract(f.x / 0.12));
        col *= 1.0 - 0.35 * crown * fine;
        col = mix(col, col * 0.78, panel * fine);
        col = mix(col, col * 0.6, dentil * fine);
      } else if (underFace) col *= 0.7;
      col *= 1.0 - 0.15 * edgeWear;
      rough = mix(0.7, 0.92, peel);
    } else if (bcStyle == 13) {
      // galvanised sheet: standing seams on the sides, louvres on plant, a fan on the top of the big boxes
      vec3 zinc = mix(vec3(0.44, 0.46, 0.48), vec3(0.6, 0.6, 0.58), h3);
      col = zinc * (0.9 + 0.12 * bcNoise(f * 1.3 + bcSeed * 5.0));
      if (topFace) {
        float fan = bcBox(vec2(length(f - face * 0.5), 0.0), vec2(0.36, 1.0), rpx) * step(1.1, min(face.x, face.y));
        col = mix(col * (0.7 + 0.25 * grime), vec3(0.05), fan * 0.85);
      } else if (!underFace) {
        float seam = bcLine(fract(f.x / 0.61) - 0.5, 0.012, rpx / 0.61);
        float louvre = step(0.25, f.y) * step(f.y, face.y - 0.2) * step(0.7, face.y) * step(0.8, face.x) * (0.5 + 0.5 * sin(f.y * 104.7));
        col *= 1.0 - 0.25 * seam * fine;
        col = mix(col, col * 0.35, louvre * fine * 0.8);
        col *= 1.0 - 0.3 * smoothstep(0.5, 0.9, grime) * (1.0 - f.y / face.y);
      }
      rough = 0.45; metal = 0.55;
    } else {
      // brick stacks and corbels, sooted toward the top
      float shade, joint;
      vec3 brickTone = bcSrgb(mix(vec3(0.5, 0.29, 0.21), vec3(0.62, 0.38, 0.27), h3));
      vec3 sunW = vec3(0.0, uBcSunDir.y, max(dot(uBcSunDir, bcN), 0.0));
      col = topFace ? vec3(0.06) : mtlMasonry(f, rpx, true, false, bcSeed, brickTone, sunW, shade, joint);
      col *= 1.0 - 0.45 * smoothstep(face.y - 0.5, face.y, f.y) * step(0.8, face.y);
      rough = 0.9;
    }
    bcAlbedo = col; bcRoughness = rough; bcMetalness = metal;
`;
