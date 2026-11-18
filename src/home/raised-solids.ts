import type { Box3 } from './state.ts';

/** Region of an item, in its own frame, searched for solid parts standing above a resting surface. */
export interface RaisedRegion { minX: number; maxX: number; minZ: number; maxZ: number; base: number; top: number }

const CELL = .07, MAX_CELLS = 40;
/** Each column is probed on a 3 × 3 pattern and takes the tallest result, so a thin headboard panel is not missed. */
const PROBES = [1 / 6, 1 / 2, 5 / 6];
/** A part must stand this far above the surface to count; the crown of a seat cushion does not, so the authored resting height stays. */
const MIN_RISE = .12;
/** Air gaps below this are bridged: a back cushion resting a little above the seat is still part of the back. */
const BRIDGE = .12;
/** How many columns sideways a leaning part may be from the column that holds it up. */
const LEAN_CELLS = 3;
/** Faces steeper than about 70° count as upright. */
const STEEP = .35;
const MAX_BOXES = 96;

/**
 * Backrests, arms and headboards as boxes, from the model's own triangles.
 *
 * A sofa or bed collides as a slab up to its seat so things can rest on it; without these boxes everything
 * above the seat is open air and a carried thing passes straight through the back. Each column of a grid over
 * the footprint is filled from the surface up to where the model is continuously solid, so an overhanging
 * canopy does not fill the space under it.
 *
 * `triangles` holds nine numbers per triangle in the item's frame (base centre at the origin, +Y up).
 */
export function raisedSolidBoxes(triangles: ArrayLike<number>, region: RaisedRegion): Box3[] {
  const width = region.maxX - region.minX, depth = region.maxZ - region.minZ;
  if (!(width > 0) || !(depth > 0) || !(region.top > region.base + MIN_RISE)) return [];
  const nx = Math.max(1, Math.min(MAX_CELLS, Math.round(width / CELL))), nz = Math.max(1, Math.min(MAX_CELLS, Math.round(depth / CELL)));
  const dx = width / nx, dz = depth / nz;
  /** Per cell: where a vertical line crosses the model, and whether that face looks up. */
  const crossings: { y: number; up: boolean }[][] = Array.from({ length: nx * nz * 9 }, () => []);
  // Per column: the solid spans of the model, as [underside, top].
  const spans: [number, number][][] = Array.from({ length: nx * nz }, () => []);
  for (let offset = 0; offset + 8 < triangles.length; offset += 9) {
    const ax = triangles[offset], ay = triangles[offset + 1], az = triangles[offset + 2];
    const bx = triangles[offset + 3], by = triangles[offset + 4], bz = triangles[offset + 5];
    const cx = triangles[offset + 6], cy = triangles[offset + 7], cz = triangles[offset + 8];
    const top = Math.max(ay, by, cy), bottom = Math.min(ay, by, cy);
    if (top < region.base) continue;
    // Twice the signed area seen from above; its sign says which way the face looks.
    const area = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    // An upright face has no top or underside for a vertical line to cross: a headboard panel capped by its
    // rail is only such faces. It stands where it is drawn, so the columns along it are solid over its height.
    const steep = Math.abs(area) < STEEP * Math.hypot(area, (by - ay) * (cz - az) - (bz - az) * (cy - ay), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (steep && top - bottom > .02) {
      const corners = [ax, az, bx, bz, cx, cz, ax, az];
      let last = -1;
      for (let edge = 0; edge < 3; edge++) {
        const x0 = corners[edge * 2], z0 = corners[edge * 2 + 1], x1 = corners[edge * 2 + 2], z1 = corners[edge * 2 + 3];
        const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (Math.min(dx, dz) / 2));
        for (let step = 0; step <= steps; step++) {
          const t = steps ? step / steps : 0;
          const i = Math.floor((x0 + (x1 - x0) * t - region.minX) / dx), j = Math.floor((z0 + (z1 - z0) * t - region.minZ) / dz);
          if (i < 0 || j < 0 || i >= nx || j >= nz || i * nz + j === last) continue;
          last = i * nz + j; spans[last].push([bottom, top]);
        }
      }
    }
    if (Math.abs(area) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - region.minX) / dx)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - region.minX) / dx));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - region.minZ) / dz)), j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - region.minZ) / dz));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let probe = 0; probe < 9; probe++) {
      const x = region.minX + (i + PROBES[probe % 3]) * dx, z = region.minZ + (j + PROBES[(probe - probe % 3) / 3]) * dz;
      const u = ((z - az) * (cx - ax) - (x - ax) * (cz - az)) / area, v = ((bz - az) * (x - ax) - (bx - ax) * (z - az)) / area;
      if (u < 0 || v < 0 || u + v > 1) continue;
      crossings[(i * nz + j) * 9 + probe].push({ y: ay + u * (by - ay) + v * (cy - ay), up: area > 0 });
    }
  }
  // The rest of a column's spans run from a face looking down to the faces looking up above it.
  for (let probe = 0; probe < crossings.length; probe++) {
    const list = crossings[probe].sort((a, b) => a.y - b.y), cell = (probe - probe % 9) / 9;
    let underside = region.base;
    for (const crossing of list) {
      if (!crossing.up) underside = crossing.y;
      else if (crossing.y > region.base) spans[cell].push([underside, crossing.y]);
    }
  }
  /** Climb from a supported height through every span that starts within reach of it. */
  const climb = (cell: number, from: number, floor: number) => {
    let height = floor;
    for (let changed = true; changed;) {
      changed = false;
      for (const [bottom, top] of spans[cell]) if (top > height && bottom <= Math.max(from, height) + BRIDGE) { height = top; changed = true; }
    }
    return Math.min(region.top, height);
  };
  const heights = new Float32Array(nx * nz);
  for (let cell = 0; cell < heights.length; cell++) heights[cell] = climb(cell, region.base, region.base);
  // A leaning panel has open air under it in its own column and is held up by the column next to it. Let that
  // support reach a few columns sideways: enough for a sloped headboard, too little to fill under a canopy.
  for (let pass = 0; pass < LEAN_CELLS; pass++) {
    const before = heights.slice();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      let support = region.base;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const ni = i + di, nj = j + dj;
        if ((di || dj) && ni >= 0 && nj >= 0 && ni < nx && nj < nz) support = Math.max(support, before[ni * nz + nj]);
      }
      const cell = i * nz + j;
      if (support > before[cell] + BRIDGE) heights[cell] = Math.max(before[cell], climb(cell, support, before[cell]));
    }
  }
  for (let step = .08; ; step *= 2) {
    const boxes = mergeColumns(heights, nx, nz, step, region, dx, dz);
    if (boxes.length <= MAX_BOXES || step > 1) return boxes.slice(0, MAX_BOXES);
  }
}

/** Neighbouring columns of about the same height become one box. */
function mergeColumns(heights: Float32Array, nx: number, nz: number, step: number, region: RaisedRegion, dx: number, dz: number): Box3[] {
  const level = (i: number, j: number) => { const rise = heights[i * nz + j] - region.base; return rise < MIN_RISE ? 0 : Math.max(1, Math.round(rise / step)); };
  const boxes: Box3[] = [];
  let open: { j0: number; j1: number; level: number; box: Box3 }[] = [];
  for (let i = 0; i < nx; i++) {
    const runs: typeof open = [];
    for (let j = 0; j < nz;) {
      const value = level(i, j);
      let end = j + 1;
      while (end < nz && level(i, end) === value) end++;
      if (value) {
        const previous = open.find(run => run.j0 === j && run.j1 === end && run.level === value);
        // A box is as tall as the tallest column in it, not the rounded level it was grouped by.
        let top = 0;
        for (let k = j; k < end; k++) top = Math.max(top, heights[i * nz + k]);
        if (previous) { previous.box.max[0] = region.minX + (i + 1) * dx; previous.box.max[1] = Math.max(previous.box.max[1], top); runs.push(previous); }
        else {
          const box: Box3 = { min: [region.minX + i * dx, region.base, region.minZ + j * dz], max: [region.minX + (i + 1) * dx, top, region.minZ + end * dz] };
          boxes.push(box); runs.push({ j0: j, j1: end, level: value, box });
        }
      }
      j = end;
    }
    open = runs;
  }
  return boxes;
}
