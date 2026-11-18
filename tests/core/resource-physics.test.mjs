import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerController, CHARACTER_RADIUS } from '../../src/exploration/player.ts';
import { MAX_ACTIVE_FALLING_TREES } from '../../src/exploration/resource-physics.ts';

const idle = new THREE.Vector3();
const fallDirection = new THREE.Vector3(1, 0, 0);
function environment(slope = 0) {
  const root = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(100, .4, 100));
  floor.position.y = -.2; floor.rotation.z = slope; root.add(floor);
  return root;
}
function advance(player, seconds, hz = 120, direction = idle, running = false) {
  for (let tick = 0; tick < Math.round(seconds * hz); tick++) player.update(1 / hz, direction, running, false);
}
function addTree(player, id = 'tree', position = new THREE.Vector3(), extra = {}) {
  return player.addResource({ id, kind: 'tree', position, tree: { height: 7, radius: .24 }, ...extra });
}
function trunkEnds(tree, height = 7, cutHeight = .42) {
  return [cutHeight, height].map(y => new THREE.Vector3(0, y, 0).applyQuaternion(tree.quaternion).add(tree.position));
}

test('a cut trunk rotates on a real hinge, tears free, accelerates under gravity and comes to rest on the floor', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-5, .04, -5));
  try {
    const tree = addTree(player);
    assert.equal(tree.state, 'standing');
    assert.ok(tree.mass > 600 && tree.mass < 800, `green wood collider mass ${tree.mass}`);
    assert.deepEqual(player.fellResource(tree.id, fallDirection), { ok: true });
    advance(player, .5);
    assert.equal(tree.state, 'hinged');
    const cut = trunkEnds(tree)[0];
    assert.ok(cut.distanceTo(new THREE.Vector3(0, .42, 0)) < .005, 'cut anchor remains attached while hinged');
    const earlyAngularSpeed = tree.angularSpeed;
    advance(player, 1.5);
    assert.equal(tree.state, 'falling');
    assert.ok(tree.angularSpeed > earlyAngularSpeed * 2, 'gravity accelerates the measured rigid body');
    assert.ok(tree.quaternion.z < -.1, 'the final blow selects the physical fall plane');
    let firstContact;
    for (let tick = 0; tick < 600; tick++) {
      player.update(1 / 120, idle, false, false);
      if (!firstContact && tree.groundContact) firstContact = { time: 2 + (tick + 1) / 120, state: tree.state, speed: tree.impactSpeed, point: tree.impactPoint?.clone() };
    }
    assert.ok(firstContact && firstContact.time < 3.5, 'actual first ground contact is exposed before sleep');
    assert.equal(firstContact.state, 'falling'); assert.ok(firstContact.speed > 1, 'contact reports measured pre-impact speed');
    assert.ok(firstContact.point?.toArray().every(Number.isFinite), 'contact exposes a finite world-space support point');
    assert.ok(Math.abs(firstContact.point.y) < .03, 'sound/dust point is on the actual floor');
    assert.ok(firstContact.point.x > .3 && firstContact.point.x < 7.5, 'impact lies along the falling trunk outside the original stump');
    assert.equal(tree.state, 'settled'); assert.equal(tree.sleeping, true);
    const [butt, top] = trunkEnds(tree);
    assert.ok(butt.x > .4 && top.x > 6, 'trunk falls away from its notch');
    for (const end of [butt, top]) assert.ok(end.y > .18 && end.y < .35, `real floor supports trunk axis ${end.y}`);
    assert.ok(Math.abs(new THREE.Vector3(0, 1, 0).applyQuaternion(tree.quaternion).y) < .03, 'resting trunk is horizontal');
    const stopped = tree.position.clone(); advance(player, 1);
    assert.ok(tree.position.distanceTo(stopped) < .001, 'sleeping log does not use a continuing visual animation');
  } finally { player.dispose(); }
});

test('sloping triangle terrain supports the fallen trunk instead of a horizontal fake ground plane', async () => {
  const slope = -.15;
  const player = await createPlayerController(environment(slope), new THREE.Vector3(-5, 1, -5));
  try {
    const tree = addTree(player); player.fellResource(tree.id, fallDirection);
    advance(player, 9);
    assert.equal(tree.state, 'settled');
    const [butt, top] = trunkEnds(tree);
    const surfaceY = x => Math.tan(slope) * x + .2 / Math.cos(slope) - .2;
    for (const end of [butt, top]) {
      const clearance = end.y - surfaceY(end.x);
      assert.ok(clearance > .16 && clearance < .4, `slope clearance ${clearance} at ${end.toArray()}`);
    }
    assert.ok(top.y < butt.y - .6, 'log settles along the slope');
    assert.ok(tree.impactPoint && Math.abs(tree.impactPoint.y - surfaceY(tree.impactPoint.x)) < .03, 'impact effects follow the actual sloping surface');
  } finally { player.dispose(); }
});

test('standing trees, convex ore, fallen logs and surviving stumps block the walking capsule', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-3, .04, 0));
  try {
    const tree = addTree(player);
    advance(player, .3);
    let closestStanding = Infinity;
    for (let tick = 0; tick < 240; tick++) {
      player.update(1 / 120, fallDirection, true, false);
      closestStanding = Math.min(closestStanding, Math.hypot(player.position.x, player.position.z));
    }
    // Capsule sliding may take a player around a narrow tree. Its actual path
    // must still stay outside the trunk; final X alone would mislabel sliding.
    assert.ok(closestStanding > .24 + CHARACTER_RADIUS - .04, `penetrated standing trunk: ${closestStanding}`);
    player.teleport(new THREE.Vector3(-5, .04, -5)); player.fellResource(tree.id, fallDirection); advance(player, 7);
    player.teleport(new THREE.Vector3(3, .04, -3)); advance(player, .3); advance(player, 3, 120, new THREE.Vector3(0, 0, 1));
    assert.ok(player.position.z < -.4, `walked through solid fallen log: ${player.position.toArray()}`);
    assert.equal(player.collectResource(tree.id), true); assert.equal(tree.state, 'stump');
    advance(player, 2, 120, new THREE.Vector3(0, 0, 1));
    assert.ok(player.position.z > 1, 'collection removes only the upper solid');
    player.teleport(new THREE.Vector3(-2, .04, 0)); advance(player, .3); advance(player, 1.3, 120, fallDirection);
    assert.ok(player.position.x < -.35, 'the cut stump remains solid');
    player.addResource({ id: 'ore', kind: 'ore', position: new THREE.Vector3(5, 0, 0), ore: { halfExtents: new THREE.Vector3(.7, .5, .5) } });
    player.teleport(new THREE.Vector3(5, .04, -3)); advance(player, .3); advance(player, 2, 120, new THREE.Vector3(0, 0, 1), true);
    assert.ok(player.position.z < -.5, 'the convex rock shares the character collision world');
  } finally { player.dispose(); }
});

test('a falling tree touching the player recovers sideways onto checked ground without trapping or pushing feet through the floor', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(3, .04, 0));
  try {
    const tree = addTree(player); player.fellResource(tree.id, fallDirection);
    let minimumFeet = Infinity;
    for (let tick = 0; tick < 1200; tick++) {
      player.update(1 / 120, idle, false, false); minimumFeet = Math.min(minimumFeet, player.position.y);
    }
    assert.equal(tree.state, 'settled');
    assert.ok(Math.abs(player.position.z) > .5 && Math.abs(player.position.x - 3) < .3, 'escape moves across the log rather than along its entire length');
    assert.ok(minimumFeet > -.02, `feet crossed ground while hit: ${minimumFeet}`);
    const before = player.position.clone(); advance(player, 1, 120, new THREE.Vector3(0, 0, 1));
    assert.ok(player.position.distanceTo(before) > 1, 'normal walking remains possible after the impact');
  } finally { player.dispose(); }
});

test('collect, occupied regrowth, removal and persisted stump/fallen poses leave no stale physics handles', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-5, .04, -5));
  try {
    const tree = addTree(player); player.fellResource(tree.id, fallDirection);
    assert.equal(player.collectResource(tree.id), false, 'an actively falling trunk cannot be collected');
    advance(player, 7);
    const fallenPosition = tree.position.clone(), fallenQuaternion = tree.quaternion.clone();
    assert.equal(player.collectResource(tree.id), true);
    player.teleport(new THREE.Vector3(0, .44, 0));
    assert.equal(player.restoreResource(tree.id), false, 'tree cannot regrow through the player');
    player.teleport(new THREE.Vector3(-5, .04, -5));
    assert.equal(player.restoreResource(tree.id), true); assert.equal(tree.state, 'standing');
    assert.ok(tree.position.distanceTo(tree.originalPosition) < 1e-6);
    assert.ok(player.removeResource(tree.id)); assert.equal(tree.disposed, true);
    assert.equal(player.removeResource(tree.id), false); assert.equal(player.getResource(tree.id), undefined);
    const stump = addTree(player, tree.id, new THREE.Vector3(), { initialState: 'stump' });
    assert.equal(stump.state, 'stump'); assert.equal(tree.disposed, true);
    assert.equal(player.restoreResource(stump.id), true); player.removeResource(stump.id);
    const restored = addTree(player, 'fallen', new THREE.Vector3(), { initialState: 'fallen', fallenPosition, fallenQuaternion });
    assert.equal(restored.state, 'settled'); assert.equal(restored.sleeping, true);
    assert.ok(restored.position.distanceTo(fallenPosition) < 1e-5);
    assert.ok(restored.quaternion.angleTo(fallenQuaternion) < .001);
    assert.equal(player.collectResource(restored.id), true);
  } finally { player.dispose(); player.dispose(); }
});

test('30, 60 and 120 Hz rendering produce the same hinge release and contact pose using shared fixed steps', async () => {
  const results = [];
  for (const hz of [30, 60, 120]) {
    const player = await createPlayerController(environment(), new THREE.Vector3(-5, .04, -5));
    try {
      const tree = addTree(player); player.fellResource(tree.id, fallDirection); advance(player, 2, hz);
      const falling = { position: tree.position.clone(), quaternion: tree.quaternion.clone(), speed: tree.speedMps };
      advance(player, 5, hz); results.push({ falling, settled: tree.position.clone(), quaternion: tree.quaternion.clone(), state: tree.state });
    } finally { player.dispose(); }
  }
  for (const result of results.slice(1)) {
    assert.ok(result.falling.position.distanceTo(results[0].falling.position) < .002);
    assert.ok(result.falling.quaternion.angleTo(results[0].falling.quaternion) < .002);
    assert.ok(Math.abs(result.falling.speed - results[0].falling.speed) < .002);
    assert.ok(result.settled.distanceTo(results[0].settled) < .002);
    assert.ok(result.quaternion.angleTo(results[0].quaternion) < .002);
    assert.equal(result.state, 'settled');
  }
});

test('regrowth queries include the original rotated ore and full stump volume, rejecting players/cars without a physics tick', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-5, .04, -5));
  try {
    const car = player.addVehicle({ id: 'occupied-car', position: new THREE.Vector3(0, .2, 0) });
    advance(player, 1);
    const carBefore = car.position.clone();
    const ore = player.addResource({ id: 'ore-car', kind: 'ore', position: new THREE.Vector3(),
      ore: { halfExtents: new THREE.Vector3(.7, .3351858555, .561498642), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) } });
    assert.equal(player.canRestoreResource(ore.id), false, 'a newly registered mineral detects the already parked chassis immediately');
    assert.ok(car.position.distanceTo(carBefore) < 1e-8, 'the query must not step the world or apply an overlap impulse');
    player.removeResource(ore.id);
    const tree = addTree(player, 'stump-car', new THREE.Vector3(), { initialState: 'stump' });
    assert.equal(player.canRestoreResource(tree.id), false, 'a streamed-out stump cannot regrow through the car');
    player.removeResource(tree.id); player.removeVehicle(car.id);
    const rotated = player.addResource({ id: 'rotated-ore', kind: 'ore', position: new THREE.Vector3(),
      ore: { halfExtents: new THREE.Vector3(.9, .35, .12), quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2) } });
    assert.equal(player.canRestoreResource(rotated.id), true);
    player.teleport(new THREE.Vector3(.6, .04, 0));
    assert.equal(player.canRestoreResource(rotated.id), true, 'the query uses original yaw, not the unrotated wide X dimension');
    player.teleport(new THREE.Vector3(0, .04, .5));
    assert.equal(player.canRestoreResource(rotated.id), false, 'the rotated Z volume detects the player');
    assert.equal(rotated.state, 'standing', 'queries do not mutate resource state');
    assert.equal(player.canRestoreResource('missing'), false);
  } finally { player.dispose(); }
  assert.equal(player.canRestoreResource('missing'), false);
});

test('falling trunk collides with ore and a parked car in the same Rapier world', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-5, .04, -5));
  try {
    const tree = addTree(player);
    player.addResource({ id: 'obstacle', kind: 'ore', position: new THREE.Vector3(3, 0, 0), ore: { halfExtents: new THREE.Vector3(.8, 1.1, .8) } });
    player.fellResource(tree.id, fallDirection); advance(player, 7);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(tree.quaternion);
    assert.ok(Math.abs(axis.y) > .1 || trunkEnds(tree).some(end => end.y > .7), 'solid ore interrupts the empty-floor horizontal pose');
    player.removeResource('obstacle'); player.removeResource(tree.id);
    const car = player.addVehicle({ id: 'car', position: new THREE.Vector3(3, .2, 0) }); advance(player, 1);
    const carBefore = car.position.clone(); const second = addTree(player, 'second');
    player.fellResource(second.id, fallDirection); advance(player, 7);
    assert.ok(car.position.distanceTo(carBefore) > .05 || trunkEnds(second).some(end => end.y > .6), 'car receives the impact or physically supports the tree');
    assert.ok(car.position.y > -.2, 'vehicle is not forced below the terrain');
  } finally { player.dispose(); }
});

test('falling work is bounded, invalid input cannot poison the world, and disposing releases resource ownership', async () => {
  const player = await createPlayerController(environment(), new THREE.Vector3(-20, .04, -20));
  const trees = [];
  try {
    for (let index = 0; index <= MAX_ACTIVE_FALLING_TREES; index++) trees.push(addTree(player, `tree-${index}`, new THREE.Vector3(index * 5, 0, 0)));
    assert.equal(player.fellResource(trees[0].id, new THREE.Vector3(NaN, 0, 0)).reason, 'invalid-direction');
    assert.equal(player.fellResource(trees[0].id, new THREE.Vector3(0, 1, 0)).reason, 'invalid-direction');
    for (const tree of trees.slice(0, MAX_ACTIVE_FALLING_TREES)) assert.equal(player.fellResource(tree.id, new THREE.Vector3(0, 0, 1)).ok, true);
    assert.equal(player.fellResource(trees.at(-1).id, new THREE.Vector3(0, 0, 1)).reason, 'busy');
    advance(player, 7);
    assert.equal(player.fellResource(trees.at(-1).id, new THREE.Vector3(0, 0, 1)).ok, true, 'sleeping logs release the active falling budget');
    assert.throws(() => addTree(player, 'bad', new THREE.Vector3(NaN, 0, 0)), /position/);
    assert.throws(() => addTree(player, 'bad', new THREE.Vector3(), { tree: { height: 0, radius: .2 } }), /dimensions/);
    assert.throws(() => addTree(player, 'bad', new THREE.Vector3(), { initialState: 'fallen' }), /pose/);
    advance(player, .3); assert.ok(player.position.toArray().every(Number.isFinite));
  } finally { player.dispose(); }
  for (const tree of trees) assert.equal(tree.disposed, true);
  assert.equal(player.fellResource('missing', fallDirection).reason, 'disposed');
});
