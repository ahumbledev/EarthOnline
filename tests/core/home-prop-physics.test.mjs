import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerController } from '../../src/exploration/player.ts';
import { createHomePropPhysics, MAX_DYNAMIC_PROPS } from '../../src/home/prop-physics.ts';

const still = new THREE.Vector3();
const upright = new THREE.Quaternion();
function room(width = 8, depth = 8) {
  const environment = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(width, .2, depth)); floor.position.y = -.1; environment.add(floor);
  for (const [x, z, w, d] of [[-width / 2, 0, .2, depth], [width / 2, 0, .2, depth], [0, -depth / 2, width, .2], [0, depth / 2, width, .2]]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d)); wall.position.set(x, 1.5, z); environment.add(wall);
  }
  return environment;
}
const advance = (player, seconds, direction = still, running = false) => { for (let i = 0; i < Math.round(seconds * 60); i++) player.update(1 / 60, direction, running, false); };
const mug = { shape: { kind: 'cylinder' }, size: { width: .09, depth: .09, height: .1 }, mass: .3 };
const table = { shape: { kind: 'box' }, size: { width: 1.2, depth: .6, height: .45 } };

test('a mug set on a table stays put, settles and reports the table as its support', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'table', ...table, position: new THREE.Vector3(1, 0, 0), yaw: 0 });
    const settled = [];
    physics.onSettled(id => settled.push(id));
    const prop = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(1.2, .452, .1), quaternion: upright });
    advance(player, 2);
    assert.ok(Math.abs(prop.position.y - .45) < .02, `mug rests on the top, y = ${prop.position.y}`);
    assert.ok(Math.hypot(prop.position.x - 1.2, prop.position.z - .1) < .02, 'the mug did not slide');
    assert.ok(prop.settled && settled.includes('mug'), 'the mug settled and was reported');
    assert.deepEqual(physics.supportOf('mug'), { kind: 'static', id: 'table' });
    assert.ok(Math.abs(prop.renderPosition.y - prop.position.y) < .01, 'display pose follows physics');
  } finally { player.dispose(); }
});

test('a mug placed past the table edge tips off and lands on the floor', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'table', ...table, position: new THREE.Vector3(0, 0, 0), yaw: 0 });
    const prop = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(.63, .452, 0), quaternion: upright });
    advance(player, 3);
    assert.ok(prop.position.y < .12, `the mug fell to the floor, y = ${prop.position.y}`);
    assert.ok(prop.position.x > .6, 'it fell outward');
    assert.deepEqual(physics.supportOf('mug'), { kind: 'environment' });
    assert.ok(physics.drainImpacts().some(impact => impact.id === 'mug'), 'the landing was reported as an impact');
  } finally { player.dispose(); }
});

test('moving the table teleports a carried mug and pushes stacked mugs apart', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'table', ...table, position: new THREE.Vector3(0, 0, 0), yaw: 0 });
    const a = physics.addDynamic({ id: 'a', ...mug, position: new THREE.Vector3(0, .452, 0), quaternion: upright });
    physics.moveStatic('table', new THREE.Vector3(2, 0, 1), Math.PI / 2);
    assert.ok(physics.teleportDynamic('a', new THREE.Vector3(2, .452, 1), upright));
    advance(player, 1.5);
    assert.ok(Math.abs(a.position.y - .45) < .02 && Math.hypot(a.position.x - 2, a.position.z - 1) < .02, 'the carried mug sits on the moved table');
    // Two mugs dropped into the same spot cannot share it: contacts separate them (beside or stacked) and the top keeps holding one.
    const b = physics.addDynamic({ id: 'b', ...mug, position: new THREE.Vector3(2.02, .5, 1), quaternion: upright });
    advance(player, 2.5);
    const apart = a.position.distanceTo(b.position);
    assert.ok(apart > .085, `mugs no longer interpenetrate (${apart.toFixed(3)} m apart)`);
    assert.ok(a.position.y > .3 || b.position.y > .3, 'the table top still holds a mug');
  } finally { player.dispose(); }
});

test('the walking capsule passes through a mug on the floor and shoves it along', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-1.5, .05, 0));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    const prop = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(0, .002, 0), quaternion: upright });
    advance(player, .5);
    advance(player, 1.6, new THREE.Vector3(1, 0, 0), false);
    assert.ok(player.position.x > .3, `the player kept walking through the mug, x = ${player.position.x}`);
    assert.ok(prop.position.x > .05, `the mug was pushed, x = ${prop.position.x}`);
    assert.ok(player.position.y < .05, 'the capsule never climbed onto the mug');
  } finally { player.dispose(); }
});

test('held props leave the simulation, releases resettle them, and limits and disposal are enforced', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    const prop = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(0, 1, 0), quaternion: upright });
    assert.ok(physics.hold('mug'));
    advance(player, 1);
    assert.ok(prop.held && Math.abs(prop.position.y - 1) < 1e-6, 'a held prop neither falls nor moves');
    assert.ok(physics.release('mug', new THREE.Vector3(1, .3, 1), upright));
    advance(player, 1.5);
    assert.ok(prop.position.y < .02 && Math.abs(prop.position.x - 1) < .02, 'the released prop fell straight down');
    assert.equal(physics.poseBlocked(mug, new THREE.Vector3(1, 0, 1), upright), true, 'the spot is now taken');
    assert.equal(physics.poseBlocked(mug, new THREE.Vector3(1, 0, 1), upright, 'mug'), false, 'unless the same prop is ignored');
    assert.throws(() => physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(), quaternion: upright }), /unique/);
    assert.throws(() => physics.addDynamic({ id: 'heavy', ...mug, mass: 500, position: new THREE.Vector3(), quaternion: upright }), /mass/);
    for (let index = 1; index < MAX_DYNAMIC_PROPS; index++) physics.addDynamic({ id: `m${index}`, ...mug, position: new THREE.Vector3(-3 + index * .1, 2, 2), quaternion: upright });
    assert.throws(() => physics.addDynamic({ id: 'one-too-many', ...mug, position: new THREE.Vector3(), quaternion: upright }), /Too many/);
    assert.ok(physics.removeDynamic('m1'));
    assert.equal(physics.getDynamic('m1'), undefined);
    assert.equal(physics.removeStatic('nothing'), false);
  } finally { player.dispose(); }
  assert.ok(physics.disposed, 'disposing the controller disposes its attachment');
});

test('a grabbed mug is dragged from the floor onto a shelf board as a colliding body and rests where it is let go', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    // A two-board unit open toward +x: boards at 0.1 m and 0.5 m, a back panel and a top.
    const blocks = [
      { min: [-.25, 0, -.6], max: [.25, .1, .6] }, { min: [-.25, .44, -.6], max: [.25, .5, .6] },
      { min: [-.28, .1, -.6], max: [-.25, .9, .6] }, { min: [-.28, .86, -.6], max: [.25, .9, .6] },
    ];
    physics.addStatic({ id: 'unit', shape: { kind: 'box' }, size: { width: .53, depth: 1.2, height: .9 }, blocks, position: new THREE.Vector3(0, 0, 0), yaw: 0 });
    const prop = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(1.2, .002, 0), quaternion: upright });
    advance(player, .5);
    assert.ok(physics.grab('mug', new THREE.Vector3(1.2, .05, 0)));
    assert.equal(physics.grabbed, 'mug');
    physics.dragTo(new THREE.Vector3(.8, .7, 0)); advance(player, .6);
    assert.ok(Math.abs(prop.position.y - .65) < .05 && Math.abs(prop.position.x - .8) < .05, `held in the air at the hand, at ${prop.position.toArray().map(v => v.toFixed(2))}`);
    assert.equal(prop.settled, false, 'a held prop is never reported settled');
    // Pushed at the back panel through the upper bay: the panel stops it inside the bay, and the board carries it.
    physics.dragTo(new THREE.Vector3(-.6, .56, 0)); advance(player, .8);
    assert.ok(prop.position.x > -.25 && prop.position.x < .1, `stopped by the back panel inside the bay, x = ${prop.position.x.toFixed(3)}`);
    assert.equal(physics.drop(), 'mug');
    assert.equal(physics.grabbed, undefined);
    advance(player, 2);
    assert.ok(Math.abs(prop.position.y - .5) < .02, `rests on the upper board, y = ${prop.position.y.toFixed(3)}`);
    assert.deepEqual(physics.supportOf('mug'), { kind: 'static', id: 'unit' });
    assert.ok(prop.settled, 'let go, it settles and can be saved');
  } finally { player.dispose(); }
});

test('support comes from contact faces, follows stacked items, and moving a support leaves distant sleepers asleep', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'table', ...table, position: new THREE.Vector3(), yaw: 0 });
    const base = physics.addDynamic({ id: 'base', ...mug, position: new THREE.Vector3(0, .452, 0), quaternion: upright });
    const top = physics.addDynamic({ id: 'top', ...mug, position: new THREE.Vector3(0, .554, 0), quaternion: upright });
    const distant = physics.addDynamic({ id: 'distant', ...mug, position: new THREE.Vector3(2.5, .002, 2.5), quaternion: upright });
    // This item touches the table's side but rests on the floor, not the table.
    physics.addDynamic({ id: 'beside', ...mug, position: new THREE.Vector3(.646, .002, 0), quaternion: upright });
    advance(player, 5);
    assert.deepEqual(physics.supportedBy('table', false), ['base']);
    assert.deepEqual(new Set(physics.supportedBy('table')), new Set(['base', 'top']));
    assert.deepEqual(physics.supportOf('top'), { kind: 'dynamic', id: 'base' });
    assert.ok(distant.sleeping, 'a distant item is asleep before the edit');
    physics.addDynamic({ id: 'airborne', ...mug, position: new THREE.Vector3(.2, 1.2, 0), quaternion: upright });
    assert.deepEqual(physics.supportsOf('airborne'), [], 'an item above a table is not supported until contact');
    assert.ok(!physics.supportedBy('table').includes('beside'), 'side contact does not make an item ride the table');
    physics.moveStatic('table', new THREE.Vector3(-1.5, 0, 0), 0);
    assert.ok(!base.sleeping && !top.sleeping, 'the entire supported stack wakes');
    assert.ok(distant.sleeping, 'editing one support does not wake the room');
    advance(player, 2);
    assert.ok(base.position.y < .03 && top.position.y < .2, 'the unsupported stack falls');
    assert.ok(distant.sleeping);
  } finally { player.dispose(); }
});

const cabinet = {
  shape: { kind: 'box' }, size: { width: .8, depth: .4, height: 1.9 }, mass: 20,
  blocks: [
    { min: [-.4, 0, -.2], max: [.4, .08, .2] },
    { min: [-.4, .9, -.2], max: [.4, .96, .2] },
    { min: [-.4, 1.84, -.2], max: [.4, 1.9, .2] },
    { min: [-.4, .08, -.2], max: [-.37, 1.84, .2] },
    { min: [.37, .08, -.2], max: [.4, 1.84, .2] },
    { min: [-.37, .08, -.2], max: [.37, 1.84, -.17] },
  ],
};

test('an impulse topples a compound cabinet, spills its mug, and the fallen cabinet can be restored with the same pose', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'cabinet', ...cabinet, position: new THREE.Vector3(), yaw: 0 });
    const cup = physics.addDynamic({ id: 'mug', ...mug, position: new THREE.Vector3(0, .962, .05), quaternion: upright });
    advance(player, 3);
    assert.deepEqual(physics.supportOf('mug'), { kind: 'static', id: 'cabinet' });
    const moving = physics.activateFurniture('cabinet', new THREE.Vector3(0, 0, 35), new THREE.Vector3(0, 1.7, 0));
    assert.ok(moving?.furniture);
    assert.equal(physics.hasStatic('cabinet'), false);
    assert.equal(physics.dynamicCount, 1, 'furniture is not counted against the small-prop limit');
    assert.equal(physics.grab('cabinet', new THREE.Vector3(0, 1, 0)), false, 'ordinary hand grabbing cannot pick up furniture');
    advance(player, 5);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(moving.quaternion);
    assert.ok(Math.abs(up.y) < .3, `the cabinet is on its side, local-up y=${up.y}`);
    assert.ok(cup.position.y < .2, `the mug fell out of the cabinet, y=${cup.position.y}`);
    assert.deepEqual(physics.supportOf('mug'), { kind: 'environment' });
    const position = moving.position.clone(), quaternion = moving.quaternion.clone();
    physics.removeDynamic('cabinet');
    const restored = physics.addDynamic({ id: 'cabinet', ...cabinet, furniture: true, position, quaternion });
    assert.ok(restored.quaternion.angleTo(quaternion) < 1e-6);
    advance(player, 3);
    assert.ok(restored.position.distanceTo(position) < .06, 'restored fallen furniture remains at its resting pose');
    assert.ok(restored.quaternion.angleTo(quaternion) < .08, 'restoring does not stand the cabinet back up');
  } finally { player.dispose(); }
});

test('compound placement queries preserve cabinet cavities and reject collisions across the whole proposed group', async () => {
  const player = await createPlayerController(room(), new THREE.Vector3(-3, .05, -3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    physics.addStatic({ id: 'cabinet', ...cabinet, position: new THREE.Vector3(), yaw: 0 });
    advance(player, .1);
    assert.equal(physics.poseBlocked(mug, new THREE.Vector3(0, .96, .05), upright), false, 'a mug fits inside the middle shelf');
    assert.equal(physics.poseBlocked(mug, new THREE.Vector3(.38, 1, .05), upright), true, 'the side panel is solid');
    const poses = [
      { id: 'cabinet', ...cabinet, position: new THREE.Vector3(1, 0, 0), quaternion: upright },
      { id: 'mug', ...mug, position: new THREE.Vector3(1, .96, .05), quaternion: upright },
    ];
    assert.equal(physics.groupBlocked(poses), false, 'a carried mug touching its shelf is a legal group pose');
    assert.equal(physics.groupBlocked([{ ...poses[0], position: new THREE.Vector3(0, 0, 0) }]), false, 'the original furniture colliders are ignored by instance ID');
    assert.equal(physics.groupBlocked([poses[0], { ...poses[1], position: new THREE.Vector3(1.38, 1, .05) }]), true, 'a passenger cannot overlap the proposed cabinet panels');
    assert.equal(physics.groupBlocked([poses[0], { ...poses[1], position: new THREE.Vector3(3.9, .96, 0) }]), true, 'every passenger is checked against room walls');
    assert.equal(physics.groupBlocked([poses[0], poses[1], { ...poses[1], id: 'second-mug' }]), true, 'passengers cannot overlap each other');
    assert.equal(physics.poseBlocked(mug, new THREE.Vector3(0, -.04, 0), upright), true, 'floor penetration is rejected');
  } finally { player.dispose(); }
});
