import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerController, CHARACTER_RADIUS } from '../../src/exploration/player.ts';

const stationary = new THREE.Vector3();
const forward = new THREE.Vector3(1, 0, 0);

function box(environment, size, position) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
  mesh.position.set(...position);
  environment.add(mesh);
  return mesh;
}

function floor(size = 30) {
  const environment = new THREE.Group();
  box(environment, [size, 0.2, size], [0, -0.1, 0]);
  return environment;
}

function advance(player, seconds, direction = stationary, running = false, jump = false, dt = 1 / 60) {
  for (let index = 0; index < Math.round(seconds / dt); index++) {
    player.update(dt, direction, running, jump);
  }
}

test('capsule settles on transformed geometry, blocks a thin wall, and slides along it', async () => {
  const environment = floor();
  const walls = new THREE.Group();
  walls.position.x = 2;
  walls.rotation.y = Math.PI;
  environment.add(walls);
  box(walls, [0.1, 3, 20], [0, 1.5, 0]);
  const player = await createPlayerController(environment, new THREE.Vector3(0, 1, 0));
  try {
    advance(player, 1);
    assert.ok(player.grounded);
    assert.ok(Math.abs(player.position.y) < 0.04, `feet y = ${player.position.y}`);
    advance(player, 2, forward, true);
    assert.ok(player.position.x < 1.95 - CHARACTER_RADIUS + 0.02, `wall penetration x = ${player.position.x}`);
    const zBefore = player.position.z;
    advance(player, 2.3, new THREE.Vector3(1, 0, 1).normalize());
    assert.ok(player.position.z > zBefore + 1.5, 'movement should slide along the wall');
    assert.ok(player.position.x < 1.75);
  } finally { player.dispose(); }
});

test('stairs with 0.2 m risers are traversable without jumping', async () => {
  const environment = floor();
  for (let index = 0; index < 8; index++) {
    const height = (index + 1) * 0.2;
    box(environment, [0.35, height, 2], [0.9 + index * 0.35, height / 2, 0]);
  }
  box(environment, [2, 1.6, 2], [4.475, 0.8, 0]);
  const player = await createPlayerController(environment, new THREE.Vector3(0, 0.04, 0));
  try {
    advance(player, 0.4);
    // Eight risers take an unhurried walker barely longer than the same flat
    // distance: the capsule steps onto each tread instead of grinding up its edge.
    let seconds = 0;
    while (player.position.x < 4 && seconds < 4) { advance(player, 1 / 60, forward); seconds += 1 / 60; }
    assert.ok(player.position.x >= 4, `stopped at x = ${player.position.x}`);
    assert.ok(seconds < 4 / 1.3 * 1.15, `the climb took ${seconds.toFixed(2)} s`);
    assert.ok(player.position.y > 1.55, `did not climb: y = ${player.position.y}`);
    assert.ok(player.grounded);
    advance(player, 4, new THREE.Vector3(-1, 0, 0));
    assert.ok(player.position.x < 1, `did not descend: x = ${player.position.x}`);
    assert.ok(player.position.y < 0.5, `did not descend: y = ${player.position.y}`);
  } finally { player.dispose(); }
});

test('real triangle doorways stay open and a camera arm is clipped by their walls', async () => {
  const environment = floor();
  box(environment, [2.5, 3, 0.15], [-1.75, 1.5, 0]);
  box(environment, [2.5, 3, 0.15], [1.75, 1.5, 0]);
  box(environment, [1, 0.9, 0.15], [0, 2.55, 0]);
  const player = await createPlayerController(environment, new THREE.Vector3(0, 0.04, -2));
  try {
    advance(player, 0.4);
    const throughDoor = player.constrainCamera(new THREE.Vector3(0, 1.4, -1), new THREE.Vector3(0, 1.4, 2));
    assert.ok(throughDoor.z > 1.9, 'the camera should see through the open doorway');
    const againstWall = player.constrainCamera(new THREE.Vector3(1, 1.4, -1), new THREE.Vector3(1, 1.4, 2));
    assert.ok(againstWall.z < -0.2, 'the camera should stay in front of the wall');
    advance(player, 4.7, new THREE.Vector3(0, 0, 1));
    assert.ok(player.position.z > 3, `doorway blocked at z = ${player.position.z}`);
    assert.ok(player.grounded);
  } finally { player.dispose(); }
});

test('jump starts only while grounded and holding it does not repeat; teleport resets falling', async () => {
  const player = await createPlayerController(floor(), new THREE.Vector3(0, 0.04, 0));
  try {
    advance(player, 0.4);
    advance(player, 0.2, stationary, false, true);
    assert.ok(player.position.y > 0.5, `jump y = ${player.position.y}`);
    assert.ok(!player.grounded);
    advance(player, 1.2, stationary, false, true);
    assert.ok(player.grounded, 'holding jump should allow landing without automatically jumping again');
    assert.ok(player.position.y < 0.04);
    player.teleport(new THREE.Vector3(3, 2, 1));
    assert.equal(player.position.x, 3);
    advance(player, 1);
    assert.ok(player.grounded);
    assert.ok(player.position.y < 0.04);
  } finally { player.dispose(); }
});

test('physics has no invisible floor beyond the actual mesh and handles slow frames', async () => {
  const player = await createPlayerController(floor(4), new THREE.Vector3(0, 0.04, 0));
  try {
    advance(player, 0.3);
    advance(player, 4.5, forward, false, false, 1 / 15);
    assert.ok(player.position.x > 5, `movement x = ${player.position.x}`);
    assert.ok(player.position.y < -1, `unexpected floor at y = ${player.position.y}`);
    assert.ok(!player.grounded);
  } finally { player.dispose(); }
});

test('a supplied visual avatar follows actual physics motion and is released exactly once', async () => {
  const environment = floor();
  box(environment, [.1, 3, 20], [2, 1.5, 0]);
  const object = new THREE.Group();
  const motion = [];
  let disposals = 0;
  const avatar = {
    object,
    updateMotion(dt, state) { motion.push({ dt, ...state }); },
    dispose() { disposals++; },
  };
  const player = await createPlayerController(environment, new THREE.Vector3(0, .04, 0), avatar);
  assert.equal(player.object, object);
  try {
    advance(player, .4);
    advance(player, .45, forward, true);
    assert.ok(motion.some(state => state.grounded && state.sprinting && state.speed > 5));
    assert.ok(object.position.distanceTo(player.renderPosition) < 1e-8, 'the controller owns the visual feet position');
    assert.ok(player.renderPosition.distanceTo(player.position) <= 5.2 / 120 + 1e-6, 'display blending trails physics by under one fixed step');
    advance(player, 2, forward, true);
    assert.ok(player.position.x < 1.95 - CHARACTER_RADIUS + .02);
    assert.ok(motion.at(-1).speed < .01, 'a blocked player must not keep animating at requested run speed');
    assert.equal(motion.at(-1).sprinting, false);
  } finally { player.dispose(); }
  player.dispose();
  assert.equal(disposals, 1);
});
