import { physicalItemProfile } from './physical-items-profile.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function rotation(pose) {
  let [x, y, z, w] = pose.tilt ?? [0, Math.sin(pose.yaw / 2), 0, Math.cos(pose.yaw / 2)];
  const length = Math.hypot(x, y, z, w); x /= length; y /= length; z /= length; w /= length;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)],
    [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)],
    [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]];
}
function localBox(definition) {
  const { width, depth, height } = definition.size, cx = definition.center?.x ?? 0, cz = definition.center?.z ?? 0;
  return { min: [cx - width / 2, 0, cz - depth / 2], max: [cx + width / 2, height, cz + depth / 2] };
}
function orientedBox(box, pose) {
  const axes = rotation(pose), middle = box.min.map((min, axis) => (min + box.max[axis]) / 2);
  const center = [pose.x, pose.y, pose.z].map((position, axis) => position + axes.reduce((sum, vector, i) => sum + vector[axis] * middle[i], 0));
  return { center, axes, half: box.min.map((min, axis) => (box.max[axis] - min) / 2) };
}
function aabb(box) {
  const extent = [0, 1, 2].map(axis => box.axes.reduce((sum, vector, i) => sum + Math.abs(vector[axis]) * box.half[i], 0));
  return { min: box.center.map((value, axis) => value - extent[axis]), max: box.center.map((value, axis) => value + extent[axis]) };
}
function transformPoint(point, pose, axes = rotation(pose)) {
  return [pose.x, pose.y, pose.z].map((position, axis) => position + axes.reduce((sum, vector, i) => sum + vector[axis] * point[i], 0));
}
/** Match describeCollider: primitive centres are model-local and rotate with the body. */
function primitive(definition, pose) {
  const axes = rotation(pose), { width, depth, height } = definition.size;
  const cx = definition.center?.x ?? 0, cz = definition.center?.z ?? 0, kind = definition.physics?.kind;
  const slab = definition.mount === 'floor' && definition.surface && definition.surface.height < height - .05;
  if (!slab && kind === 'ball') {
    const radius = Math.max(width, depth, height) / 2;
    return { kind, center: transformPoint([cx, radius, cz], pose, axes), radius };
  }
  const border = definition.mount === 'small' ? Math.min(.006, width / 8, depth / 8, height / 8) : 0;
  if (!slab && kind === 'cylinder') return { kind, center: transformPoint([cx, height / 2, cz], pose, axes), axes,
    radius: Math.min(width, depth) / 2, halfHeight: height / 2, border };
  if (!slab && kind === 'hull') {
    const points = definition.physics.points;
    if (Array.isArray(points) && points.length >= 12 && points.length <= 768 && points.length % 3 === 0 && points.every(finite)) {
      const transformed = [];
      for (let index = 0; index < points.length; index += 3) transformed.push(transformPoint(points.slice(index, index + 3), pose, axes));
      return { kind, points: transformed, box: orientedBox(localBox(definition), pose) };
    }
  }
  const box = localBox(definition);
  if (slab) box.max[1] = definition.surface.height;
  return { kind: 'box', ...orientedBox(box, pose), border };
}
function shapeBounds(shape) {
  if (shape.kind === 'box') {
    if (!shape.border) return aabb(shape);
    const extent = [0, 1, 2].map(axis => shape.axes.reduce((sum, vector, i) => sum + Math.abs(vector[axis]) * (shape.half[i] - shape.border), shape.border));
    return { min: shape.center.map((value, axis) => value - extent[axis]), max: shape.center.map((value, axis) => value + extent[axis]) };
  }
  if (shape.kind === 'hull') return { min: [0, 1, 2].map(axis => Math.min(...shape.points.map(point => point[axis]))),
    max: [0, 1, 2].map(axis => Math.max(...shape.points.map(point => point[axis]))) };
  const extent = shape.kind === 'ball' ? [shape.radius, shape.radius, shape.radius]
    : shape.axes[1].map(value => Math.abs(value) * (shape.halfHeight - shape.border)
      + Math.sqrt(Math.max(0, 1 - value * value)) * (shape.radius - shape.border) + shape.border);
  return { min: shape.center.map((value, axis) => value - extent[axis]), max: shape.center.map((value, axis) => value + extent[axis]) };
}
function overlaps(a, b, tolerance) {
  tolerance = Math.min(tolerance, ...a.half.map(value => value * .4), ...b.half.map(value => value * .4));
  const delta = a.center.map((value, axis) => value - b.center[axis]);
  for (const raw of [...a.axes, ...b.axes, ...a.axes.flatMap(u => b.axes.map(v => cross(u, v)))]) {
    const length = Math.hypot(...raw);
    if (length < 1e-8) continue;
    const axis = raw.map(value => value / length);
    const extent = box => box.axes.reduce((sum, vector, i) => sum + Math.abs(dot(vector, axis)) * box.half[i], 0);
    if (Math.abs(dot(delta, axis)) >= extent(a) + extent(b) - tolerance) return false;
  }
  return true;
}

export function physicalPlacementBounds(definition, placement) {
  return shapeBounds(primitive(definition, placement));
}
export function physicalPlacementsOverlap(a, pa, b, pb, tolerance = .002) {
  return shapesOverlap(primitive(a, pa), primitive(b, pb), tolerance);
}
function sphereOverlap(sphere, other, tolerance) {
  tolerance = Math.min(tolerance, sphere.radius * .4);
  const delta = sphere.center.map((value, axis) => value - other.center[axis]);
  if (other.kind === 'ball') return Math.hypot(...delta) < sphere.radius + other.radius - Math.min(tolerance, other.radius * .4);
  const local = other.axes.map(axis => dot(delta, axis));
  let distance;
  if (other.kind === 'cylinder') {
    tolerance = Math.min(tolerance, other.radius * .4, other.halfHeight * .4);
    distance = Math.hypot(Math.max(0, Math.hypot(local[0], local[2]) - other.radius + other.border),
      Math.max(0, Math.abs(local[1]) - other.halfHeight + other.border)) - other.border;
  } else {
    tolerance = Math.min(tolerance, ...other.half.map(value => value * .4));
    const border = other.border ?? 0;
    distance = Math.hypot(...local.map((value, axis) => Math.max(0, Math.abs(value) - other.half[axis] + border))) - border;
  }
  return distance < sphere.radius - tolerance;
}
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
function support(shape, direction) {
  if (shape.kind === 'hull') return shape.points.reduce((best, point) => dot(point, direction) > dot(best, direction) ? point : best);
  const length = Math.hypot(...direction), unit = direction.map(value => value / length);
  if (shape.kind === 'ball') return shape.center.map((value, axis) => value + unit[axis] * shape.radius);
  const local = shape.axes.map(axis => dot(direction, axis)), border = shape.border ?? 0;
  let offset;
  if (shape.kind === 'cylinder') {
    const radial = Math.hypot(local[0], local[2]);
    offset = [radial ? local[0] / radial * (shape.radius - border) : 0,
      Math.sign(local[1]) * (shape.halfHeight - border), radial ? local[2] / radial * (shape.radius - border) : 0];
  } else offset = local.map((value, axis) => Math.sign(value) * (shape.half[axis] - border));
  return shape.center.map((value, axis) => value + shape.axes.reduce((sum, vector, i) => sum + vector[axis] * offset[i], border * unit[axis]));
}
function shapeThickness(shape) {
  if (shape.kind === 'ball') return shape.radius * 2;
  if (shape.kind === 'cylinder') return Math.min(shape.radius, shape.halfHeight) * 2;
  return Math.min(...(shape.kind === 'hull' ? shape.box.half : shape.half)) * 2;
}
/**
 * Expand an inner polytope of A-B. Every face gives a lower penetration bound;
 * an exact support plane gives an upper bound. This tests the contact tolerance
 * directly, without approximating cylinders/hulls by their enclosing boxes.
 */
function convexOverlap(a, b, tolerance) {
  const minkowski = direction => subtract(support(a, direction), support(b, direction.map(value => -value)));
  const seeds = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(minkowski);
  let tetra;
  for (let i = 0; i < seeds.length && !tetra; i++) for (let j = i + 1; j < seeds.length && !tetra; j++)
    for (let k = j + 1; k < seeds.length && !tetra; k++) for (let l = k + 1; l < seeds.length; l++) {
      if (Math.abs(dot(cross(subtract(seeds[j], seeds[i]), subtract(seeds[k], seeds[i])), subtract(seeds[l], seeds[i]))) > 1e-12) {
        tetra = [seeds[i], seeds[j], seeds[k], seeds[l]]; break;
      }
    }
  if (!tetra) return false;
  const points = [...tetra], interior = [0, 1, 2].map(axis => tetra.reduce((sum, point) => sum + point[axis] / 4, 0));
  let faces = [];
  const face = (i, j, k) => {
    let normal = cross(subtract(points[j], points[i]), subtract(points[k], points[i])), length = Math.hypot(...normal);
    if (length < 1e-12) return;
    normal = normal.map(value => value / length);
    if (dot(normal, subtract(interior, points[i])) > 0) { [j, k] = [k, j]; normal = normal.map(value => -value); }
    return { indices: [i, j, k], normal, distance: dot(normal, points[i]) };
  };
  for (const indices of [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]) faces.push(face(...indices));
  const expand = point => {
    const visible = faces.filter(one => dot(one.normal, point) - one.distance > 1e-10);
    if (!visible.length) return false;
    const edges = new Map();
    for (const one of visible) for (let i = 0; i < 3; i++) {
      const x = one.indices[i], y = one.indices[(i + 1) % 3], key = x < y ? x + ':' + y : y + ':' + x;
      if (edges.has(key)) edges.delete(key); else edges.set(key, [x, y]);
    }
    const removed = new Set(visible), index = points.push(point) - 1;
    faces = faces.filter(one => !removed.has(one));
    for (const [x, y] of edges.values()) { const next = face(x, y, index); if (next) faces.push(next); }
    return true;
  };
  for (const seed of seeds) expand(seed);
  for (let iteration = 0; iteration < 96; iteration++) {
    const closest = faces.reduce((best, one) => one.distance < best.distance ? one : best);
    if (closest.distance > tolerance) return true;
    const point = minkowski(closest.normal), upper = dot(closest.normal, point);
    if (upper <= tolerance + 1e-8) return false;
    if (upper - closest.distance < 1e-8 || !expand(point)) return closest.distance > tolerance;
  }
  // At the iteration cap only a certified inner penetration may reject a save.
  return faces.every(one => one.distance > tolerance);
}
function shapesOverlap(a, b, tolerance) {
  tolerance = Math.min(tolerance, shapeThickness(a) * .2, shapeThickness(b) * .2);
  const ba = shapeBounds(a), bb = shapeBounds(b);
  if (ba.min.some((value, axis) => value >= bb.max[axis] - tolerance || ba.max[axis] <= bb.min[axis] + tolerance)) return false;
  if (a.kind === 'ball' && b.kind !== 'hull') return sphereOverlap(a, b, tolerance);
  if (b.kind === 'ball' && a.kind !== 'hull') return sphereOverlap(b, a, tolerance);
  if (a.kind === 'box' && b.kind === 'box' && !a.border && !b.border) return overlaps(a, b, tolerance);
  return convexOverlap(a, b, tolerance);
}
function solidBoxes(definition, item) {
  if (definition.rug) return [];
  const outer = localBox(definition), profile = physicalItemProfile(definition), interior = profile.container?.interior;
  if (interior) {
    const [x0, y0, z0] = outer.min, [x1, , z1] = outer.max, [ix0, iy0, iz0] = interior.min, [ix1, iy1, iz1] = interior.max;
    const boxes = [{ min: [x0, y0, z0], max: [x1, iy0, z1] },
      { min: [x0, iy0, z0], max: [ix0, iy1, z1] }, { min: [ix1, iy0, z0], max: [x1, iy1, z1] },
      { min: [ix0, iy0, z0], max: [ix1, iy1, iz0] }, { min: [ix0, iy0, iz1], max: [ix1, iy1, z1] }];
    if (item.closed) boxes.push({ min: [x0, iy1, z0], max: [x1, Math.max(iy1 + .005, outer.max[1]), z1] });
    return boxes;
  }
  if (definition.shelves?.length) {
    const boxes = [], shelves = [...definition.shelves].sort((a, b) => a.y - b.y);
    let ceiling = 0;
    shelves.forEach((shelf, index) => {
      const bottom = index === 0 ? 0 : Math.max(Math.min(ceiling, shelf.y - .005), shelf.y - .06);
      boxes.push({ min: [shelf.minX, bottom, shelf.minZ], max: [shelf.maxX, shelf.y, shelf.maxZ] });
      if (shelf.clearance === undefined) { ceiling = shelf.y; return; }
      ceiling = shelf.y + shelf.clearance;
      if (!shelf.open.includes('+x')) boxes.push({ min: [shelf.maxX, shelf.y, shelf.minZ], max: [Math.max(shelf.maxX + .02, outer.max[0]), ceiling, shelf.maxZ] });
      if (!shelf.open.includes('-x')) boxes.push({ min: [Math.min(shelf.minX - .02, outer.min[0]), shelf.y, shelf.minZ], max: [shelf.minX, ceiling, shelf.maxZ] });
      if (!shelf.open.includes('+z')) boxes.push({ min: [shelf.minX, shelf.y, shelf.maxZ], max: [shelf.maxX, ceiling, Math.max(shelf.maxZ + .02, outer.max[2])] });
      if (!shelf.open.includes('-z')) boxes.push({ min: [shelf.minX, shelf.y, Math.min(shelf.minZ - .02, outer.min[2])], max: [shelf.maxX, ceiling, shelf.minZ] });
    });
    if (definition.surface && definition.surface.height > ceiling + .005) boxes.push({
      min: [outer.min[0], Math.max(ceiling, definition.surface.height - .06), outer.min[2]],
      max: [outer.max[0], definition.surface.height, outer.max[2]],
    });
    return boxes;
  }
  // Match the existing sofa/bed collider: their seat/mattress is the usable top.
  if (definition.mount === 'floor' && definition.surface && definition.surface.height < definition.size.height - .05) {
    outer.max[1] = definition.surface.height;
  }
  return [outer];
}

export function physicalItemSolidBoxes(definition, placement = {}) {
  return solidBoxes(definition, placement);
}
export function physicalSolidPlacementsOverlap(a, pa, b, pb, tolerance = .002) {
  const shapesA = solidShapes(a, pa), shapesB = solidShapes(b, pb);
  return shapesA.some(one => shapesB.some(two => shapesOverlap(one, two, tolerance)));
}
function solidShapes(definition, pose) {
  if (definition.rug) return [];
  if (definition.shelves?.length || physicalItemProfile(definition).container) {
    return solidBoxes(definition, pose).map(box => ({ kind: 'box', ...orientedBox(box, pose) }));
  }
  return [primitive(definition, pose)];
}

