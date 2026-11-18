/** Philadelphia City Hall study. Real municipal outline/holes; independently modelled upper architecture.
 * Vertical reference: City Hall directory (1902), Library of Congress tmp92006609.
 * This is a recognisable architectural approximation, not a surveyed ornamental replica.
 */
import { withHallSurfaceUV } from "./hall-materials.js";

const TAU = Math.PI * 2;
const ringArea = (r) =>
  r.reduce((n, p, i) => {
    const q = r[(i + 1) % r.length];
    return n + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;
const unclose = (r) =>
  r.length > 2 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]
    ? r.slice(0, -1)
    : r;

export function cityHallFrame(source) {
  const ring = unclose(source.polygon);
  let cs = 0,
    sn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz),
      angle = Math.atan2(dz, dx);
    cs += length * Math.cos(4 * angle);
    sn += length * Math.sin(4 * angle);
  }
  const angle = Math.atan2(sn, cs) / 4,
    c = Math.cos(angle),
    s = Math.sin(angle),
    raw = ring.map(([x, z]) => [x * c + z * s, -x * s + z * c]);
  const min = [
      Math.min(...raw.map((p) => p[0])),
      Math.min(...raw.map((p) => p[1])),
    ],
    max = [
      Math.max(...raw.map((p) => p[0])),
      Math.max(...raw.map((p) => p[1])),
    ];
  const u = (min[0] + max[0]) / 2,
    v = (min[1] + max[1]) / 2,
    origin = [u * c - v * s, u * s + v * c];
  return {
    angle,
    width: max[0] - min[0],
    depth: max[1] - min[1],
    origin,
    local: ([x, z]) => [
      (x - origin[0]) * c + (z - origin[1]) * s,
      -(x - origin[0]) * s + (z - origin[1]) * c,
    ],
    point: (x, y, z) => [
      origin[0] + x * c - z * s,
      y,
      origin[1] + x * s + z * c,
    ],
  };
}

export function buildCityHall(walls, details, _center, source) {
  const frame = cityHallFrame(source),
    P = frame.point,
    { width: W, depth: D } = frame;
  walls = withHallSurfaceUV(walls, frame);
  details = withHallSurfaceUV(details, frame);
  const mats = walls.materials;
  for (const [name, base, color] of [
    ["hall-stone", "stone", "#d9d5ca"],
    ["hall-stone-warm", "stone", "#d5d0c3"],
    ["hall-stone-muted", "stone", "#cdc9bf"],
    ["hall-trim", "trim", "#e9e5da"],
    ["hall-roof", "roof", "#35454c"],
    ["hall-copper", "bronze", "#6c978e"],
    ["hall-zinc", "stone", "#a8b4b2"],
    ["hall-dial", "paint", "#c1d4c5"],
    ["hall-window", "glass", "#26312f"],
    ["hall-joint", "stone", "#a39f95"],
  ]) {
    if (!mats[name]) {
      mats[name] = mats[base].clone();
      mats[name].color.set(color);
    }
  }
  mats["hall-window"].roughness = 0.56;
  mats["hall-window"].metalness = 0.08;
  const body = 27.13,
    roofTop = 35.4;
  const box = (batch, material, x, y, z, w, h, d, color) => {
    const q = P(x, y, z);
    batch.box(material, ...q, w, h, d, -frame.angle, color);
  };
  const cylinder = (batch, material, x, y, z, r, h, n = 12, rt = r) => {
    const q = P(x, y, z);
    batch.cylinder(material, ...q, r, h, n, undefined, rt);
  };
  const quad = (batch, material, a, b, c, d, uv, color) =>
    batch.quad(material, P(...a), P(...b), P(...c), P(...d), uv, color);
  const tri = (batch, material, a, b, c, color) =>
    batch.tri(material, P(...a), P(...b), P(...c), undefined, color);
  // Authored masonry and recessed glazed openings. Generic office photographs are deliberately
  // excluded from this landmark: the exterior has principal storeys and mezzanines, not a uniform grid.
  function dressFace(
    a,
    b,
    rows,
    { pilasters = true, portalClearance = false } = {},
  ) {
    const dx = b[0] - a[0],
      dz = b[1] - a[1],
      length = Math.hypot(dx, dz);
    if (length < 1.55) return;
    const tx = dx / length,
      tz = dz / length,
      nx = tz,
      nz = -tx;
    const point = (u, y, depth = 0) => [
      a[0] + tx * u + nx * depth,
      y,
      a[1] + tz * u + nz * depth,
    ];
    const faceBox = (material, u, y, w, h, depth = 0.18, out = 0.1) => {
      const p = P(...point(u, y, out));
      walls.box(material, ...p, w, h, depth, -Math.atan2(dz, dx) - frame.angle);
    };
    const frontRect = (material, u0, y0, u1, y1, depth) =>
      quad(
        walls,
        material,
        point(u1, y0, depth),
        point(u0, y0, depth),
        point(u0, y1, depth),
        point(u1, y1, depth),
      );
    const bays = Math.max(1, Math.round(length / 3.8)),
      bay = length / bays;
    const width = Math.min(1.85, bay * 0.58);
    for (let bayIndex = 0; bayIndex < bays; bayIndex++) {
      const u = (bayIndex + 0.5) * bay;
      for (const row of rows) {
        const [bottom, height, arched] = row,
          r = width / 2,
          spring = bottom + height - (arched ? r : 0);
        if (portalClearance) {
          const clearance = Math.max(
            ...[-r, 0, r].map((d) => {
              const p = point(u + d, 0);
              return opening([p[0], p[2]]);
            }),
          );
          if (bottom < clearance + 0.15) continue;
        }
        // Dark closed glazing lies behind a 20 cm deep stone surround, with visible inner reveals.
        frontRect("hall-window", u - r, bottom, u + r, spring, 0.018);
        faceBox(
          "hall-trim",
          u - r - 0.12,
          bottom,
          0.22,
          spring - bottom,
          0.23,
          0.115,
        );
        faceBox(
          "hall-trim",
          u + r + 0.12,
          bottom,
          0.22,
          spring - bottom,
          0.23,
          0.115,
        );
        faceBox("hall-trim", u, bottom - 0.15, width + 0.6, 0.2, 0.42, 0.08);
        if (arched) {
          for (let j = 0; j < 10; j++) {
            const aa = (j / 10) * Math.PI,
              bb = ((j + 1) / 10) * Math.PI;
            const innerA = point(
              u + Math.cos(aa) * r,
              spring + Math.sin(aa) * r,
              0.02,
            );
            const innerB = point(
              u + Math.cos(bb) * r,
              spring + Math.sin(bb) * r,
              0.02,
            );
            tri(walls, "hall-window", point(u, spring, 0.02), innerB, innerA);
            const rimA = point(
              u + Math.cos(aa) * r,
              spring + Math.sin(aa) * r,
              0.23,
            );
            const rimB = point(
              u + Math.cos(bb) * r,
              spring + Math.sin(bb) * r,
              0.23,
            );
            const outerA = point(
              u + Math.cos(aa) * (r + 0.23),
              spring + Math.sin(aa) * (r + 0.23),
              0.23,
            );
            const outerB = point(
              u + Math.cos(bb) * (r + 0.23),
              spring + Math.sin(bb) * (r + 0.23),
              0.23,
            );
            quad(walls, "hall-trim", rimA, rimB, outerB, outerA);
            quad(walls, "hall-joint", innerA, innerB, rimB, rimA);
          }
          faceBox(
            "hall-trim",
            u,
            bottom + height - 0.05,
            0.3,
            0.45,
            0.35,
            0.14,
          );
        } else {
          faceBox(
            "hall-trim",
            u,
            bottom + height,
            width + 0.5,
            0.25,
            0.3,
            0.12,
          );
          faceBox(
            "hall-trim",
            u,
            bottom + height + 0.25,
            width + 0.8,
            0.12,
            0.42,
            0.08,
          );
        }
        // Pale timber sash and horizontal transom; no blue reflective office curtain wall.
        faceBox(
          "hall-stone",
          u,
          bottom,
          0.065,
          height - (arched ? 0.16 : 0),
          0.06,
          0.055,
        );
        faceBox(
          "hall-stone",
          u,
          bottom + height * 0.55,
          width,
          0.065,
          0.06,
          0.055,
        );
      }
      if (pilasters && bayIndex < bays - 1) {
        const x = (bayIndex + 1) * bay,
          lo = rows[0][0] - 0.35,
          hi = rows.at(-1)[0] + rows.at(-1)[1] + 0.65;
        const p = point(x, 0),
          clearance = portalClearance ? opening([p[0], p[2]]) : 0;
        if (clearance > lo) continue;
        faceBox("hall-trim", x, lo, 0.28, hi - lo, 0.25, 0.1);
        faceBox("hall-trim", x, lo, 0.5, 0.45, 0.4, 0.08);
        faceBox("hall-trim", x, hi - 0.35, 0.55, 0.35, 0.42, 0.08);
      }
    }
  }
  function skinBox(x, y, z, w, h, d) {
    const ring = [
      [x - w / 2, z - d / 2],
      [x + w / 2, z - d / 2],
      [x + w / 2, z + d / 2],
      [x - w / 2, z + d / 2],
    ];
    const count = h > 14 ? 3 : 2,
      step = h / count;
    const rows = Array.from({ length: count }, (_, i) => [
      y + i * step + 1,
      Math.min(3.6, step * 0.63),
      i === count - 1,
    ]);
    for (let i = 0; i < 4; i++) {
      const a = ring[i],
        b = ring[(i + 1) % 4];
      quad(
        walls,
        "hall-stone",
        [b[0], y, b[1]],
        [a[0], y, a[1]],
        [a[0], y + h, a[1]],
        [b[0], y + h, b[1]],
      );
      dressFace(a, b, rows);
    }
    quad(
      walls,
      "hall-roof",
      [x - w / 2, y + h, z - d / 2],
      [x - w / 2, y + h, z + d / 2],
      [x + w / 2, y + h, z + d / 2],
      [x + w / 2, y + h, z - d / 2],
    );
  }
  function frustum(x, y, z, w, d, h, tw, td, material = "hall-roof") {
    const a = [
        [x - w / 2, y, z - d / 2],
        [x + w / 2, y, z - d / 2],
        [x + w / 2, y, z + d / 2],
        [x - w / 2, y, z + d / 2],
      ],
      b = [
        [x - tw / 2, y + h, z - td / 2],
        [x + tw / 2, y + h, z - td / 2],
        [x + tw / 2, y + h, z + td / 2],
        [x - tw / 2, y + h, z + td / 2],
      ];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      quad(walls, material, a[j], a[i], b[i], b[j]);
    }
    quad(walls, material, b[0], b[3], b[2], b[1]);
  }
  function pedestal(x, y, z, w, d) {
    box(walls, "hall-trim", x, y, z, w + 0.9, 0.45, d + 0.9);
    box(walls, "hall-stone", x, y + 0.45, z, w, 0.7, d);
    box(walls, "hall-trim", x, y + 1.15, z, w + 1.3, 0.35, d + 1.3);
  }
  // Source rings include the actual central courtyard and southern lightwells.
  const rings = [
    unclose(source.polygon),
    ...(source.holes || []).map(unclose),
  ].filter((r) => Math.abs(ringArea(r)) > 0.05);
  const localRings = rings.map((r, ri) => {
    const q = r.map(frame.local);
    return ringArea(q) > 0 === (ri === 0) ? q : q.slice().reverse();
  });
  // Cut every wall projection inside the corridors, including short walls perpendicular to the main facade.
  // Choosing the cut axis from each individual edge leaves invisible-collision-free wall slivers in the portal.
  const opening = (p) => {
    const across =
      Math.abs(p[1]) > 12 && Math.abs(p[0]) < 5.65
        ? p[0]
        : Math.abs(p[0]) > 12 && Math.abs(p[1]) < 5.65
          ? p[1]
          : null;
    return across === null
      ? 0
      : 6.15 + Math.sqrt(Math.max(0, 5.65 ** 2 - across ** 2));
  };
  for (let ri = 0; ri < localRings.length; ri++) {
    let ring = localRings[ri];
    if (ringArea(ring) > 0 !== (ri === 0)) ring = ring.slice().reverse();
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        dx = b[0] - a[0],
        dz = b[1] - a[1],
        length = Math.hypot(dx, dz);
      if (length < 0.12) continue;
      const pieces = Math.max(1, Math.ceil(length / 1.8));
      for (let j = 0; j < pieces; j++) {
        const t0 = j / pieces,
          t1 = (j + 1) / pieces,
          p = [a[0] + dx * t0, a[1] + dz * t0],
          q = [a[0] + dx * t1, a[1] + dz * t1],
          loP = opening(p, a, b),
          loQ = opening(q, a, b);
        const U0 = (length * t0) / 12.2,
          U1 = (length * t1) / 12.2;
        const panel = (material, lowP, lowQ, top) =>
          quad(
            walls,
            material,
            [q[0], lowQ, q[1]],
            [p[0], lowP, p[1]],
            [p[0], top, p[1]],
            [q[0], top, q[1]],
            [
              [U1, lowQ / 11.2],
              [U0, lowP / 11.2],
              [U0, top / 11.2],
              [U1, top / 11.2],
            ],
          );
        if (loP === 0 && loQ === 0) {
          // Restrained stone-to-stone colour variation follows basement courses,
          // without baking directional lighting or striping the whole elevation.
          for (let course = 0; course < 8; course++) {
            const index =
                Math.abs(Math.round(p[0] * 1.7 + p[1] * 2.9 + course * 7.3)) %
                11,
              material =
                index === 0
                  ? "hall-stone-muted"
                  : index < 4
                    ? "hall-stone-warm"
                    : "hall-stone";
            panel(material, course * 0.85, course * 0.85, (course + 1) * 0.85);
          }
          panel("hall-stone", 6.8, 6.8, body);
        } else panel("hall-stone", loP, loQ, body);
      }
      dressFace(
        a,
        b,
        [
          [1.15, 3.35, false],
          [7.6, 5.0, true],
          [15.5, 4.5, true],
          [22.6, 2.5, false],
        ],
        { portalClearance: true },
      );
      // Fine rusticated courses belong to the basement, without spanning any portal opening.
      for (let j = 0; j < pieces; j++) {
        const p = [a[0] + (dx * j) / pieces, a[1] + (dz * j) / pieces],
          q = [a[0] + (dx * (j + 1)) / pieces, a[1] + (dz * (j + 1)) / pieces];
        const nx = dz / length,
          nz = -dx / length;
        for (let y = 0.9; y < 6.4; y += 0.85) {
          if (Math.max(opening(p), opening(q)) > y) continue;
          quad(
            details,
            "hall-joint",
            [q[0] + nx * 0.012, y, q[1] + nz * 0.012],
            [p[0] + nx * 0.012, y, p[1] + nz * 0.012],
            [p[0] + nx * 0.012, y + 0.035, p[1] + nz * 0.012],
            [q[0] + nx * 0.012, y + 0.035, q[1] + nz * 0.012],
          );
        }
      }
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        yaw = -Math.atan2(dz, dx) - frame.angle,
        q = P(mid[0], 0, mid[1]);
      for (const [y, h, depth] of [
        [13.8, 0.32, 0.56],
        [21.3, 0.3, 0.5],
        [23.7, 0.35, 0.5],
        [26.4, 0.35, 0.65],
        [27.05, 0.5, 0.85],
      ])
        details.box("hall-trim", q[0], y, q[2], length + 0.1, h, depth, yaw);
      // Individually projecting dentils cast the narrow shadows visible beneath the cornice.
      // Their spacing is geometric and therefore survives a portable GLB export.
      for (let u = 0.45; u < length - 0.25; u += 0.9) {
        const p = P(
          a[0] + (dx * u) / length + (dz / length) * 0.16,
          26.72,
          a[1] + (dz * u) / length - (dx / length) * 0.16,
        );
        details.box("hall-trim", ...p, 0.32, 0.33, 0.52, yaw);
      }
      if (opening(mid, a, b) === 0) {
        details.box("hall-stone", q[0], 0.05, q[2], length, 0.55, 0.38, yaw);
      }
    }
  }
  // A steep slate roof follows the real footprint and enlarges the existing roof voids; no solid roof fills the courtyard.
  const roofRings = localRings.map((ring, ri) => {
    const center = ri
      ? [
          ring.reduce((n, p) => n + p[0], 0) / ring.length,
          ring.reduce((n, p) => n + p[1], 0) / ring.length,
        ]
      : [0, 0];
    const ratio = ri ? 1.085 : 0.955;
    return ring.map((p) => [
      center[0] + (p[0] - center[0]) * ratio,
      center[1] + (p[1] - center[1]) * ratio,
    ]);
  });
  for (let ri = 0; ri < localRings.length; ri++) {
    const a = localRings[ri],
      b = roofRings[ri];
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      quad(
        walls,
        "hall-roof",
        [a[j][0], body + 0.3, a[j][1]],
        [a[i][0], body + 0.3, a[i][1]],
        [b[i][0], roofTop, b[i][1]],
        [b[j][0], roofTop, b[j][1]],
      );
    }
  }
  const toWorld = (r) =>
    r.map(([x, z]) => {
      const p = P(x, 0, z);
      return [p[0], p[2]];
    });
  walls.surface(
    "hall-roof",
    toWorld(roofRings[0]),
    roofRings.slice(1).map(toWorld),
    roofTop,
    4,
  );
  // Pilaster rhythm, projected cornices and dormers make the four elevations legible from the street.
  function wallDressing(side) {
    const horizontal = side % 2 === 0,
      sign = side < 2 ? -1 : 1,
      across = horizontal ? W : D,
      edge = (horizontal ? D : W) / 2 - 8.4;
    const place = (u, y, out = 0) =>
      horizontal ? [u, y, sign * (edge + out)] : [sign * (edge + out), y, u];
    const boxAt = (mat, u, y, w, h, depth, out = 0) => {
      const p = place(u, y, out);
      box(
        details,
        mat,
        ...p,
        horizontal ? w : depth,
        h,
        horizontal ? depth : w,
      );
    };
    for (let u = -across / 2 + 17; u < across / 2 - 14; u += 7.4) {
      if (Math.abs(u) < 13) continue;
      boxAt("hall-trim", u, 3.2, 0.42, 22.5, 0.68, 0.1);
      boxAt("hall-trim", u, 24.8, 0.8, 0.9, 0.85, 0.1);
      const p = place(u, 28.3, -0.7);
      box(
        walls,
        "hall-stone",
        ...p,
        horizontal ? 2.4 : 1.6,
        3.4,
        horizontal ? 1.6 : 2.4,
      );
      const glass = place(u, 28.8, 0.18);
      box(
        details,
        "glass",
        ...glass,
        horizontal ? 1.05 : 0.12,
        2,
        horizontal ? 0.12 : 1.05,
      );
      const top = place(u, 31.5, -0.7);
      frustum(
        top[0],
        top[1],
        top[2],
        horizontal ? 3 : 2,
        horizontal ? 2 : 3,
        1.6,
        horizontal ? 0.45 : 0.6,
        horizontal ? 0.6 : 0.45,
        "hall-trim",
      );
    }
  }
  for (let side = 0; side < 4; side++) wallDressing(side);
  function pavilion(x, z, w, d, top) {
    const stem = top > 55 ? 17 : 10.5,
      cap = body + stem + 1.5;
    skinBox(x, body, z, w, stem, d);
    pedestal(x, body + stem, z, w, d);
    frustum(x, cap, z, w + 1.1, d + 1.1, top - cap - 2.25, w * 0.59, d * 0.59);
    pedestal(x, top - 2.25, z, w * 0.59, d * 0.59);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        cylinder(
          walls,
          "hall-trim",
          x + sx * (w * 0.5 - 0.8),
          36.8,
          z + sz * (d * 0.5 - 0.8),
          0.45,
          5,
          8,
          0.12,
        );
      }
    // Four gabled dormers: actual glass opening in a pale projecting surround.
    for (const side of [0, 1, 2, 3]) {
      const alongX = side % 2 === 0,
        sign = side < 2 ? -1 : 1,
        px = x + (alongX ? 0 : sign * w * 0.43),
        pz = z + (alongX ? sign * d * 0.43 : 0),
        dw = alongX ? 3.2 : 1.4,
        dd = alongX ? 1.4 : 3.2;
      box(walls, "hall-trim", px, cap + 1.65, pz, dw, 4.8, dd);
      box(
        details,
        "glass",
        px + (alongX ? 0 : sign * 0.72),
        cap + 2.35,
        pz + (alongX ? sign * 0.72 : 0),
        alongX ? 1.8 : 0.13,
        3.1,
        alongX ? 0.13 : 1.8,
      );
      frustum(
        px,
        cap + 6.45,
        pz,
        dw + 1,
        dd + 0.5,
        2.3,
        alongX ? 0.2 : 1.3,
        alongX ? 1.3 : 0.2,
        "hall-trim",
      );
    }
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      pavilion(sx * (W / 2 - 11.8), sz * (D / 2 - 12.5), 18.8, 18.8, 49.07);
  pavilion(0, D / 2 - 12.5, 23.5, 20, 61.84);
  pavilion(-W / 2 + 12, 0, 20, 23.5, 61.84);
  pavilion(W / 2 - 12, 0, 20, 23.5, 61.84);
  // Arched portals and tunnel sidewalls are real geometry. Host collision must independently accept their openings.
  const courtyardRing = localRings
    .slice(1)
    .reduce(
      (largest, ring) =>
        Math.abs(ringArea(ring)) > Math.abs(ringArea(largest)) ? ring : largest,
      [],
    );
  function portal(side) {
    const horizontal = side % 2 === 0,
      sign = side < 2 ? -1 : 1,
      edge = (horizontal ? D : W) / 2 - 1;
    const at = (u, y, depth) =>
      horizontal
        ? [u, y, sign * (edge - depth)]
        : [sign * (edge - depth), y, u];
    // Each vault reaches the actual courtyard wall, including its curved north projection.
    // A fixed fraction of the footprint left a visible unroofed gap behind that portal.
    const endDepth = (u) => {
      const across = horizontal ? 0 : 1,
        along = 1 - across,
        hits = [];
      for (let j = 0; j < courtyardRing.length; j++) {
        const a = courtyardRing[j],
          b = courtyardRing[(j + 1) % courtyardRing.length];
        if (
          (a[across] <= u && b[across] > u) ||
          (b[across] <= u && a[across] > u)
        )
          hits.push(
            a[along] +
              ((b[along] - a[along]) * (u - a[across])) /
                (b[across] - a[across]),
          );
      }
      if (!hits.length)
        throw new Error(`City Hall portal ${side} misses courtyard at ${u}`);
      const inner = sign < 0 ? Math.min(...hits) : Math.max(...hits);
      return edge - sign * inner + 0.02;
    };
    const segments = 24,
      r0 = 5.65,
      r1 = 6.5,
      base = 6.15;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI,
        b = ((i + 1) / segments) * Math.PI;
      const p0 = at(Math.cos(a) * r0, base + Math.sin(a) * r0, -0.25),
        p1 = at(Math.cos(b) * r0, base + Math.sin(b) * r0, -0.25),
        q0 = at(Math.cos(a) * r1, base + Math.sin(a) * r1, -0.25),
        q1 = at(Math.cos(b) * r1, base + Math.sin(b) * r1, -0.25);
      quad(details, "hall-trim", p0, p1, q1, q0);
      quad(details, "hall-trim", q0, q1, p1, p0);
      // Radial stone joints and a stepped outer moulding give the entrance a visible depth.
      const gap = 0.006;
      for (const [inner, outer, depth] of [
        [5.65, 5.86, -0.38],
        [6.27, 6.55, -0.46],
      ]) {
        const rA = at(
            Math.cos(a + gap) * inner,
            base + Math.sin(a + gap) * inner,
            depth,
          ),
          rB = at(
            Math.cos(b - gap) * inner,
            base + Math.sin(b - gap) * inner,
            depth,
          ),
          sA = at(
            Math.cos(a + gap) * outer,
            base + Math.sin(a + gap) * outer,
            depth,
          ),
          sB = at(
            Math.cos(b - gap) * outer,
            base + Math.sin(b - gap) * outer,
            depth,
          );
        quad(details, "hall-trim", rA, rB, sB, sA);
        quad(details, "hall-trim", sA, sB, rB, rA);
        const rearA = at(
            Math.cos(a + gap) * outer,
            base + Math.sin(a + gap) * outer,
            -0.25,
          ),
          rearB = at(
            Math.cos(b - gap) * outer,
            base + Math.sin(b - gap) * outer,
            -0.25,
          );
        quad(details, "hall-stone", sA, sB, rearB, rearA);
        quad(details, "hall-stone", rearA, rearB, sB, sA);
      }
      const jointA = at(Math.cos(a) * 5.9, base + Math.sin(a) * 5.9, -0.265),
        jointB = at(
          Math.cos(a + gap) * 5.9,
          base + Math.sin(a + gap) * 5.9,
          -0.265,
        ),
        jointC = at(
          Math.cos(a + gap) * 6.25,
          base + Math.sin(a + gap) * 6.25,
          -0.265,
        ),
        jointD = at(Math.cos(a) * 6.25, base + Math.sin(a) * 6.25, -0.265);
      quad(details, "hall-joint", jointA, jointB, jointC, jointD);
      quad(details, "hall-joint", jointD, jointC, jointB, jointA);
      const inside0 = at(
          Math.cos(a) * r0,
          base + Math.sin(a) * r0,
          endDepth(Math.cos(a) * r0),
        ),
        inside1 = at(
          Math.cos(b) * r0,
          base + Math.sin(b) * r0,
          endDepth(Math.cos(b) * r0),
        );
      quad(walls, "hall-stone", inside0, inside1, p1, p0);
      quad(walls, "hall-stone", p0, p1, inside1, inside0);
    }
    for (const s of [-1, 1]) {
      const depth = endDepth(s * 6.1),
        p = at(s * 6.1, 0, depth / 2);
      box(
        walls,
        "hall-stone",
        ...p,
        horizontal ? 0.9 : depth,
        6.15,
        horizontal ? depth : 0.9,
      );
      const column = at(s * 7.05, 0.5, -0.4);
      cylinder(details, "hall-trim", ...column, 0.48, 5.2, 16, 0.42);
      for (const [bottom, radius, height] of [
        [0.08, 0.72, 0.42],
        [5.7, 0.67, 0.45],
      ]) {
        const point = at(s * 7.05, bottom, -0.4);
        cylinder(details, "hall-trim", ...point, radius, height, 16);
      }
    }
  }
  for (let side = 0; side < 4; side++) portal(side);
  // North tower. The measured 548 ft total and 361 ft clock centre supersede municipal average-body height.
  const tz = -D / 2 + 15.5;
  // r003 silhouette study from the attributed Oleg Yunakov tower photograph.
  // Curved metal shoulders, arched cornices and louvres are authored geometry;
  // their profiles are visual approximations, not ornamental survey data.
  const roundedTowerRing = (half, radius) => {
    const ring = [];
    for (let corner = 0; corner < 4; corner++) {
      const cx = [1, -1, -1, 1][corner] * (half - radius),
        cz = [1, 1, -1, -1][corner] * (half - radius);
      for (let step = 0; step <= 12; step++) {
        const angle = (corner + step / 12) * Math.PI / 2;
        ring.push([cx + Math.cos(angle) * radius, tz + cz + Math.sin(angle) * radius]);
      }
    }
    return ring;
  };
  const towerLoft = (material, sections, cap = false) => {
    const rings = sections.map(([y, half, radius]) =>
      roundedTowerRing(half, radius).map(([x, z]) => [x, y, z]),
    );
    for (let j = 1; j < rings.length; j++)
      for (let i = 0; i < rings[j].length; i++) {
        const next = (i + 1) % rings[j].length;
        quad(walls, material, rings[j - 1][next], rings[j - 1][i], rings[j][i], rings[j][next]);
      }
    if (cap) {
      const top = rings.at(-1);
      for (let i = 0; i < top.length; i++)
        tri(walls, material, [0, sections.at(-1)[0], tz], top[(i + 1) % top.length], top[i]);
    }
  };
  // One face template is rotated around the tower four times. Local components
  // are [across, height, outward distance from the tower centre].
  const towerFace = (side) => {
    const nx = [0, -1, 0, 1][side], nz = [-1, 0, 1, 0][side];
    const at = ([u, y, out]) => [-nz * u + nx * out, y, tz + nx * u + nz * out];
    const patch = (material, vertices, outward = [0, 0, 1]) => {
      const [a, b, c, d] = vertices;
      const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      // This face basis has negative determinant; reverse positive local normals.
      const order = cross.reduce((sum, v, i) => sum + v * outward[i], 0) > 0 ? [a, d, c, b] : [a, b, c, d];
      quad(walls, material, ...order.map(at));
    };
    const solid = (material, front, back, { start = true, end = true } = {}) => {
      const vertices = [...front, ...back], center = [0, 0, 0];
      for (const p of vertices) for (let i = 0; i < 3; i++) center[i] += p[i] / 8;
      const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7]];
      if (start) faces.push([0, 3, 7, 4]);
      if (end) faces.push([1, 5, 6, 2]);
      for (const face of faces) {
        const corners = face.map((i) => vertices[i]);
        const outward = center.map((v, axis) => corners.reduce((sum, p) => sum + p[axis] / 4, 0) - v);
        patch(material, corners, outward);
      }
    };
    const ribbon = (material, path, height, back, front) => {
      for (let i = 1; i < path.length; i++) {
        const [a, b] = [path[i - 1], path[i]];
        const face = [[a[0], a[1], front], [b[0], b[1], front], [b[0], b[1] + height, front], [a[0], a[1] + height, front]];
        // Adjacent sweep sections share a cross-section. Closing every segment
        // emitted internal caps, including coincident faces at scroll reversals.
        solid(material, face, face.map(([u, y]) => [u, y, typeof back === "function" ? back(u) : back]), {
          start: i === 1,
          end: i === path.length - 1,
        });
      }
    };
    return { at, patch, solid, ribbon };
  };
  function clockShoulders(side) {
    const { patch, solid, ribbon } = towerFace(side);
    const curve = (u) => 118.6 + 2.25 * (1 - (u / 6.9) ** 2);
    const arch = Array.from({ length: 33 }, (_, i) => {
      const u = -6.9 + i * 13.8 / 32;
      return [u, curve(u)];
    });
    // The curved tympanum rises above the perimeter cornice. Its outline and
    // three projecting lips remain legible at an oblique skyline view.
    for (let i = 1; i < arch.length; i++) {
      const [a, b] = [arch[i - 1], arch[i]];
      patch("hall-zinc", [[a[0], 118.04, 9.94], [b[0], 118.04, 9.94], [b[0], b[1] - 0.32, 9.94], [a[0], a[1] - 0.32, 9.94]]);
    }
    ribbon("hall-trim", arch.map(([u, y]) => [u, y - 0.36]), 0.2, 9.9, 10.5);
    ribbon("hall-zinc", arch, 0.31, 9.9, 10.74);
    ribbon("hall-trim", arch.map(([u, y]) => [u, y + 0.31]), 0.17, 9.9, 10.88);
    for (const sign of [-1, 1]) {
      const u = sign * 6.4;
      for (const [y, width, height, front] of [[116.65, 1.9, 0.38, 10.45], [117.03, 2.15, 0.48, 10.65]]) {
        const face = [[u - width / 2, y, front], [u + width / 2, y, front], [u + width / 2, y + height, front], [u - width / 2, y + height, front]];
        solid("hall-trim", face, face.map(([x, h]) => [x, h, 9.8]));
      }
      // Restrained rolled shoulder at the dial's lower flank, rather than an
      // invented sculptural figure. The slight extrusion creates real relief.
      const scroll = Array.from({ length: 25 }, (_, i) => {
        const a = -Math.PI * 0.15 + i * Math.PI * 1.45 / 24;
        const radius = 0.95 - i * 0.45 / 24;
        return [sign * (8.1 + Math.cos(a) * radius), 105.2 + Math.sin(a) * radius];
      });
      const shoulderDepth = (u) => 7.2 + Math.sqrt(Math.max(0, 2.7 ** 2 - Math.max(0, Math.abs(u) - 7.2) ** 2)) - 0.015;
      ribbon("hall-trim", scroll, 0.14, shoulderDepth, 10.03);
    }
  }
  const taperProfile = [[118.75, 8.85, 2.2], [120.03, 8.85, 2.2], [122.0, 8.4, 2.0], [127.0, 7.2, 1.7], [134.0, 5.75, 1.3], [140.63, 4.3, 1.0]];
  const taper = (y) => {
    const i = Math.max(1, taperProfile.findIndex((p) => p[0] >= y));
    const a = taperProfile[i - 1], b = taperProfile[i], t = (y - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  };
  function louverFace(side) {
    const { patch, solid } = towerFace(side);
    const field = (y) => {
      const [half, radius] = taper(y);
      return { half: half - radius - 0.66, depth: half + 0.045 };
    };
    const levels = [122.3, 127, 134, 139.6];
    for (let i = 1; i < levels.length; i++) {
      const y0 = levels[i - 1], y1 = levels[i], a = field(y0), b = field(y1);
      patch("hall-window", [[-a.half, y0, a.depth], [a.half, y0, a.depth], [b.half, y1, b.depth], [-b.half, y1, b.depth]]);
      for (const sign of [-1, 1]) {
        const u0 = sign * (a.half + 0.29), u1 = sign * (b.half + 0.29);
        const face = [[u0 - 0.22, y0, a.depth + 0.24], [u0 + 0.22, y0, a.depth + 0.24], [u1 + 0.22, y1, b.depth + 0.24], [u1 - 0.22, y1, b.depth + 0.24]];
        solid("hall-trim", face, face.map(([u, y, d]) => [u, y, d - 0.28]));
      }
    }
    // Each blade slopes out/down from the dark recess and has closed ends and
    // thickness. Horizontal openings narrow continuously with the tower taper.
    for (let row = 0; row < 21; row++) {
      const y = 122.55 + row * 0.8, a = field(y), b = field(y + 0.32);
      const face = [[-a.half, y, a.depth + 0.36], [a.half, y, a.depth + 0.36], [b.half, y + 0.32, b.depth + 0.055], [-b.half, y + 0.32, b.depth + 0.055]];
      solid("hall-zinc", face, face.map(([u, h, d]) => [u, h - 0.055, d - 0.035]));
    }
    // Small arched belfry opening below the circular observation gallery.
    const depth = 4.24, spring = 146.5, radius = 1.12;
    patch("hall-window", [[-radius, 143.2, depth], [radius, 143.2, depth], [radius, spring, depth], [-radius, spring, depth]]);
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 24, b = (i + 1) * Math.PI / 24;
      const p = (r, angle, d = depth) => [Math.cos(angle) * r, spring + Math.sin(angle) * r, d];
      const innerA = p(radius, a), innerB = p(radius, b);
      // A thin quadrilateral has two distinct lower vertices even at the arch
      // spring, avoiding zero-area triangles in the exported normal stream.
      const lowerA = [innerA[0], spring - 0.01, depth], lowerB = [innerB[0], spring - 0.01, depth];
      patch("hall-window", [lowerB, lowerA, innerA, innerB]);
      const face = [p(radius, a, depth + 0.12), p(radius, b, depth + 0.12), p(radius + 0.25, b, depth + 0.12), p(radius + 0.25, a, depth + 0.12)];
      solid("hall-trim", face, face.map(([u, y]) => [u, y, depth - 0.07]));
    }
    for (const sign of [-1, 1]) {
      const u = sign * (radius + 0.125), face = [[u - 0.125, 143.1, depth + 0.12], [u + 0.125, 143.1, depth + 0.12], [u + 0.125, spring, depth + 0.12], [u - 0.125, spring, depth + 0.12]];
      solid("hall-trim", face, face.map(([x, y]) => [x, y, depth - 0.07]));
    }
  }
  const galleryBand = (y, radius, thickness, height) => {
    const point = (a, r, h) => [Math.cos(a) * r, h, tz + Math.sin(a) * r];
    for (let i = 0; i < 48; i++) {
      const a = i * TAU / 48, b = (i + 1) * TAU / 48, inner = radius - thickness;
      quad(walls, "hall-trim", point(b, radius, y), point(a, radius, y), point(a, radius, y + height), point(b, radius, y + height));
      quad(walls, "hall-trim", point(a, inner, y), point(b, inner, y), point(b, inner, y + height), point(a, inner, y + height));
      quad(walls, "hall-trim", point(a, radius, y + height), point(a, inner, y + height), point(b, inner, y + height), point(b, radius, y + height));
      quad(walls, "hall-trim", point(b, radius, y), point(b, inner, y), point(a, inner, y), point(a, radius, y));
    }
  };
  box(walls, "hall-stone", 0, body, tz, 27.43, 31.3, 27.43);
  pedestal(0, 58.43, tz, 27.43, 27.43);
  box(walls, "hall-stone", 0, 59.93, tz, 23.3, 18.1, 23.3);
  pedestal(0, 78.03, tz, 23.3, 23.3);
  box(walls, "hall-stone", 0, 79.53, tz, 19.5, 20.3, 19.5);
  pedestal(0, 99.83, tz, 20.5, 20.5);
  towerLoft("hall-zinc", [[101.33, 9.9, 2.7], [117.8, 9.9, 2.7]], true);
  for (const y of [103.9, 106.7, 109.5, 112.3, 115.1])
    towerLoft("hall-joint", [[y, 9.917, 2.717], [y + 0.025, 9.917, 2.717]]);
  towerLoft("hall-trim", [[117.45, 10.0, 2.8], [117.8, 10.35, 3.0], [118.05, 10.5, 3.1], [118.45, 10.55, 3.15], [118.75, 10.25, 2.9]], true);
  for (let side = 0; side < 4; side++) clockShoulders(side);
  // Long recessed belfry windows and engaged columns divide the tower into distinct vertical stages.
  for (const y of [37.5, 62.2, 83.5])
    for (const side of [0, 1, 2, 3]) {
      const horizontal = side % 2 === 0,
        sign = side < 2 ? -1 : 1,
        half = y < 50 ? 13.75 : y < 70 ? 11.7 : 9.8;
      for (const u of [-4.9, 4.9]) {
        const x = horizontal ? u : sign * half,
          z = tz + (horizontal ? sign * half : u);
        box(
          walls,
          "glass",
          x,
          y,
          z,
          horizontal ? 1.9 : 0.15,
          11,
          horizontal ? 0.15 : 1.9,
        );
      }
      for (const u of [-8, -2.7, 2.7, 8]) {
        const x = horizontal ? u : sign * (half + 0.3),
          z = tz + (horizontal ? sign * (half + 0.3) : u);
        cylinder(walls, "hall-trim", x, y - 0.4, z, 0.52, 12.2, 8);
      }
    }
  function clock(side) {
    const horizontal = side % 2 === 0,
      sign = side < 2 ? -1 : 1,
      face = 10.06,
      y = 110.07;
    const at = (u, v, offset = 0) =>
      horizontal
        ? [u, y + v, tz + sign * (face + offset)]
        : [sign * (face + offset), y + v, tz + u];
    const add = (material, a, b, c) => {
      tri(walls, material, a, b, c);
      tri(walls, material, c, b, a);
    };
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU,
        b = ((i + 1) / 64) * TAU,
        p = at(Math.sin(a) * 3.96, Math.cos(a) * 3.96, 0.03),
        q = at(Math.sin(b) * 3.96, Math.cos(b) * 3.96, 0.03);
      add("hall-dial", at(0, 0, 0.03), p, q);
      const p2 = at(Math.sin(a) * 4.36, Math.cos(a) * 4.36),
        q2 = at(Math.sin(b) * 4.36, Math.cos(b) * 4.36);
      add("hall-trim", p, p2, q2);
      add("hall-trim", p, q2, q);
    }
    const doubleQuad = (material, a, b, c, d) => {
      quad(walls, material, a, b, c, d);
      quad(walls, material, d, c, b, a);
    };
    const strip = (angle, start, end, width, offset = 0.085) => {
      const sn = Math.sin(angle),
        cs = Math.cos(angle),
        point = (r, w) => at(sn * r + cs * w, cs * r - sn * w, offset);
      doubleQuad(
        "dark",
        point(start, -width / 2),
        point(end, -width / 2),
        point(end, width / 2),
        point(start, width / 2),
      );
    };
    const ring = (
      radius,
      width,
      material = "dark",
      offset = 0.09,
      radial = () => 0,
    ) => {
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * TAU,
          b = ((i + 1) / 96) * TAU;
        const p = (theta, d) =>
          at(
            Math.sin(theta) * (radius + radial(theta) + d),
            Math.cos(theta) * (radius + radial(theta) + d),
            offset,
          );
        doubleQuad(
          material,
          p(a, -width / 2),
          p(b, -width / 2),
          p(b, width / 2),
          p(a, width / 2),
        );
      }
    };
    // Main tower photograph (Oleg Yunakov, 2023): glazed radial panels and a quatrefoil
    // inner frame. The gilded Roman-numbered secondary clock is a different fixture.
    ring(3.84, 0.1);
    ring(3.48, 0.12);
    ring(2.65, 0.075);
    ring(1.96, 0.065, "dark", 0.095, (a) => -0.32 * Math.cos(4 * a));
    ring(4.16, 0.07, "hall-joint", 0.04);
    for (let i = 0; i < 60; i++)
      strip(
        (i / 60) * TAU,
        i % 5 === 0 ? 2.68 : 3.52,
        3.79,
        i % 5 === 0 ? 0.13 : 0.045,
      );
    const hand = (angle, length, width) => {
      // `u` changes screen direction on opposite faces. Rotate only the hands
      // into the outward viewer's right/up basis so all four show the same time.
      angle *= horizontal ? sign : -sign;
      strip(angle, -0.65, length - 0.35, width * 0.48, 0.15);
      const sn = Math.sin(angle),
        cs = Math.cos(angle),
        point = (r, w) => at(sn * r + cs * w, cs * r - sn * w, 0.16);
      doubleQuad(
        "dark",
        point(length * 0.45, 0),
        point(length * 0.7, -width),
        point(length, 0),
        point(length * 0.7, width),
      );
    };
    hand(0.9, 2.55, 0.22);
    hand(4.2, 3.55, 0.14);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU,
        b = ((i + 1) / 24) * TAU;
      add(
        "dark",
        at(0, 0, 0.18),
        at(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.18),
        at(Math.sin(b) * 0.17, Math.cos(b) * 0.17, 0.18),
      );
    }
    // Paired engaged columns and inset bases bracket each face without hiding its dial.
    for (const s of [-1, 1])
      for (const delta of [-0.32, 0.32]) {
        const p = at(s * 6.4 + delta, -6.7, -0.08);
        cylinder(walls, "hall-trim", ...p, 0.25, 12.9, 12, 0.22);
        for (const [v, radius, height] of [
          [-7.1, 0.38, 0.4],
          [6.2, 0.36, 0.42],
        ]) {
          const cap = at(s * 6.4 + delta, v, -0.08);
          cylinder(walls, "hall-trim", ...cap, radius, height, 12);
        }
      }
  }
  for (let side = 0; side < 4; side++) clock(side);
  towerLoft("hall-zinc", taperProfile, true);
  towerLoft("hall-trim", [[140.63, 4.52, 1.12], [141.0, 4.6, 1.2], [141.43, 4.3, 1.0]], true);
  for (let side = 0; side < 4; side++) louverFace(side);
  cylinder(walls, "hall-zinc", 0, 141.43, tz, 4.3, 8.1, 48, 3.8);
  cylinder(walls, "hall-trim", 0, 149.53, tz, 4.95, 0.65, 48);
  galleryBand(150.25, 4.72, 0.11, 0.1);
  galleryBand(151.42, 4.72, 0.11, 0.1);
  for (let i = 0; i < 32; i++) {
    const a = i * TAU / 32;
    cylinder(walls, "hall-trim", Math.cos(a) * 4.66, 150.18, tz + Math.sin(a) * 4.66, 0.055, 1.34, 6);
  }
  cylinder(walls, "hall-zinc", 0, 150.18, tz, 2.8, 4.45, 32, 1.8);
  cylinder(walls, "hall-trim", 0, 154.63, tz, 2.25, 1.12, 32);
  // Sculptural silhouettes are original low-detail placeholders, not reproductions of Calder's carving.
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 8.8,
        z = tz + sz * 8.8;
      box(walls, "hall-trim", x, 118.75, z, 1.2, 1.15, 1.2);
      cylinder(walls, "bronze", x, 119.9, z, 0.55, 2.4, 8, 0.45);
      cylinder(walls, "bronze", x, 122.3, z, 0.48, 1, 8, 0.33);
    }
  for (const sx of [-1, 1])
    cylinder(walls, "bronze", sx * 0.62, 155.75, tz, 0.43, 3.4, 8, 0.52);
  cylinder(walls, "bronze", 0, 158.15, tz, 1.55, 4.6, 10, 1.05);
  box(walls, "bronze", -1.35, 159.1, tz, 0.6, 3.1, 0.8);
  box(walls, "bronze", 1.4, 160.1, tz, 0.6, 2.4, 0.8);
  cylinder(walls, "bronze", 0, 162.75, tz, 0.72, 1.65, 10, 0.75);
  cylinder(walls, "bronze", 0, 164.4, tz, 1.45, 0.28, 12);
  cylinder(walls, "bronze", 0, 164.68, tz, 0.84, 2.35, 10, 0.72);
  return {
    id: source.id,
    frame: { origin: frame.origin, angle: frame.angle, width: W, depth: D },
    height: 167.03,
    mainCorniceHeight: body,
    roofHeight: roofTop,
    cornerPavilionHeight: 49.07,
    centerPavilionHeight: 61.84,
    municipalBodyHeight: source.height,
    clockCenterY: 110.07,
    clockDiameter: 7.92,
    portals: {
      halfWidth: 5.65,
      clearanceAtCenter: 11.8,
      hostCollisionClearWidth: 10.4,
    },
    approximation: true,
  };
}
