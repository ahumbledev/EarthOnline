import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyPose, blendPose, capturePose, createHomeCameraRig, FOLLOW_FOV, ISO_FOV, ISO_PITCH, isometricPose, TRANSITION_SECONDS, wallsFacingCamera } from '../../src/home/camera.ts';
import { aimPickup, aimPlacement } from '../../src/home/carry.ts';

const bounds = { width: 7.2, depth: 5.6, height: 2.75 };

test('the isometric pose sits above a corner at the fixed pitch and frames the whole room', () => {
  for (const quarter of [0, 1, 2, 3]) {
    const { position, target, distance } = isometricPose(bounds, quarter, ISO_FOV.default, 16 / 9);
    assert.ok(position.y > bounds.height * 2, `quarter ${quarter} looks down from well above the ceiling`);
    const elevation = Math.asin((position.y - target.y) / distance);
    assert.ok(Math.abs(elevation - ISO_PITCH) < 1e-6);
    assert.ok(Math.abs(position.x) > bounds.width / 2 && Math.abs(position.z) > bounds.depth / 2, 'the camera is outside the walls');
    // Every corner of the room projects inside the field of view.
    const camera = new THREE.PerspectiveCamera(ISO_FOV.default, 16 / 9, .1, 100);
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld();
    for (const x of [-1, 1]) for (const y of [0, 1]) for (const z of [-1, 1]) {
      const corner = new THREE.Vector3(x * bounds.width / 2, y * bounds.height, z * bounds.depth / 2).project(camera);
      assert.ok(Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1, `corner ${[x, y, z]} framed in quarter ${quarter}`);
    }
  }
  const wide = isometricPose(bounds, 0, ISO_FOV.default, 2.4), tall = isometricPose(bounds, 0, ISO_FOV.default, .7);
  assert.ok(tall.distance > wide.distance, 'a portrait viewport backs the camera off further');
});

test('walls between the camera and the room are the ones cut away', () => {
  const quarters = [0, 1, 2, 3].map(quarter => [...wallsFacingCamera(bounds, isometricPose(bounds, quarter, 16, 1.6).position)].sort());
  assert.deepEqual(quarters[1], ['back', 'ceiling', 'right']);
  assert.deepEqual(quarters[3], ['ceiling', 'front', 'left']);
  assert.equal(new Set(quarters.map(String)).size, 4, 'each quarter cuts a different pair of walls');
  assert.deepEqual([...wallsFacingCamera(bounds, new THREE.Vector3(1, 1.4, 1))], [], 'a walking camera inside the room removes nothing');
});

test('poses blend with eased endpoints and the rig eases between the two views', () => {
  const camera = new THREE.PerspectiveCamera(FOLLOW_FOV, 16 / 9, .05, 60);
  camera.position.set(1, 1.5, 3); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
  const from = capturePose(camera);
  const to = { position: new THREE.Vector3(10, 20, 10), quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(-1, .5, 0)), fov: 16 };
  const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 0 };
  blendPose(from, to, 0, out); assert.ok(out.position.distanceTo(from.position) < 1e-9 && out.fov === FOLLOW_FOV);
  blendPose(from, to, 1, out); assert.ok(out.position.distanceTo(to.position) < 1e-9 && out.fov === 16);
  blendPose(from, to, .25, out); assert.ok(out.position.distanceTo(from.position) < out.position.distanceTo(to.position), 'ease-in starts slowly');
  const follow = { armLength: 3, snaps: 0, snap() { this.snaps++; }, update(target, _dt, frame) { target.position.set(frame.feet.x, frame.height + frame.feet.y, frame.feet.z + frame.distance); target.lookAt(frame.feet.x, frame.height, frame.feet.z); target.updateMatrixWorld(); } };
  const rig = createHomeCameraRig(camera, follow, bounds);
  const frame = { feet: new THREE.Vector3(1, 0, 1), grounded: true, yaw: 0, pitch: .3, distance: 3, height: 1.3 };
  rig.update(1 / 60, frame);
  assert.equal(rig.mode, 'follow'); assert.ok(Math.abs(camera.position.z - 4) < 1e-6);
  rig.setMode('isometric');
  assert.ok(rig.busy && rig.presenting === 'isometric');
  const advance = seconds => { for (let t = 0; t < seconds - 1e-9; t += 1 / 60) rig.update(1 / 60, frame); };
  advance(TRANSITION_SECONDS / 2);
  assert.ok(rig.busy && camera.fov < FOLLOW_FOV && camera.fov > ISO_FOV.default && camera.position.y > 1.5, 'mid-transition the camera is on its way up');
  advance(TRANSITION_SECONDS);
  assert.ok(!rig.busy && rig.mode === 'isometric' && camera.fov === ISO_FOV.default);
  const iso = isometricPose(bounds, rig.quarter, rig.isoFov, camera.aspect);
  assert.ok(camera.position.distanceTo(iso.position) < 1e-6);
  rig.rotate(1); rig.update(0, frame);
  assert.ok(camera.position.distanceTo(iso.position) > 1, 'a quarter turn moves the camera to the next corner');
  rig.zoom(-4); assert.equal(rig.isoFov, 12); rig.zoom(-100); assert.equal(rig.isoFov, ISO_FOV.min); rig.zoom(100); assert.equal(rig.isoFov, ISO_FOV.max);
  rig.setMode('follow');
  assert.equal(follow.snaps, 1, 'returning re-snaps the follow camera behind the resident');
  advance(TRANSITION_SECONDS + .05);
  assert.ok(!rig.busy && rig.mode === 'follow' && camera.fov === FOLLOW_FOV && Math.abs(camera.position.z - 4) < 1e-6);
  rig.setMode('isometric', true); assert.equal(rig.mode, 'isometric'); assert.ok(!rig.busy);
  applyPose(camera, from); assert.equal(camera.fov, FOLLOW_FOV);
});

const item = (id, w, d, h, extra = {}) => ({ id, name: id, category: 'living', mount: 'floor', size: { width: w, depth: d, height: h }, pack: 't', node: id, ...extra });
const table = item('table', 1.2, .6, .45, { surface: { height: .45, inset: .04 } });
const furniture = [{ definition: table, placement: { id: 't', item: 'table', x: 1, y: 0, z: 0, yaw: 0 } }];

test('aiming at a table top lands on it, past its edge lands on the floor, and out of reach yields nothing', () => {
  const ray = (origin, target) => ({ origin: new THREE.Vector3(...origin), direction: new THREE.Vector3(...target).sub(new THREE.Vector3(...origin)).normalize() });
  const onTable = aimPlacement(ray([1, 1.3, 1.2], [1, .45, .1]), furniture, bounds);
  assert.ok(onTable && Math.abs(onTable.x - 1) < 1e-6 && Math.abs(onTable.z - .1) < 1e-6 && onTable.support.on === 't' && onTable.support.height === .45 && onTable.support.stable);
  const edge = aimPlacement(ray([1, 1.3, 1.2], [1.57, .45, .1]), furniture, bounds);
  assert.ok(edge && edge.support.on === 't' && !edge.support.stable, 'near the edge the spot is unstable');
  const floor = aimPlacement(ray([1, 1.3, 1.2], [1, 0, .6]), furniture, bounds);
  assert.ok(floor && floor.support.height === 0 && floor.support.on === undefined);
  assert.equal(aimPlacement(ray([1, 1.3, 1.2], [1, 1.4, 0]), furniture, bounds), undefined, 'looking up finds nothing');
  assert.equal(aimPlacement(ray([1, 1.3, 1.2], [1, 0, -4]), furniture, bounds), undefined, 'too far');
  assert.equal(aimPlacement(ray([3.4, 1.3, 2.7], [3.65, 0, 2.9]), furniture, bounds), undefined, 'outside the room');
});

test('picking up targets the nearest small item along the view within reach', () => {
  // 'behind' sits exactly on the line from the eye through the near mug's centre.
  const items = [
    { placement: { id: 'near', item: 'mug', x: 1, y: .45, z: .2, yaw: 0 }, radius: .05, height: .13 },
    { placement: { id: 'behind', item: 'mug', x: 1, y: .186, z: -.3, yaw: 0 }, radius: .05, height: .13 },
    { placement: { id: 'far', item: 'mug', x: 1, y: .45, z: -.9, yaw: 0 }, radius: .05, height: .13 },
    { placement: { id: 'aside', item: 'mug', x: 1.6, y: .45, z: .2, yaw: 0 }, radius: .05, height: .13 },
  ];
  const origin = new THREE.Vector3(1, 1.2, 1.5);
  const aim = target => ({ origin, direction: target.clone().sub(origin).normalize() });
  assert.equal(aimPickup(aim(new THREE.Vector3(1, .515, .2)), items)?.placement.id, 'near', 'the nearer mug blocks the one behind it');
  assert.equal(aimPickup(aim(new THREE.Vector3(1, .515, -.9)), items)?.placement.id, 'far', 'a view passing above the near mug reaches the far one');
  assert.equal(aimPickup(aim(new THREE.Vector3(1.6, .5, .2)), items)?.placement.id, 'aside');
  assert.equal(aimPickup(aim(new THREE.Vector3(2.5, .5, .2)), items), undefined, 'looking beside everything');
  assert.equal(aimPickup(aim(new THREE.Vector3(1, .5, .2)), items, .5), undefined, 'out of reach');
});
