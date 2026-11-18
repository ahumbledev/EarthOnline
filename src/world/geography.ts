import type { GeographicRegion, MapPoint, RegionOrigin } from './region.ts';

const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const RADIANS = Math.PI / 180;
type Point = readonly [number, number];
type Terrain = GeographicRegion['terrain'];

function geographicAngles(longitude: number, latitude: number) {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError('Expected finite WGS84 longitude/latitude in degrees.');
  }
  return [longitude * RADIANS, latitude * RADIANS] as const;
}

/** Horizontal projection always uses ellipsoid h=0. RegionOrigin.elevation is
 * a DSM/datum elevation used by the importer, never an ellipsoidal height. */
function ellipsoidSurface(longitude: number, latitude: number) {
  const [lon, lat] = geographicAngles(longitude, latitude);
  const sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const radius = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [radius * cosLat * Math.cos(lon), radius * cosLat * Math.sin(lon), radius * (1 - WGS84_E2) * sinLat] as const;
}

function frame(origin: RegionOrigin) {
  const [lon, lat] = geographicAngles(origin.longitude, origin.latitude);
  const cosLon = Math.cos(lon), sinLon = Math.sin(lon), cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  return {
    ecef: ellipsoidSurface(origin.longitude, origin.latitude),
    east: [-sinLon, cosLon, 0] as const,
    north: [-sinLat * cosLon, -sinLat * sinLon, cosLat] as const,
    up: [cosLat * cosLon, cosLat * sinLon, sinLat] as const,
  };
}

/** WGS84 degrees → local metres (+X east, +Z south). Vertical y is separate:
 * the importer stores DSM elevation minus origin.elevation in terrain.heights.
 * ENU reference: https://proj.org/en/stable/operations/conversions/topocentric.html */
export function toLocal(longitude: number, latitude: number, origin: RegionOrigin): MapPoint {
  const value = ellipsoidSurface(longitude, latitude), basis = frame(origin);
  const dx = value[0] - basis.ecef[0], dy = value[1] - basis.ecef[1], dz = value[2] - basis.ecef[2];
  return [
    dx * basis.east[0] + dy * basis.east[1],
    -(dx * basis.north[0] + dy * basis.north[1] + dz * basis.north[2]),
  ];
}

/** Inverse on the near-side WGS84 ellipsoid, suitable for a local region.
 * E/N alone omit the small ENU curvature height. Intersect the ENU vertical
 * line with h=0 instead of assuming U=0 and introducing a round-trip drift. */
export function fromLocal(x: number, z: number, origin: RegionOrigin): { longitude: number; latitude: number } {
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new RangeError('Expected finite local metres.');
  const basis = frame(origin);
  const point = basis.ecef.map((value, i) => value + x * basis.east[i] - z * basis.north[i]);
  const inverseAxesSquared = [1 / (WGS84_A * WGS84_A), 1 / (WGS84_A * WGS84_A), 1 / (WGS84_B * WGS84_B)];
  let a = 0, b = 0, c = -1;
  for (let i = 0; i < 3; ++i) {
    a += basis.up[i] * basis.up[i] * inverseAxesSquared[i];
    b += 2 * point[i] * basis.up[i] * inverseAxesSquared[i];
    c += point[i] * point[i] * inverseAxesSquared[i];
  }
  const discriminant = b * b - 4 * a * c;
  if (!Number.isFinite(discriminant) || discriminant < 0) throw new RangeError('Local point is outside the near-side WGS84 tangent region.');
  // Stable near-origin root of a*u²+b*u+c=0; avoids cancellation of -b+sqrt(d).
  const up = -2 * c / (b + Math.sqrt(discriminant));
  const px = point[0] + up * basis.up[0], py = point[1] + up * basis.up[1], pz = point[2] + up * basis.up[2];
  return {
    longitude: Math.atan2(py, px) / RADIANS,
    latitude: Math.atan2(pz / (1 - WGS84_E2), Math.hypot(px, py)) / RADIANS,
  };
}

/** Bilinear local-y sampling. Row zero is minZ (north); columns grow east.
 * Outside queries clamp to the nearest raster edge. Invalid/missing samples
 * fail explicitly: importers must resolve source nodata before shipping a pack.
 * These heights already exclude origin.elevation; never subtract it twice. */
export function sampleTerrainHeight(terrain: Terrain, x: number, z: number): number {
  const { columns, rows, heights, bounds } = terrain;
  if (!Number.isFinite(x) || !Number.isFinite(z)
      || !Number.isInteger(columns) || columns < 1 || !Number.isInteger(rows) || rows < 1
      || heights.length !== columns * rows
      || ![bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ].every(Number.isFinite)
      || bounds.maxX <= bounds.minX || bounds.maxZ <= bounds.minZ) {
    throw new RangeError('Invalid terrain grid or sampling coordinate.');
  }
  const column = Math.max(0, Math.min(1, (x - bounds.minX) / (bounds.maxX - bounds.minX))) * (columns - 1);
  const row = Math.max(0, Math.min(1, (z - bounds.minZ) / (bounds.maxZ - bounds.minZ))) * (rows - 1);
  const left = Math.floor(column), top = Math.floor(row);
  const right = Math.min(columns - 1, left + 1), bottom = Math.min(rows - 1, top + 1);
  const a = heights[top * columns + left], b = heights[top * columns + right];
  const c = heights[bottom * columns + left], d = heights[bottom * columns + right];
  if (![a, b, c, d].every(Number.isFinite)) throw new RangeError('Terrain sample is missing or non-finite.');
  const tx = column - left, tz = row - top;
  const north = a * (1 - tx) + b * tx, south = c * (1 - tx) + d * tx;
  return north * (1 - tz) + south * tz;
}

/** Raw region DSM/local-y height. Road grading and building foundations, when
 * authored, belong in a separate override layer rather than changing this data. */
export function sampleRegionGroundHeight(region: Pick<GeographicRegion, 'terrain'>, x: number, z: number): number {
  return sampleTerrainHeight(region.terrain, x, z);
}

function finitePoint(point: Point) {
  if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw new RangeError('Expected finite local polygon/polyline coordinates.');
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dz = b[1] - a[1], lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSquared)) : 0;
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
}

/** Returns outside / boundary / inside. Closed and unclosed rings and either
 * winding are accepted; the tolerance is in local metres, never degrees. */
function ringLocation(point: Point, ring: readonly Point[]): 'outside' | 'boundary' | 'inside' {
  if (ring.length < 3) return 'outside';
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i]; finitePoint(a); finitePoint(b);
    if (segmentDistance(point, a, b) <= 1e-8) return 'boundary';
    if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

/** Polygon outer ring followed by holes. Outer boundary counts as inside;
 * holes, including their boundaries, count as outside. Multipolygons can use
 * polygons.some(polygon => pointInPolygon(point, polygon)). */
export function pointInPolygon(point: Point, polygon: readonly (readonly Point[])[]): boolean {
  finitePoint(point);
  if (!polygon.length || ringLocation(point, polygon[0]) === 'outside') return false;
  return polygon.slice(1).every(hole => ringLocation(point, hole) === 'outside');
}

/** Distance to a road centreline in metres. An empty line is infinitely far;
 * a singleton is a point, and repeated coordinates form harmless zero segments. */
export function distanceToPolyline(point: Point, points: readonly Point[]): number {
  finitePoint(point);
  for (const vertex of points) finitePoint(vertex);
  if (!points.length) return Infinity;
  if (points.length === 1) return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  let minimum = Infinity;
  for (let i = 1; i < points.length; ++i) minimum = Math.min(minimum, segmentDistance(point, points[i - 1], points[i]));
  return minimum;
}
