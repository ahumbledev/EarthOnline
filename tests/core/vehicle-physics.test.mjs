import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerController, CHARACTER_RADIUS } from '../../src/exploration/player.ts';

const idle = new THREE.Vector3();
function box(environment, size, at) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size)); mesh.position.set(...at); environment.add(mesh); return mesh;
}
function floor(size = 300) { const environment = new THREE.Group(); box(environment, [size, .2, size], [0, -.1, 0]); return environment; }
function advance(player, seconds, hz = 120, direction = idle, running = false) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) player.update(1 / hz, direction, running, false);
}
async function setup(environment = floor(), playerAt = new THREE.Vector3(5, .04, 0), config) {
  const player = await createPlayerController(environment, playerAt);
  const car = player.addVehicle({ id: 'test-car', position: new THREE.Vector3(0, .2, 0), config });
  return { player, car };
}

test('four ray suspensions support a dynamic chassis; engine, braking, reverse and steering produce physical motion', async () => {
  const { player, car } = await setup();
  try {
    advance(player, 1.5);
    assert.ok(Math.abs(car.position.y) < .03, `static chassis bottom ${car.position.y}`);
    assert.equal(car.wheels.filter(wheel => wheel.grounded).length, 4);
    for (const wheel of car.wheels) {
      assert.ok(wheel.suspensionLength > .1 && wheel.suspensionLength < car.config.suspensionRestLength);
      assert.ok(Math.abs(wheel.position.y - wheel.radius) < .02);
    }
    car.setInput({ throttle: 1 }); advance(player, 3);
    assert.ok(car.position.z > 25 && car.speedMps > 15, 'engine force accelerates the shared-world body');
    assert.ok(car.wheels.some(wheel => Math.abs(wheel.rotation) > 1));
    car.setInput({ brake: 1 }); advance(player, 2);
    assert.ok(Math.abs(car.speedMps) < .1, 'wheel impulses brake to rest');
    const stopped = car.position.z;
    car.setInput({ throttle: -1 }); advance(player, 2);
    assert.ok(car.speedMps < -4 && car.speedMps > -8 && car.position.z < stopped - 5);
    car.reset(); advance(player, 1);
    car.setInput({ throttle: .6, steering: .5 }); advance(player, 2);
    assert.ok(car.position.x > 1 && car.quaternion.y > .15, 'positive steering is +Y yaw, local +Z toward +X');
    assert.ok(Math.abs(car.quaternion.x) < .1 && Math.abs(car.quaternion.z) < .1, 'normal cornering does not roll the chassis');
    car.reset(); advance(player, 1);
    car.setInput({ throttle: 1 }); advance(player, 7);
    assert.ok(car.speedMps > 23 && car.speedMps < 26, 'city forward speed is limited near 90 km/h using engine cutoff/drag');
    assert.ok(Math.abs(car.speedKph - car.speedMps * 3.6) < 1e-8);
  } finally { player.dispose(); }
});

test('vehicle fixed steps give the same travel at 30–240 Hz while walking remains in the same simulation', async () => {
  const results = [];
  for (const hz of [30, 60, 120, 240]) {
    const { player, car } = await setup();
    try {
      advance(player, 1, hz); car.setInput({ throttle: .7 }); advance(player, 2, hz);
      results.push({ distance: car.position.z, speed: car.speedMps });
    } finally { player.dispose(); }
  }
  assert.ok(Math.max(...results.map(row => row.distance)) - Math.min(...results.map(row => row.distance)) < .025);
  assert.ok(Math.max(...results.map(row => row.speed)) - Math.min(...results.map(row => row.speed)) < .025);
});

test('CCD chassis hits a 1 cm triangle wall at speed instead of tunnelling through it', async () => {
  const environment = floor(); box(environment, [80, 5, .01], [0, 2.5, 25]);
  const { player, car } = await setup(environment, undefined, { engineForce: 80000, maxForwardSpeed: 70 });
  try {
    advance(player, 1); car.setInput({ throttle: 1 });
    let maximumZ = -Infinity, maximumSpeed = 0;
    for (let tick = 0; tick < 600; tick++) {
      player.update(1 / 120, idle, false, false);
      maximumZ = Math.max(maximumZ, car.position.z); maximumSpeed = Math.max(maximumSpeed, car.speedMps);
    }
    assert.ok(maximumSpeed > 15, `fixture reaches collision speed, got ${maximumSpeed}`);
    assert.ok(maximumZ < 24, `chassis crossed the triangle wall: z=${maximumZ}`);
    assert.ok(car.position.y > -.2, 'collision does not push the car below the ground');
  } finally { player.dispose(); }
});

test('a parked dynamic vehicle blocks the walking capsule in the existing player world', async () => {
  const { player, car } = await setup(floor(), new THREE.Vector3(0, .04, -5));
  try {
    advance(player, 1); advance(player, 3, 120, new THREE.Vector3(0, 0, 1), true);
    const rear = car.position.z - car.config.length * .49;
    assert.ok(player.position.z < rear - CHARACTER_RADIUS + .08, `player walked through the parked car: ${player.position.z}`);
    assert.ok(car.position.distanceTo(new THREE.Vector3(0, .004, 0)) < .15, 'parking brake holds the car');
  } finally { player.dispose(); }
});

test('safe entry disables the seated capsule; high-speed exit is rejected and a blocked side uses the clear side', async () => {
  const environment = floor(); box(environment, [.1, 3, 5], [1.6, 1.5, 0]);
  const { player, car } = await setup(environment, new THREE.Vector3(-1.7, .04, 0));
  try {
    advance(player, 1);
    assert.deepEqual(player.enterVehicle(car.id), { ok: true });
    assert.equal(player.drivingVehicle, car); assert.equal(player.object.visible, false);
    assert.deepEqual(player.exitVehicle(), { ok: true });
    assert.ok(player.position.x < -1, 'capsule-tested exit chooses the other side of the wall');
    assert.equal(player.object.visible, true); assert.equal(player.drivingVehicle, undefined);
    assert.deepEqual(player.enterVehicle(car.id), { ok: true });
    car.setInput({ throttle: 1 }); advance(player, 1);
    assert.equal(player.exitVehicle().reason, 'moving');
    assert.equal(player.drivingVehicle, car); assert.equal(player.sprinting, false);
    const restore = new THREE.Vector3(-5, .04, -5);
    player.teleport(restore);
    assert.equal(player.drivingVehicle, undefined); assert.equal(player.object.visible, true);
    assert.ok(player.position.distanceTo(restore) < .01, 'explicit lifecycle teleport cancels driving and restores the walking capsule');
    advance(player, .5); assert.ok(player.grounded);
  } finally { player.dispose(); }
});

test('no safe ground or a blocked swept exit keeps the driver seated, and reset/removal leave no stale physics handles', async () => {
  const environment = floor();
  for (const x of [-1.3, 1.3]) box(environment, [.1, 3, 5.4], [x, 1.5, 0]);
  for (const z of [-2.7, 2.7]) box(environment, [2.7, 3, .1], [0, 1.5, z]);
  const { player, car } = await setup(environment, new THREE.Vector3(0, .04, 0));
  try {
    assert.deepEqual(player.enterVehicle(car.id), { ok: true });
    advance(player, 1);
    assert.equal(player.exitVehicle().reason, 'no-safe-exit');
    assert.equal(player.drivingVehicle, car);
    player.teleport(new THREE.Vector3(5, .04, 0));
    assert.ok(player.resetVehicle(car.id, new THREE.Vector3(8, .3, 3), new THREE.Quaternion()));
    assert.ok(car.position.distanceTo(new THREE.Vector3(8, .3, 3)) < .001);
    assert.equal(car.speedMps, 0);
    assert.ok(player.removeVehicle(car.id)); assert.equal(car.disposed, true);
    assert.equal(player.getVehicle(car.id), undefined); assert.equal(player.removeVehicle(car.id), false);
    car.dispose(); car.reset(); car.setInput({ throttle: 1 });
    assert.throws(() => player.addVehicle({ id: 'bad', position: new THREE.Vector3(NaN, 0, 0) }), /spawn/);
    assert.throws(() => player.addVehicle({ id: 'bad', position: new THREE.Vector3(), config: { mass: -1 } }), /configuration/);
    advance(player, .3); assert.ok(player.grounded, 'walking still works after all vehicle resources are removed');
  } finally { player.dispose(); player.dispose(); }
});

test('wheel rays use the real finite mesh: driving beyond it falls under gravity', async () => {
  const { player, car } = await setup(floor(10), new THREE.Vector3(3, .04, 0));
  try {
    advance(player, 1); car.setInput({ throttle: 1 }); advance(player, 3);
    assert.ok(car.position.z > 10 && car.position.y < -2, `unexpected invisible road at ${car.position.toArray()}`);
    assert.equal(car.wheels.filter(wheel => wheel.grounded).length, 0);
  } finally { player.dispose(); }
});

test('reusing a vehicle ID never revives a stale handle or lets it remove the replacement', async () => {
  const { player, car: original } = await setup();
  try {
    advance(player, .5);
    assert.equal(player.removeVehicle(original.id), true);
    const replacement = player.addVehicle({ id: original.id, position: new THREE.Vector3(0, .2, 5) });
    assert.equal(original.disposed, true);
    original.dispose(); original.reset(new THREE.Vector3(200, 200, 200)); original.setInput({ throttle: 1 });
    assert.equal(player.getVehicle(original.id), replacement);
    assert.equal(replacement.disposed, false);
    advance(player, .5); replacement.setInput({ throttle: 1 }); advance(player, 1);
    assert.ok(replacement.position.z > 6);
  } finally { player.dispose(); }
});

test('malformed inputs and recovery poses cannot poison the physics world with NaNs', async () => {
  const { player, car } = await setup();
  try {
    advance(player, .5);
    car.setInput({ throttle: NaN, steering: Infinity, brake: NaN });
    car.reset(new THREE.Vector3(NaN, 0, 0));
    car.reset(new THREE.Vector3(0, .2, 0), new THREE.Quaternion(1e300, 0, 0, 1e300));
    player.teleport(new THREE.Vector3(Infinity, 0, 0));
    advance(player, .5);
    assert.ok([...car.position.toArray(), ...car.quaternion.toArray(), car.speedMps, ...player.position.toArray()].every(Number.isFinite));
    assert.throws(() => player.addVehicle({ id: 'overflow', position: new THREE.Vector3(1e300, 0, 0) }), /spawn/);
    assert.throws(() => player.addVehicle({ id: 'q-overflow', position: new THREE.Vector3(), quaternion: new THREE.Quaternion(1e300, 0, 0, 1e300) }), /orientation/);
    assert.throws(() => player.addVehicle({ id: 'missing-wheel-coordinate', position: new THREE.Vector3(), config: {
      wheels: Array.from({ length: 4 }, () => ({ connection: { x: 0, y: 1 } })),
    } }), /attachments/);
  } finally { player.dispose(); }
});

test('safe exit checks a new blocking dynamic body even before the next broadphase step', async () => {
  const { player, car } = await setup(floor(), new THREE.Vector3(-1.7, .04, 0));
  try {
    advance(player, 1); assert.equal(player.enterVehicle(car.id).ok, true);
    const blocker = player.addVehicle({ id: 'new-blocker', position: new THREE.Vector3(1.65, 0, 0) });
    assert.equal(player.exitVehicle().ok, true);
    assert.ok(player.position.x < -1, 'the new car blocks the first side immediately, without a simulation step');
    assert.equal(blocker.disposed, false);
  } finally { player.dispose(); }
});
