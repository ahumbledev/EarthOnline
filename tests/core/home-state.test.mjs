import test from 'node:test';
import assert from 'node:assert/strict';
import {
  carryPose, checkPlacement, cornersOverlap, createPlacementId, footprintCorners, nearestWallPose,
  placementLimit, restsOn, sanitizeHomeLayout, snapToWall, snapValue, snapYaw, supportAt, wallForYaw,
  canCarryItem, canDecorateItem, canTipItem, checkPlacementGroup, checkSupportedPlacement, placementBounds,
} from '../../src/home/state.ts';

const bounds = { width: 7, depth: 5.5, height: 2.8 };
const item = (id, mount, width, depth, height, extra = {}) => ({ id, name: id, category: 'living', mount, size: { width, depth, height }, pack: 'test', node: id, ...extra });
const couch = item('couch', 'floor', 2.2, .95, .85);
const table = item('table', 'floor', 1.2, .6, .45, { surface: { height: .45, inset: .04 } });
const rug = item('rug', 'floor', 2.4, 1.6, .02, { rug: true });
const picture = item('picture', 'wall', .6, .05, .45);
const mug = item('mug', 'small', .1, .1, .1, { physics: { kind: 'cylinder' }, mass: .3 });
const catalog = [couch, table, rug, picture, mug];
const at = (id, def, x, z, yaw = 0, y = 0, extra = {}) => ({ id, item: def.id, x, y, z, yaw, ...extra });
const placed = (def, placement) => ({ definition: def, placement });

test('values snap to a 5 cm grid and yaw to 15 degree steps without negative zero', () => {
  assert.equal(snapValue(1.126), 1.15);
  assert.equal(snapValue(-.01), 0);
  assert.equal(snapYaw(Math.PI / 12 * 2.4), Math.PI / 6);
  assert.equal(snapYaw(-Math.PI / 24), 0);
  assert.throws(() => snapValue(NaN), RangeError);
});

test('rotated footprints are measured from the base centre and overlap only when interiors cross', () => {
  const square = footprintCorners(couch, { x: 0, z: 0, yaw: 0 });
  assert.deepEqual(square.map(c => c.map(v => Number(v.toFixed(3)))), [[-1.1, -.475], [1.1, -.475], [1.1, .475], [-1.1, .475]]);
  const turned = footprintCorners(couch, { x: 0, z: 0, yaw: Math.PI / 2 });
  assert.ok(Math.abs(Math.max(...turned.map(c => c[0])) - .475) < 1e-6, 'a quarter turn swaps width and depth');
  assert.equal(cornersOverlap(square, footprintCorners(table, { x: 1.7, z: 0, yaw: 0 })), false, 'edge contact is not overlap');
  assert.equal(cornersOverlap(square, footprintCorners(table, { x: 1.65, z: 0, yaw: 0 })), true);
  assert.equal(cornersOverlap(square, footprintCorners(table, { x: 1.1, z: .75, yaw: Math.PI / 4 })), true, 'diagonal corners overlap');
  assert.equal(cornersOverlap(square, footprintCorners(table, { x: 1.2, z: .9, yaw: Math.PI / 4 })), false, 'a diagonal just past the corner does not');
});

test('floor furniture must fit the room, may share rugs, and rejects overlapping furniture', () => {
  const others = [placed(rug, at('r', rug, 0, 0)), placed(table, at('t', table, 0, 0))];
  assert.deepEqual(checkPlacement(couch, at('c', couch, 0, 1.2), bounds, others), { ok: true });
  assert.equal(checkPlacement(couch, at('c', couch, 0, .6), bounds, others).problem, 'overlap');
  assert.equal(checkPlacement(couch, at('c', couch, 2.5, 0), bounds, []).problem, 'outside-room');
  assert.equal(checkPlacement(couch, at('c', couch, 0, 0, 0, .2), bounds, []).problem, 'invalid-number');
  assert.equal(checkPlacement(couch, at('c', couch, NaN, 0), bounds, []).problem, 'invalid-number');
  assert.equal(checkPlacement(table, at('t', table, 0, 0), bounds, others).ok, true, 'the moved instance ignores itself');
});

test('wall items hang on a wall facing the room within the wall height', () => {
  assert.equal(wallForYaw(0), 'back'); assert.equal(wallForYaw(Math.PI / 2), 'left'); assert.equal(wallForYaw(Math.PI * 1.5), 'right');
  assert.equal(wallForYaw(.3), undefined);
  assert.deepEqual(nearestWallPose(bounds, -3.3, .4), { x: -3.5, z: .4, yaw: Math.PI / 2 });
  assert.deepEqual(checkPlacement(picture, at('p', picture, 1, -2.75, 0, 1.4), bounds, []), { ok: true });
  assert.equal(checkPlacement(picture, at('p', picture, 1, -2.5, 0, 1.4), bounds, []).problem, 'not-on-wall');
  assert.equal(checkPlacement(picture, at('p', picture, 1, -2.75, .4, 1.4), bounds, []).problem, 'not-on-wall');
  assert.equal(checkPlacement(picture, at('p', picture, 1, -2.75, 0, 2.5), bounds, []).problem, 'wall-height');
  const neighbour = placed(picture, at('q', picture, 1.3, -2.75, 0, 1.4));
  assert.equal(checkPlacement(picture, at('p', picture, 1, -2.75, 0, 1.4), bounds, [neighbour]).problem, 'overlap');
  assert.equal(checkPlacement(picture, at('p', picture, 1, -2.75, 0, 1.9), bounds, [neighbour]).ok, true, 'stacked above is fine');
});

test('furniture near a wall is squared up and pushed flush, including into corners', () => {
  const snapped = snapToWall(couch, at('c', couch, 0, -2.1, .1), bounds);
  assert.equal(snapped.yaw, 0);
  assert.equal(snapped.z, -2.275);
  const corner = snapToWall(table, at('t', table, -3, -2.3, Math.PI / 2 + .05), bounds);
  assert.equal(corner.yaw, Math.PI / 2);
  assert.ok(Math.abs(corner.x - -3.2) < 1e-6 && Math.abs(corner.z - -2.15) < 1e-6, `${corner.x}, ${corner.z}`);
  const far = snapToWall(couch, at('c', couch, 0, 0, 0), bounds);
  assert.equal(far.z, 0, 'the room centre is untouched');
});

test('small items rest on the highest furniture top under them and report instability near edges', () => {
  const furniture = [placed(table, at('t', table, 1, 0, 0)), placed(rug, at('r', rug, 1, 0))];
  assert.deepEqual(supportAt(1, 0, furniture), { on: 't', height: .45, stable: true });
  assert.deepEqual(supportAt(1.58, 0, furniture), { on: 't', height: .45, stable: false });
  assert.deepEqual(supportAt(3, 0, furniture), { height: 0, stable: true });
  assert.equal(checkPlacement(mug, at('m', mug, 1, 0, 0, .45), bounds, furniture).ok, true);
  assert.equal(checkPlacement(mug, at('m', mug, 1, 0, 0, 3), bounds, furniture).problem, 'outside-room');
  assert.equal(restsOn(at('m', mug, 1.2, .1, 0, .46), furniture[0]), true);
  assert.equal(restsOn(at('m', mug, 1.2, .1, 0, 0), furniture[0]), false, 'under the table is not on it');
});

test('moving a table carries the mug sitting on it, rotating about the table origin', () => {
  const before = { x: 1, z: 0, yaw: 0 }, after = { x: 2, z: 1, yaw: Math.PI / 2 };
  const carried = carryPose(before, after, at('m', mug, 1.3, 0, 0, .45, { tilt: [0, 0, 0, 1] }));
  assert.ok(Math.abs(carried.x - 2) < 1e-6 && Math.abs(carried.z - .7) < 1e-6, `${carried.x}, ${carried.z}`);
  assert.ok(Math.abs(carried.yaw - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(carried.tilt[1] - Math.SQRT1_2) < 1e-6 && Math.abs(carried.tilt[3] - Math.SQRT1_2) < 1e-6);
});

test('righting a fallen cabinet preserves the full local pose of every rider', () => {
  const before = { x: 1, y: .2, z: 2, yaw: 0, tilt: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  const after = { x: -1, y: 0, z: 0, yaw: Math.PI / 2 };
  // A rider at local (.1, .5, .2), sharing the cabinet's orientation.
  const rider = at('same-mug', mug, .5, 2.2, 0, .3, { tilt: [...before.tilt] });
  const moved = carryPose(before, after, rider);
  assert.equal(moved.id, 'same-mug');
  assert.ok(Math.abs(moved.x + .8) < 1e-8 && Math.abs(moved.y - .5) < 1e-8 && Math.abs(moved.z + .1) < 1e-8);
  assert.ok(Math.abs(moved.tilt[0]) < 1e-8 && Math.abs(moved.tilt[2]) < 1e-8);
  assert.ok(Math.abs(moved.tilt[1] - Math.SQRT1_2) < 1e-8 && Math.abs(moved.tilt[3] - Math.SQRT1_2) < 1e-8);
  const back = carryPose(after, before, moved);
  for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(back[key] - rider[key]) < 1e-8, key);
  assert.deepEqual(rider.tilt, before.tilt, 'the original saved pose was not mutated');
});

test('stale saves keep valid placements in order and drop unknown, malformed, conflicting or excess ones', () => {
  const saved = { version: 1, placements: [
    at('a', couch, 0, 2),
    at('b', couch, 0, 2),
    { id: 'c', item: 'lamp', x: 0, y: 0, z: 0, yaw: 0 },
    at('d', table, 0, -1, .2),
    at('e', mug, 0.1, -1, 0, .45, { tilt: [0, 0, 0, 1] }),
    at('f', mug, 0, -1, 0, NaN),
    { id: 'a', item: 'mug', x: 0, y: 0, z: 0, yaw: 0 },
    at('g', picture, 0, -2.75, 0, 1.3),
    { id: 'bad id!', item: 'mug', x: 0, y: 0, z: 0, yaw: 0 },
  ] };
  const result = sanitizeHomeLayout(saved, catalog, bounds);
  assert.deepEqual(result.state.placements.map(placement => placement.id), ['a', 'd', 'e', 'g']);
  assert.equal(result.dropped, 5);
  assert.equal(saved.placements[3].yaw, .2, 'input is not mutated');
  assert.deepEqual(sanitizeHomeLayout(JSON.parse(JSON.stringify(result.state)), catalog, bounds).state, result.state);
  assert.deepEqual(sanitizeHomeLayout(undefined, catalog, bounds), { state: { version: 1, placements: [] }, dropped: 0 });
  const many = { version: 1, placements: Array.from({ length: 70 }, (_, index) => at(`m${index}`, mug, (index % 10) * .2 - 1, Math.floor(index / 10) * .2, 0, 0)) };
  const limited = sanitizeHomeLayout(many, catalog, bounds, { placements: 160, small: 60, perItem: 100 });
  assert.equal(limited.state.placements.length, 60);
});

test('placement limits apply per item, per layout and to small physical items', () => {
  const state = { version: 1, placements: Array.from({ length: 16 }, (_, index) => at(`c${index}`, couch, index, 0)) };
  assert.equal(placementLimit(state, couch, catalog), 'perItem');
  assert.equal(placementLimit(state, table, catalog), undefined);
  const smalls = { version: 1, placements: Array.from({ length: 60 }, (_, index) => at(`s${index}`, mug, 0, 0)) };
  assert.equal(placementLimit(smalls, mug, catalog, { placements: 160, small: 60, perItem: 100 }), 'small');
  assert.equal(placementLimit(smalls, couch, catalog, { placements: 160, small: 60, perItem: 100 }), undefined);
  assert.match(createPlacementId(() => .5), /^[a-z0-9]{8}$/);
  assert.equal(createPlacementId(() => 1).length, 8);
});

test('gameplay tags control carrying and decorating independently of mounting', () => {
  assert.equal(canCarryItem(mug), true);
  assert.equal(canCarryItem({ ...mug, tags: ['vehicle'], capabilities: { carry: true } }), false);
  assert.equal(canCarryItem({ ...mug, tags: ['furniture'], capabilities: { carry: true } }), false);
  assert.equal(canDecorateItem(couch), true);
  assert.equal(canDecorateItem({ ...mug, capabilities: { decorate: true } }), false);
  assert.equal(canDecorateItem({ ...couch, capabilities: { decorate: false } }), false);
  assert.equal(canTipItem(couch), true);
  assert.equal(canTipItem(picture), false);
  assert.equal(canTipItem(rug), false);
  assert.equal(canTipItem({ ...couch, capabilities: { tip: false } }), false);
});

test('small placement rejects actual occupied height and other props but leaves shelf bays open', () => {
  const furniture = placed(table, at('t', table, 0, 0));
  assert.equal(checkPlacement(mug, at('m', mug, 0, 0, 0, .2), bounds, [furniture]).problem, 'overlap');
  assert.equal(checkPlacement(mug, at('m', mug, 0, 0, 0, .45), bounds, [furniture]).ok, true);
  assert.equal(checkPlacement(mug, at('m', mug, 0, 0, 0, .45), bounds,
    [furniture, placed(mug, at('other', mug, .03, 0, 0, .45))]).problem, 'overlap');
  const shelf = item('shelf', 'floor', .6, .6, 1, { surface: { height: 1 }, shelves: [
    { y: .1, minX: -.28, maxX: .28, minZ: -.28, maxZ: .28, clearance: .3, open: ['+z'] },
  ] });
  const cabinet = placed(shelf, at('cabinet', shelf, 0, 0));
  assert.equal(checkSupportedPlacement(mug, at('m', mug, 0, 0, 0, .1), bounds, [cabinet]).ok, true);
  const tall = { ...mug, size: { ...mug.size, height: .5 } };
  assert.equal(checkSupportedPlacement(tall, at('m', tall, 0, 0, 0, .1), bounds, [cabinet]).problem, 'clearance');
  assert.equal(checkSupportedPlacement(mug, at('m', mug, 1, 0, 0, 1), bounds, [cabinet]).problem, 'unsupported');
  assert.equal(checkPlacement(mug, at('m', mug, 1, 0, 0, 1), bounds, [cabinet]).ok, true, 'a held item can be in the air');
});

test('group placement checks the carried items as well as the furniture', () => {
  const group = [placed(table, at('table', table, 0, 0)), placed(mug, at('carried', mug, .2, 0, 0, .45))];
  const obstacle = placed(mug, at('obstacle', mug, .2, 0, 0, .45));
  assert.equal(checkPlacement(table, group[0].placement, bounds, [obstacle]).ok, true);
  assert.equal(checkPlacementGroup(group, bounds, [obstacle]).problem, 'overlap');
  assert.equal(checkPlacementGroup(group, bounds, []).ok, true);
});

test('a fallen cabinet keeps its physical pose and identity when a save is restored', () => {
  const cabinet = item('cabinet', 'floor', .4, .6, 2);
  const fallen = at('owned-cabinet', cabinet, 0, 0, 0, .2, { tilt: [0, 0, Math.SQRT1_2, Math.SQRT1_2] });
  const box = placementBounds(cabinet, fallen);
  assert.ok(Math.abs(box.min[0] + 2) < 1e-6 && Math.abs(box.min[1]) < 1e-6);
  assert.equal(checkPlacement(cabinet, fallen, bounds, []).ok, true);
  const result = sanitizeHomeLayout({ version: 1, placements: [fallen] }, [cabinet], bounds);
  assert.equal(result.dropped, 0);
  assert.deepEqual(result.state.placements, [fallen]);
  assert.equal(checkPlacement(cabinet, { ...fallen, x: -2 }, bounds, []).problem, 'outside-room', 'use the rotated extent, not the old upright footprint');
});
