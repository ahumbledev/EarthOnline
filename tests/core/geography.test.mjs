import test from 'node:test';
import assert from 'node:assert/strict';
import { toLocal, fromLocal, sampleTerrainHeight, sampleRegionGroundHeight, pointInPolygon, distanceToPolyline } from '../../src/world/geography.ts';

const origin = { longitude: 10.0, latitude: 22.0, elevation: 37.5 };
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('WGS84/ENU round-trips the test origin and its one-kilometre region', () => {
  for (const axis of toLocal(origin.longitude, origin.latitude, origin)) close(axis, 0, 1e-12);
  for (const [longitude, latitude] of [
    [origin.longitude, origin.latitude], [9.995, 21.996], [10.004, 22.005],
    [9.996, 22.004], [10.004, 21.996],
  ]) {
    const [x, z] = toLocal(longitude, latitude, origin);
    const restored = fromLocal(x, z, origin);
    close(restored.longitude, longitude, 1e-10);
    close(restored.latitude, latitude, 1e-10);
  }
  for (const [x, z] of [[0, 0], [-500, -500], [500, -500], [-500, 500], [500, 500]]) {
    const restored = fromLocal(x, z, origin);
    const result = toLocal(restored.longitude, restored.latitude, origin);
    close(result[0], x, 1e-7); close(result[1], z, 1e-7);
  }
});

test('local north is negative Z and east is positive X without rotation or scale changes', () => {
  const east = toLocal(origin.longitude + .001, origin.latitude, origin);
  const north = toLocal(origin.longitude, origin.latitude + .001, origin);
  assert.ok(east[0] > 102 && east[0] < 104);
  assert.ok(Math.abs(east[1]) < .001);
  assert.ok(north[1] < -110 && north[1] > -112);
  close(north[0], 0, 1e-8);
});

test('horizontal projection has an independent WGS84 equatorial distance check', () => {
  const equator = { longitude: 0, latitude: 0, elevation: 9999 };
  // WGS84 semi-major axis 6,378,137 m; one equatorial longitude degree has
  // tangent-plane easting 111,313.83923667614 m, distinct from Web Mercator x.
  const degreeEast = toLocal(1, 0, equator);
  close(degreeEast[0], 111_313.83923667614, 1e-7); close(degreeEast[1], 0);
  // The surface arc is 1,000 m; its local ENU horizontal projection is shorter
  // by ~4 micrometres. This checks metre units without changing a scene scale.
  const kilometre = toLocal(1000 / 6_378_137 * 180 / Math.PI, 0, equator);
  close(kilometre[0], 1000, .00001);
  close(fromLocal(degreeEast[0], degreeEast[1], equator).longitude, 1, 1e-11);
});

test('DSM origin elevation never becomes the ellipsoidal height of horizontal projection', () => {
  const low = { ...origin, elevation: -400 }, high = { ...origin, elevation: 4000 };
  assert.deepEqual(toLocal(10.004, 22.003, low), toLocal(10.004, 22.003, high));
  assert.deepEqual(fromLocal(400, -350, low), fromLocal(400, -350, high));
});

test('projection rejects invalid coordinates and an inverse beyond the local tangent patch', () => {
  for (const [lon, lat] of [[NaN, 22], [114, Infinity], [181, 0], [0, -91]]) {
    assert.throws(() => toLocal(lon, lat, origin), RangeError);
  }
  assert.throws(() => fromLocal(NaN, 0, origin), RangeError);
  assert.throws(() => fromLocal(20_000_000, 0, origin), RangeError);
  assert.throws(() => fromLocal(1e308, 0, origin), RangeError);
});

const terrain = (overrides = {}) => ({
  columns: 3, rows: 2,
  bounds: { minX: -10, maxX: 10, minZ: -5, maxZ: 5 },
  heights: [0, 10, 20, 100, 110, 120], // northern row then southern row
  sourceResolutionMetres: 30, kind: 'DSM', sourceId: 'fixture-dem', ...overrides,
});

test('DEM bilinear interpolation respects row-major north-to-south order and local-y values', () => {
  const grid = terrain();
  close(sampleTerrainHeight(grid, -10, -5), 0);
  close(sampleTerrainHeight(grid, 0, -5), 10);
  close(sampleTerrainHeight(grid, 10, 5), 120);
  close(sampleTerrainHeight(grid, 0, 0), 60);
  close(sampleTerrainHeight(grid, -5, -2.5), 30);
  const region = { origin, terrain: grid, verticalDatum: 'fixture DSM datum, local-y offset already applied' };
  close(sampleRegionGroundHeight(region, 0, 0), 60, 1e-12);
});

test('DEM edges clamp outside queries and single-row/column grids remain usable', () => {
  const grid = terrain();
  close(sampleTerrainHeight(grid, -100, 0), 50);
  close(sampleTerrainHeight(grid, 100, 100), 120);
  close(sampleTerrainHeight(grid, 0, -100), 10);
  close(sampleTerrainHeight(terrain({ columns: 1, rows: 2, heights: [3, 13] }), 0, 0), 8);
  close(sampleTerrainHeight(terrain({ columns: 2, rows: 1, heights: [-4, 8] }), 0, 0), 2);
  close(sampleTerrainHeight(terrain({ columns: 1, rows: 1, heights: [-7] }), 100, -100), -7);
});

test('DEM does not silently replace invalid dimensions, nodata or missing samples with flat ground', () => {
  for (const grid of [
    terrain({ columns: 0 }), terrain({ rows: 1.5 }), terrain({ heights: [1, 2] }),
    terrain({ bounds: { minX: 0, maxX: 0, minZ: -5, maxZ: 5 } }),
    terrain({ heights: [NaN, 10, 20, 100, 110, 120] }),
  ]) assert.throws(() => sampleTerrainHeight(grid, -10, -5), RangeError);
  assert.throws(() => sampleTerrainHeight(terrain(), Infinity, 0), RangeError);
});

test('polygon containment respects holes, boundaries and either ring winding', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]];
  for (const polygon of [[outer, hole], [[...outer].reverse(), [...hole].reverse()], [outer.slice(0, -1), hole.slice(0, -1)]]) {
    assert.equal(pointInPolygon([1, 1], polygon), true);
    assert.equal(pointInPolygon([5, 5], polygon), false);
    assert.equal(pointInPolygon([3, 5], polygon), false, 'hole boundary is excluded');
    assert.equal(pointInPolygon([0, 5], polygon), true, 'outer boundary is included');
    assert.equal(pointInPolygon([10, 10], polygon), true);
    assert.equal(pointInPolygon([-1, 5], polygon), false);
  }
  assert.equal(pointInPolygon([1, 1], []), false);
  assert.equal(pointInPolygon([1, 1], [[[0, 0], [1, 0]]]), false);
});

test('polygon containment handles concave outlines rather than their bounding rectangle', () => {
  const lShape = [[[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]];
  assert.equal(pointInPolygon([1, 5], lShape), true);
  assert.equal(pointInPolygon([5, 1], lShape), true);
  assert.equal(pointInPolygon([5, 5], lShape), false);
});

test('road centreline distances include endpoints, zero segments and empty lines', () => {
  close(distanceToPolyline([5, 3], [[0, 0], [10, 0], [10, 10]]), 3);
  close(distanceToPolyline([-3, -4], [[0, 0], [10, 0]]), 5);
  close(distanceToPolyline([3, 4], [[0, 0], [0, 0]]), 5);
  close(distanceToPolyline([3, 4], [[0, 0]]), 5);
  assert.equal(distanceToPolyline([3, 4], []), Infinity);
});
