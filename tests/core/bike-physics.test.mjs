import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerController } from '../../src/exploration/player.ts';
import { createBikePhysics } from '../../src/exploration/bike-physics.ts';

const idle = new THREE.Vector3();
function box(root, size, at) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size)); mesh.position.set(...at); root.add(mesh); return mesh; }
function floor(size = 250) { const root = new THREE.Group(); box(root, [size, .2, size], [0, -.1, 0]); return root; }
function advance(player, seconds, hz = 120) { for (let tick = 0; tick < Math.round(seconds * hz); tick++) player.update(1 / hz, idle, false, false); }
async function setup(environment = floor(), options = {}, playerAt = new THREE.Vector3(1.5, .03, 0)) {
  const player = await createPlayerController(environment, playerAt);
  const bike = player.attachPhysics((world, collider) => createBikePhysics(world, collider, { position: new THREE.Vector3(0, .06, 0), ...options }));
  advance(player, 1); return { player, bike };
}

test('bicycle starts smoothly, cruises at 27 km/h, coasts and brakes progressively without reversing', async () => {
  const { player, bike } = await setup();
  try {
    assert.ok(bike.grounded); assert.ok(Math.abs(bike.position.y) < .03);
    bike.setInput({ throttle: 1 }); advance(player, .1);
    assert.ok(bike.speedMps > 0 && bike.speedMps < .12, `soft initial pickup: ${bike.speedMps}`);
    advance(player, 4);
    assert.ok(bike.speedKph > 26 && bike.speedKph <= 27.1);
    assert.ok(bike.wheelRotation > 20 && bike.pedalPhase > 3);
    const moving = bike.speedMps; bike.setInput({}); advance(player, .5);
    assert.ok(bike.speedMps > moving - 1 && bike.speedMps < moving, 'released throttle coasts gently');
    const stopFrom = bike.position.z; bike.setInput({ brake: 1 }); advance(player, 2);
    assert.ok(Math.abs(bike.speedMps) < .02);
    const distance = bike.position.z - stopFrom;
    assert.ok(distance > 3 && distance < 7, `controlled city stop distance ${distance}`);
    advance(player, 1); assert.ok(Math.abs(bike.speedMps) < .02, 'brake holds at rest');
  } finally { player.dispose(); }
});

test('120 Hz bicycle physics is independent of 30, 60, 120 and 240 Hz rendering', async () => {
  const samples = [];
  for (const hz of [30, 60, 120, 240]) {
    const { player, bike } = await setup();
    try {
      bike.setInput({ throttle: 1, steering: .3 }); advance(player, 3, hz);
      samples.push({ at: bike.position.clone(), speed: bike.speedMps, turn: bike.quaternion.y });
    } finally { player.dispose(); }
  }
  for (const sample of samples) {
    assert.ok(sample.at.distanceTo(samples[0].at) < .002);
    assert.ok(Math.abs(sample.speed - samples[0].speed) < .002);
    assert.ok(Math.abs(sample.turn - samples[0].turn) < .002);
  }
});

test('steering has speed-dependent lock, cannot rotate in place, and banks into a moving corner', async () => {
  const { player, bike } = await setup();
  try {
    bike.setInput({ steering: 1 }); advance(player, 1);
    assert.ok(Math.abs(bike.quaternion.y) < .001, 'handlebar input alone does not pivot the bike');
    const slowLock = bike.steering;
    bike.setInput({ throttle: 1, steering: .5 }); advance(player, 2);
    assert.ok(bike.position.x > .3 && bike.quaternion.y > .1, 'positive steering is +Y yaw toward +X');
    assert.ok(bike.lean < -.02, 'display banks toward the turn');
    bike.setInput({ throttle: 1, steering: 1 }); advance(player, 4);
    assert.ok(bike.steering < slowLock * .6, 'high-speed steering has less lock');
    assert.ok(Math.abs(bike.quaternion.x) < 1e-5 && Math.abs(bike.quaternion.z) < 1e-5, 'physical auto balance stays upright');
    bike.setInput({ throttle: 1 }); advance(player, .5);
    assert.ok(Math.abs(bike.steering) < .02, 'released steering returns smoothly');
  } finally { player.dispose(); }
});

test('S brakes first, waits at rest, then pushes backwards at walking speed', async () => {
  const { player, bike } = await setup();
  try {
    bike.setInput({ throttle: 1 }); advance(player, 2);
    bike.setInput({ throttle: -1 }); advance(player, .5);
    assert.ok(bike.speedMps > 1, 'reverse command initially brakes forward travel');
    advance(player, 4);
    assert.ok(bike.speedMps < -.8 && bike.speedMps >= -1.21, `reverse speed ${bike.speedMps}`);
    bike.setInput({ throttle: 1 }); advance(player, 2);
    assert.ok(bike.speedMps > 2, 'forward starts after stopping the backward roll');
  } finally { player.dispose(); }
});

test('tyre and frame CCD stop at a thin wall without tunnelling or rising through it', async () => {
  const environment = floor(); box(environment, [8, 4, .01], [0, 2, 15]);
  const { player, bike } = await setup(environment);
  try {
    bike.setInput({ throttle: 1 }); let maximum = 0;
    for (let frame = 0; frame < 720; frame++) { player.update(1 / 120, idle, false, false); maximum = Math.max(maximum, bike.speedMps); }
    assert.ok(maximum > 7, 'wall is reached near cruising speed');
    assert.ok(bike.position.z < 14.2 && bike.position.z > 13.8);
    assert.ok(Math.abs(bike.speedMps) < .1 && Math.abs(bike.position.y) < .08);
  } finally { player.dispose(); }
});

test('real wheel support climbs an 8 cm kerb and a ten-degree ramp', async () => {
  for (const terrain of ['kerb', 'ramp']) {
    const environment = floor();
    if (terrain === 'kerb') box(environment, [8, .08, 8], [0, .04, 10]);
    else { const ramp = box(environment, [8, .1, 16], [0, 1.45, 12]); ramp.rotation.x = -Math.atan2(3, 16); }
    const { player, bike } = await setup(environment);
    try {
      bike.setInput({ throttle: 1 }); advance(player, terrain === 'ramp' ? 3.75 : 6);
      assert.ok(bike.position.z > 15, `${terrain} traversal stopped at ${bike.position.z}`);
      if (terrain === 'ramp') {
        assert.ok(bike.position.y > 2); assert.ok(bike.pitch < -.1, `slope pitch ${bike.pitch}`);
        // The springs carry the wheels up the grade and the motor answers it:
        // a street hill costs a little pace, not most of it.
        assert.ok(bike.speedMps > 6.5, `climbing speed ${bike.speedMps}`);
      } else assert.ok(Math.abs(bike.position.y) < .08, 'lands back on the road after the kerb');
    } finally { player.dispose(); }
  }
});

test('a street kerb, a road-mesh seam and a long descent do not take the pace away', async () => {
  // A 15 cm pavement kerb met head-on at cruising speed.
  let environment = floor(); box(environment, [8, .15, 30], [0, .075, 27]);
  let { player, bike } = await setup(environment);
  try {
    bike.setInput({ throttle: 1 }); advance(player, 4.5);
    assert.ok(bike.position.z > 20 && bike.position.y > .1, `kerb stopped the bike at ${bike.position.z}`);
    assert.ok(bike.speedMps > 6.5, `speed after the kerb ${bike.speedMps}`);
  } finally { player.dispose(); }
  // Neighbouring road tiles that disagree by 3 cm, as streamed cells do.
  environment = floor();
  for (let tile = 0; tile < 12; tile++) box(environment, [8, .03, 2], [0, .015, 9 + tile * 4]);
  ({ player, bike } = await setup(environment));
  try {
    bike.setInput({ throttle: 1 }); advance(player, 8);
    assert.ok(bike.speedMps > 7, `speed over seams ${bike.speedMps}`);
  } finally { player.dispose(); }
  // Ten degrees downhill: gravity may not carry the bike past its top speed.
  environment = new THREE.Group();
  const hill = box(environment, [8, .2, 200], [0, 0, 90]); hill.rotation.x = Math.atan2(3, 16);
  player = await createPlayerController(environment, new THREE.Vector3(1.5, 17.1, 0));
  bike = player.attachPhysics((world, collider) => createBikePhysics(world, collider, { position: new THREE.Vector3(0, 17.05, 0) }));
  try {
    advance(player, 1); bike.setInput({ throttle: 1 }); let maximum = 0;
    for (let frame = 0; frame < 1200; frame++) { player.update(1 / 120, idle, false, false); maximum = Math.max(maximum, bike.speedMps); }
    assert.ok(maximum > 7 && maximum < 8.2, `descent speed ${maximum}`);
  } finally { player.dispose(); }
});

test('finite ground ends physically; there is no invisible road beyond the map', async () => {
  const { player, bike } = await setup(floor(10));
  try {
    bike.setInput({ throttle: 1 }); advance(player, 4);
    assert.ok(bike.position.z > 8 && bike.position.y < -3);
    assert.equal(bike.grounded, false);
  } finally { player.dispose(); }
});

test('parking and tyre grip hold on a cambered street instead of sliding sideways', async () => {
  const environment = new THREE.Group(); const road = box(environment, [50, .1, 50], [0, 0, 0]); road.rotation.z = -.12;
  const { player, bike } = await setup(environment, { position: new THREE.Vector3(0, .14, 0) }, new THREE.Vector3(3, 1, 0));
  try {
    const at = bike.position.clone(); advance(player, 8);
    assert.ok(Math.hypot(bike.position.x - at.x, bike.position.z - at.z) < .04);
  } finally { player.dispose(); }
});

test('the mounted rider has a physical head/body envelope under a low beam', async () => {
  const environment = floor(); box(environment, [8, .6, .2], [0, 1.7, 12]);
  const { player, bike } = await setup(environment);
  try {
    assert.equal(player.beginRide(bike).ok, true); bike.setInput({ throttle: 1 }); advance(player, 5);
    assert.ok(bike.position.z < 12 && bike.position.z > 11, 'the bike fits below, but its rider must stop at the beam');
    assert.ok(Math.abs(bike.speedMps) < .1);
  } finally { player.dispose(); }
});

test('mounting preserves the visible rider, follows fixed-step position and restores walking safely', async () => {
  const { player, bike } = await setup();
  try {
    assert.deepEqual(player.beginRide(bike), { ok: true });
    assert.equal(player.ridingActor, bike); assert.equal(player.object.visible, true);
    bike.setInput({ throttle: 1 }); advance(player, 1);
    assert.ok(player.position.distanceTo(bike.position) < 1e-5);
    assert.equal(player.sprinting, false);
    assert.equal(player.endRide().reason, 'moving');
    bike.park(); advance(player, 2);
    assert.deepEqual(player.endRide(), { ok: true }); assert.equal(player.ridingActor, undefined);
    advance(player, .2); assert.ok(player.grounded);
    assert.ok(Math.abs(player.position.x - bike.position.x) > .7);
    assert.equal(player.object.visible, true);
  } finally { player.dispose(); }
});

test('entry cannot cross a wall and blocked dismounts keep the rider on the bike', async () => {
  const barrier = floor(); box(barrier, [.08, 3, 4], [.7, 1.5, 0]);
  const first = await setup(barrier);
  try { assert.equal(first.player.beginRide(first.bike).reason, 'blocked'); }
  finally { first.player.dispose(); }
  const cage = floor(); for (const x of [-.6, .6]) box(cage, [.08, 3, 4], [x, 1.5, 0]);
  for (const z of [-1.1, 1.1]) box(cage, [1.3, 3, .08], [0, 1.5, z]);
  const { player, bike } = await setup(cage, {}, new THREE.Vector3(0, .03, -.5));
  try {
    assert.equal(player.beginRide(bike).ok, true);
    assert.equal(player.endRide().reason, 'no-safe-exit'); assert.equal(player.ridingActor, bike);
    player.teleport(new THREE.Vector3(3, .04, 0));
    assert.equal(player.ridingActor, undefined); advance(player, .2); assert.ok(player.grounded);
  } finally { player.dispose(); }
});

test('mounting steps across a normal pavement kerb without sweeping diagonally through it', async () => {
  for (const height of [.15, .26]) {
    const environment = floor(); box(environment, [1.5, height, 4], [1.25, height / 2, 0]);
    const { player, bike } = await setup(environment, {}, new THREE.Vector3(1.65, height + .03, 0));
    try {
      assert.ok(player.position.y - bike.position.y > height - .02);
      assert.equal(player.beginRide(bike).ok, true, `mount from ${height} m pavement`);
      assert.equal(player.endRide().ok, true, 'the same swept step path also permits a safe dismount');
    } finally { player.dispose(); }
  }
});

test('the pavement mounting allowance still rejects a blocked head sweep or a high ledge', async () => {
  for (const obstacle of ['roof', 'ledge']) {
    const height = obstacle === 'ledge' ? .5 : .15;
    const environment = floor(); box(environment, [1.5, height, 4], [1.25, height / 2, 0]);
    if (obstacle === 'roof') box(environment, [3, .2, 4], [.8, 2.04, 0]);
    const { player, bike } = await setup(environment, {}, new THREE.Vector3(1.65, height + .03, 0));
    try { assert.equal(player.beginRide(bike).reason, 'blocked', obstacle); }
    finally { player.dispose(); }
  }
});

test('parking remains still for a minute on a grade, yet a moving car wakes and pushes the bike', async () => {
  const environment = new THREE.Group(); const road = box(environment, [100, .1, 100], [0, 0, 0]); road.rotation.x = -.012;
  const { player, bike } = await setup(environment, { position: new THREE.Vector3(0, .14, 0), scale: .72 });
  try {
    advance(player, 1); const at = bike.position.clone(), rotation = bike.wheelRotation;
    advance(player, 60);
    assert.ok(bike.position.distanceTo(at) < .001, 'solver noise must not accumulate into a parked drift');
    assert.ok(Math.abs(bike.wheelRotation - rotation) < .001, 'stationary wheels stay stationary');
    assert.equal(bike.speedMps, 0);
    const car = player.addVehicle({ id: 'parking-impact', position: new THREE.Vector3(0, .15, -8) });
    advance(player, 1); car.setInput({ throttle: 1 }); advance(player, 2);
    assert.ok(bike.position.z > at.z + .5, 'the parking brake does not turn a dynamic bike into an immovable obstacle');
  } finally { player.dispose(); }
});

test('park clears smoothed throttle, safe reset rejects occupied ground, and scaling follows the rider', async () => {
  const environment = floor(); box(environment, [1, 3, 1], [5, 1.5, 0]);
  const { player, bike } = await setup(environment, { scale: .72 });
  try {
    assert.ok(Math.abs(bike.config.wheelRadius - .347968 * .72) < 1e-8);
    assert.equal(bike.canPlace(new THREE.Vector3(5, .03, 0)), false);
    const before = bike.position.clone(); assert.equal(bike.reset(new THREE.Vector3(5, .03, 0)), false);
    assert.ok(bike.position.distanceTo(before) < 1e-8);
    bike.setInput({ throttle: 1 }); advance(player, 1); bike.park(); advance(player, 1);
    assert.ok(Math.abs(bike.speedMps) < .03, 'blur/pause park cannot retain accelerator input');
    assert.ok(bike.reset(new THREE.Vector3(0, .04, -3)));
    advance(player, 1); assert.ok(Math.abs(bike.speedMps) < .01);
    bike.setInput({ throttle: NaN, steering: Infinity, brake: NaN }); advance(player, .2);
    assert.ok(bike.position.toArray().every(Number.isFinite));
    bike.dispose(); bike.dispose(); advance(player, .2);
    assert.equal(bike.disposed, true); assert.equal(bike.reset(), false);
  } finally { player.dispose(); }
});
