import * as THREE from "three";

// Host adaptation (memory while loading): vertex data goes straight into
// growable Float32Arrays instead of JavaScript number arrays (8 bytes per value
// plus growth copies on the JavaScript heap), and each cell's builder storage is
// released as soon as its geometry is made. The same values reach the same
// Float32 attributes in the same order; tests/philadelphia-assets.test.mjs
// checks this against the pinned source. Methods other than `bucket`, `tri` and
// `build` are unchanged, including their `this.tri` / `this.quad` dispatch,
// which City Hall's UV adapter (hall-materials.js) intercepts.
const TRI_UV = [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  WHITE = [1, 1, 1],
  _ab = new THREE.Vector3(),
  _ac = new THREE.Vector3(),
  EMPTY = new Float32Array(0);

/** Frees a builder-private buffer now instead of at the next garbage collection. */
function release(array) {
  const buffer = array.buffer;
  if (array.length && typeof buffer.transfer === "function" && !buffer.detached)
    buffer.transfer(0);
}

/** An append-only Float32 column; `values` are appended as `Array#push(...values)` would. */
class FloatColumn {
  constructor() {
    this.array = new Float32Array(96);
    this.length = 0;
  }
  reserve(count) {
    const need = this.length + count;
    if (need <= this.array.length) return;
    let size = Math.max(96, this.array.length * 2);
    while (size < need) size *= 2;
    const grown = new Float32Array(size);
    grown.set(this.array.subarray(0, this.length));
    release(this.array);
    this.array = grown;
  }
  push3(x, y, z) {
    this.reserve(3);
    const array = this.array;
    array[this.length] = x;
    array[this.length + 1] = y;
    array[this.length + 2] = z;
    this.length += 3;
  }
  pushAll(values) {
    if (Array.isArray(values)) {
      const count = values.length;
      this.reserve(count);
      for (let i = 0; i < count; i++) this.array[this.length++] = values[i];
    } else
      for (const value of values) {
        this.reserve(1);
        this.array[this.length++] = value;
      }
  }
  /** The finished attribute (an exact-length copy, as from a number array); the column is emptied. */
  attribute(itemSize) {
    const attribute = new THREE.Float32BufferAttribute(
      this.array.subarray(0, this.length),
      itemSize,
    );
    release(this.array);
    this.array = EMPTY;
    this.length = 0;
    return attribute;
  }
}

/** A spatial/material batch retains replaceable feature IDs in the data, not one mesh per prop. */
export class Batches {
  constructor(materials, size = 180) {
    this.materials = materials;
    this.size = size;
    this.data = new Map();
    this.last = null;
  }
  bucket(material, x, z) {
    const cx = Math.floor(x / this.size),
      cz = Math.floor(z / this.size),
      last = this.last;
    // Consecutive triangles almost always land in the same cell and material.
    if (last && last.cx === cx && last.cz === cz && last.material === material)
      return last;
    const key = `${cx}:${cz}:${material}`;
    let d = this.data.get(key);
    if (!d)
      this.data.set(key, (d = { material, cx, cz,
        p: new FloatColumn(), n: new FloatColumn(), uv: new FloatColumn(), c: new FloatColumn() }));
    this.last = d;
    return d;
  }
  tri(material, a, b, c, uv = TRI_UV, color = WHITE) {
    const d = this.bucket(
      material,
      (a[0] + b[0] + c[0]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    );
    _ab.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _ac.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const n = _ab.cross(_ac).normalize();
    d.p.pushAll(a);
    d.p.pushAll(b);
    d.p.pushAll(c);
    for (let i = 0; i < 3; i++) {
      d.n.push3(n.x, n.y, n.z);
      d.uv.pushAll(uv[i]);
      d.c.pushAll(color);
    }
  }
  quad(
    material,
    a,
    b,
    c,
    d,
    uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    color = [1, 1, 1],
  ) {
    this.tri(material, a, b, c, [uv[0], uv[1], uv[2]], color);
    this.tri(material, a, c, d, [uv[0], uv[2], uv[3]], color);
  }
  box(material, x, y, z, w, h, d, yaw = 0, color = [1, 1, 1]) {
    const cs = Math.cos(yaw),
      sn = Math.sin(yaw);
    const p = ([a, b, c]) => [x + a * cs + c * sn, y + b, z - a * sn + c * cs];
    const v = [
      [-w / 2, 0, -d / 2],
      [w / 2, 0, -d / 2],
      [w / 2, 0, d / 2],
      [-w / 2, 0, d / 2],
      [-w / 2, h, -d / 2],
      [w / 2, h, -d / 2],
      [w / 2, h, d / 2],
      [-w / 2, h, d / 2],
    ].map(p);
    for (const f of [
      [0, 4, 5, 1],
      [1, 5, 6, 2],
      [2, 6, 7, 3],
      [3, 7, 4, 0],
      [4, 7, 6, 5],
      [0, 1, 2, 3],
    ])
      this.quad(material, ...f.map((i) => v[i]), undefined, color);
  }
  cylinder(
    material,
    x,
    y,
    z,
    r,
    h,
    segments = 8,
    color = [1, 1, 1],
    radiusTop = r,
  ) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2,
        b = ((i + 1) / segments) * Math.PI * 2;
      this.quad(
        material,
        [x + r * Math.cos(b), y, z + r * Math.sin(b)],
        [x + r * Math.cos(a), y, z + r * Math.sin(a)],
        [x + radiusTop * Math.cos(a), y + h, z + radiusTop * Math.sin(a)],
        [x + radiusTop * Math.cos(b), y + h, z + radiusTop * Math.sin(b)],
        undefined,
        color,
      );
      this.tri(
        material,
        [x, y + h, z],
        [x + radiusTop * Math.cos(b), y + h, z + radiusTop * Math.sin(b)],
        [x + radiusTop * Math.cos(a), y + h, z + radiusTop * Math.sin(a)],
        undefined,
        color,
      );
    }
  }
  surface(material, polygon, holes = [], y = 0, scale = 4, color = [1, 1, 1]) {
    const open = (r) =>
      r.length > 2 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]
        ? r.slice(0, -1)
        : r;
    const outer = open(polygon),
      inner = holes.map(open),
      rings = [outer, ...inner];
    const verts = rings.flat(),
      indices = THREE.ShapeUtils.triangulateShape(
        outer.map((v) => new THREE.Vector2(...v)),
        inner.map((r) => r.map((v) => new THREE.Vector2(...v))),
      );
    for (const f of indices) {
      let a = verts[f[0]],
        b = verts[f[1]],
        c = verts[f[2]];
      if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0)
        [b, c] = [c, b];
      this.tri(
        material,
        [a[0], y, a[1]],
        [b[0], y, b[1]],
        [c[0], y, c[1]],
        [a, b, c].map((v) => [v[0] / scale, -v[1] / scale]),
        color,
      );
    }
  }
  build(name, { cast = true, receive = true, maxDistance = Infinity } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const d of this.data.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", d.p.attribute(3));
      g.setAttribute("normal", d.n.attribute(3));
      g.setAttribute("uv", d.uv.attribute(2));
      g.setAttribute("color", d.c.attribute(3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.materials[d.material]);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      mesh.userData = {
        cell: [d.cx, d.cz],
        maxDistance,
        center: [(d.cx + 0.5) * this.size, (d.cz + 0.5) * this.size],
      };
      group.add(mesh);
    }
    this.data.clear();
    this.last = null;
    return group;
  }
}
export function hash(value) {
  let h = 2166136261;
  for (const ch of String(value)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export function rand(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function center(polygon) {
  let x = 0,
    z = 0;
  for (const p of polygon) {
    x += p[0];
    z += p[1];
  }
  return [x / polygon.length, z / polygon.length];
}
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
