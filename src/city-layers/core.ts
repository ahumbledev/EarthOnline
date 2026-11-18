/** Parts of the base city layer that need neither a renderer nor the DOM. */
export type Triple = readonly [number, number, number];
/** A source object inside a tile; legacy layout-2 packages omit the fourth field. */
export type TileObject = readonly [id: string, start: number, count: number, infrastructure?: boolean];

/**
 * Where the sun stands along the day's arc, 0 at sunrise and 1 at sunset. The
 * light map records, for every texel, the stretch of this arc during which the
 * sun reaches it; `arc` is the list of directions that stretch was sampled at.
 */
export function sunArcPosition(arc: readonly Triple[], direction: Triple): number {
  if (arc.length < 2) return 0.5;
  const dot = (a: Triple) => a[0] * direction[0] + a[1] * direction[1] + a[2] * direction[2];
  let best = 0, bestDot = -Infinity;
  arc.forEach((sample, index) => { const value = dot(sample); if (value > bestDot) { bestDot = value; best = index; } });
  const before = best > 0 ? dot(arc[best - 1]) : -Infinity, after = best < arc.length - 1 ? dot(arc[best + 1]) : -Infinity;
  if (before === -Infinity && after === -Infinity) return (best + 0.5) / arc.length;
  const other = after >= before ? best + 1 : best - 1;
  const angle = (value: number) => Math.acos(Math.min(1, Math.max(-1, value)));
  const near = angle(bestDot), far = angle(dot(arc[other]));
  return (best + 0.5 + (other - best) * (near / Math.max(1e-9, near + far))) / arc.length;
}

/**
 * The triangles of a tile without the buildings in `skipped`. Returns the
 * original array when nothing is skipped, so an untouched tile keeps its index.
 */
export function keptIndex<T extends Uint16Array | Uint32Array>(source: T, objects: readonly TileObject[], skipped: ReadonlySet<string>): T {
  if (!objects.some(([id]) => skipped.has(id))) return source;
  const kept = new (source.constructor as { new(length: number): T })(source.length);
  let cursor = 0;
  for (const [id, start, count] of objects) if (!skipped.has(id)) { kept.set(source.subarray(start, start + count), cursor); cursor += count; }
  return kept.slice(0, cursor) as T;
}

/** What is loaded for one tile: the full tile, its far tier, or neither. */
export interface TileLevels { near: boolean; far: boolean }
export interface TileDistances {
  /** The full tile is used inside this ground distance; it is let go `hysteresis` further out. */
  near: number;
  /** Nothing is loaded beyond this distance; a loaded tile is let go 25% further out. */
  far: number;
  hysteresis: number;
}

/**
 * Which levels a tile should hold at `distance`, given what it holds now.
 * A tile without a far tier uses the full tile out to the far distance. The
 * far tier is kept while the full tile is in use, so stepping back out of the
 * near ring never shows a hole while the far file loads again.
 */
export function wantedTileLevels(distance: number, held: TileLevels, hasFarTier: boolean, distances: TileDistances): TileLevels {
  const reach = held.near || held.far ? distances.far * 1.25 : distances.far;
  if (distance >= reach) return { near: false, far: false };
  if (!hasFarTier) return { near: true, far: false };
  const ring = held.near ? distances.near + distances.hysteresis : distances.near;
  return { near: distance < ring, far: true };
}

/** Infrastructure is source metadata, independent of how a city formats its ids. */
export const isInfrastructure = (object: TileObject) => object[3] === true;

/** Old Hong Kong tiles encode infrastructure as style 6; never infer it from an id. */
export function withInfrastructure(objects: readonly TileObject[], styleAtIndex: (index: number) => number): TileObject[] {
  return objects.map(object => object[3] === undefined
    ? [object[0], object[1], object[2], styleAtIndex(object[1]) === 6]
    : object);
}
