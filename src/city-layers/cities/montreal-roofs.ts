/** Inferred Montréal roof finishes. Surface detail only: the official silhouette is untouched. */
export const MONTREAL_ROOFS = /* glsl */`
    // Dominant-axis projection also covers steep mansard facets without stretching.
    vec3 an = abs(bcN);
    vec2 r = an.y >= max(an.x, an.z) ? vBcWorld.xz : an.x > an.z ? vBcWorld.zy : vBcWorld.xy;
    float px = max(length(fwidth(r)), 1e-4);
    float grain = bcFbm(r * 2.4 + bcSeed * 20.0);
    bool flatRoof = an.y > 0.94;
    if (flatRoof) {
      // Large weathering and repairs remain legible when sub-metre grain disappears.
      vec2 p = (h1 < 0.5 ? r : r.yx) + vec2(h2, h3) * 41.0;
      float weather = bcFbm(p * 0.075 + bcSeed * 11.0);
      vec3 membrane = mix(vec3(0.062, 0.064, 0.063), vec3(0.155, 0.153, 0.142), h2);
      membrane *= 0.77 + 0.42 * weather + 0.12 * grain;
      // Meter-wide rolls, staggered end laps rather than a uniform checkerboard.
      float roll = floor(p.x / 1.05);
      vec2 seamPos = vec2(p.x / 1.05, (p.y + mod(roll, 2.0) * 3.6) / 7.2);
      float sideLap = bcLine(fract(seamPos.x + 0.5) - 0.5, 0.025 / 1.05, px / 1.05);
      float endLap = bcLine(fract(seamPos.y + 0.5) - 0.5, 0.035 / 7.2, px / 7.2);
      membrane *= 0.95 + 0.10 * bcHash(vec2(roll, bcSeed * 19.0));
      membrane *= 1.0 - 0.32 * max(sideLap, endLap);
      vec2 patchCell = floor(p / vec2(4.8, 6.2));
      float patchSeed = bcHash(patchCell + bcSeed * 101.0);
      vec2 patchPoint = mod(p, vec2(4.8, 6.2)) - vec2(2.4, 3.1)
        - (vec2(bcHash(patchCell + 17.0), bcHash(patchCell + 23.0)) - 0.5) * 1.6;
      vec2 patchSize = mix(vec2(0.45, 0.6), vec2(1.35, 2.1), vec2(bcHash(patchCell + 29.0), bcHash(patchCell + 31.0)));
      float repairMask = bcBox(patchPoint, patchSize, px) * step(0.75, patchSeed);
      membrane = mix(membrane, membrane * (patchSeed > 0.9 ? 1.28 : 0.70), repairMask * 0.8);
      // Sparse service covers / ventilation footprints, never extra geometry or measured equipment.
      vec2 serviceCell = floor(p / vec2(11.0, 15.0));
      float serviceSeed = bcHash(serviceCell + bcSeed * 151.0);
      vec2 servicePoint = mod(p, vec2(11.0, 15.0)) - vec2(5.5, 7.5)
        - (vec2(serviceSeed, bcHash(serviceCell + 8.0)) - 0.5) * vec2(3.0, 5.0);
      vec2 serviceSize = bcStyle == 1 || bcStyle == 3 || bcStyle == 4 ? vec2(0.8, 1.3) : vec2(0.42, 0.68);
      float service = bcBox(servicePoint, serviceSize, px) * step(0.52, serviceSeed);
      float flashing = bcBox(servicePoint, serviceSize + 0.13, px) * step(0.52, serviceSeed);
      float grille = bcLine(fract(servicePoint.y / 0.16) - 0.5, 0.15, px / 0.16);
      membrane = mix(membrane, vec3(0.038, 0.039, 0.036), flashing * 0.62);
      vec3 cover = mix(vec3(0.13, 0.145, 0.14), vec3(0.27, 0.275, 0.25), serviceSeed);
      membrane = mix(membrane, cover * (1.0 - 0.35 * grille), service);
      bcAlbedo = membrane; bcRoughness = mix(0.96, 0.7, service); bcMetalness = service * 0.18;
    } else if (bcStyle == 5 || h2 < 0.23) {
      // Weathered copper sheets: subdued patina with taller sheet divisions.
      vec2 sheet = vec2(r.x / 0.62, r.y / 1.8);
      float joint = max(bcLine(fract(sheet.x + 0.5) - 0.5, 0.014 / 0.62, px / 0.62),
        bcLine(fract(sheet.y + 0.5) - 0.5, 0.012 / 1.8, px / 1.8));
      float patina = bcFbm(r * 0.18 + bcSeed * 12.0);
      bcAlbedo = mix(vec3(0.058, 0.125, 0.105), vec3(0.18, 0.285, 0.215), patina) * (0.93 + 0.14 * grain);
      bcAlbedo *= (0.9 + 0.18 * bcHash(floor(sheet) + bcSeed)) * (1.0 - 0.36 * joint);
      bcRoughness = 0.76; bcMetalness = 0.2;
    } else if (h2 < 0.64) {
      // Slate courses and a fine lower lip; broad course variation survives at medium distance.
      float row = floor(r.y / 0.28);
      vec2 cell = vec2(r.x / 0.22 + mod(row, 2.0) * 0.5, r.y / 0.28);
      float joint = max(bcLine(fract(cell.x) - 0.5, 0.014, px / 0.22), bcLine(fract(cell.y) - 0.5, 0.025, px / 0.28));
      float course = bcHash(vec2(floor(row / 4.0), bcSeed * 51.0));
      bcAlbedo = mix(vec3(0.075, 0.085, 0.095), vec3(0.16, 0.175, 0.18), bcHash(floor(cell)));
      bcAlbedo *= (0.86 + 0.25 * course) * (1.0 - joint * 0.4);
      bcRoughness = 0.83;
    } else {
      // Standing-seam sheet metal, restrained zinc/tin tones and occasional cross-laps.
      vec2 sheet = vec2(r.x / 0.48, r.y / 3.2);
      float seam = max(bcLine(fract(sheet.x) - 0.5, 0.021, px / 0.48),
        bcLine(fract(sheet.y + mod(floor(sheet.x), 2.0) * 0.5) - 0.5, 0.012, px / 3.2));
      float weather = bcFbm(r * 0.11 + bcSeed * 7.0);
      bcAlbedo = mix(vec3(0.15, 0.17, 0.17), vec3(0.29, 0.30, 0.28), weather) * (0.94 + 0.12 * grain);
      bcAlbedo *= (0.94 + 0.12 * bcHash(floor(sheet) + bcSeed)) * (1.0 - seam * 0.42);
      bcRoughness = 0.48; bcMetalness = 0.65;
    }
`;
