import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFollowCamera } from '../../src/exploration/follow-camera.ts';
import { createPlayerController } from '../../src/exploration/player.ts';

const open = (_from, to) => to;
const frame = (feet, values = {}) => ({ feet, grounded: true, yaw: 0, pitch: .23, distance: 5.2, height: 1.25, ...values });
const look = feet => feet.clone().add(new THREE.Vector3(0, 1.25, 0));

test('a fast orbit drag rotates the view at a constant arm instead of swinging the camera inward', () => {
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(open), feet = new THREE.Vector3();
  rig.update(camera, 0, frame(feet));
  for (let step = 1; step <= 12; step++) {
    rig.update(camera, 1 / 60, frame(feet, { yaw: step * Math.PI / 12 }));
    assert.ok(Math.abs(camera.position.distanceTo(look(feet)) - 5.2) < 1e-9, `arm at step ${step}: ${camera.position.distanceTo(look(feet))}`);
  }
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.z > .9, 'after a half turn the camera looks back along +Z');
});

test('walls shorten the arm at once; clearing them eases it back without passing the constrained point', () => {
  let limit = Infinity;
  const constrain = (from, to) => { const arm = to.clone().sub(from); return arm.length() > limit ? from.clone().addScaledVector(arm.normalize(), limit) : to; };
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(constrain), feet = new THREE.Vector3();
  rig.update(camera, 0, frame(feet));
  limit = 1.4; rig.update(camera, 1 / 60, frame(feet));
  assert.ok(Math.abs(rig.armLength - 1.4) < 1e-9);
  limit = Infinity;
  const lengths = [];
  for (let step = 0; step < 90; step++) { rig.update(camera, 1 / 60, frame(feet)); lengths.push(rig.armLength); }
  assert.ok(lengths[0] < 1.5, 'the first clear frame does not pop the camera back');
  assert.ok(lengths.every((value, index) => index === 0 || value >= lengths[index - 1]), 'recovery is monotonic');
  assert.ok(lengths.at(-1) > 5.1 && lengths.at(-1) <= 5.2 + 1e-9);
});

test('sprinting around a real wall corner keeps the trailing pivot clear and the camera facing forward', async () => {
  const environment = new THREE.Group();
  for (const [size, position] of [[[30, .2, 30], [0, -.1, 0]], [[5, 5, 5], [2.5, 2.5, 2.5]]]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size));
    mesh.position.set(...position); environment.add(mesh);
  }
  const player = await createPlayerController(environment, new THREE.Vector3(-.27, .04, 3));
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera((from, to) => player.constrainCamera(from, to));
  const diagonal = new THREE.Vector3(1, 0, -1).normalize(), right = new THREE.Vector3(1, 0, 0);
  const expected = new THREE.Vector3(0, -Math.sin(.23), Math.cos(.23));
  try {
    for (let index = 0; index < 120; index++) player.update(1 / 60, new THREE.Vector3(), false, false);
    // Start facing the approach; this scenario measures the wall-corner
    // camera path, not an unrelated standing half-turn before approaching it.
    player.object.rotation.y = Math.atan2(diagonal.x, diagonal.z);
    for (let index = 0; index < 100; index++) {
      player.update(1 / 60, player.position.z > 0 ? diagonal : right, true, false);
      rig.update(camera, 1 / 60, frame(player.renderPosition, { grounded: player.grounded, yaw: Math.PI }));
      const head = look(player.renderPosition);
      assert.ok(player.constrainCamera(head, head.clone().addScaledVector(expected, -5.2)).distanceTo(head) > 5.19,
        'the requested view from the character is unobstructed throughout the turn');
      assert.ok(rig.armLength > 5.1, `frame ${index}: the trailing pivot collapsed an otherwise clear arm to ${rig.armLength}`);
      assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(expected) > .999, `frame ${index}: orbit direction changed`);
    }
    assert.ok(player.position.x > 2, 'the character rounded the corner');
  } finally {
    player.dispose(); environment.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  }
});

test('a genuinely blocked arm retains the requested orbit direction even at zero length', () => {
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(from => from), feet = new THREE.Vector3();
  for (const yaw of [Math.PI / 2, Math.PI, -.7]) {
    const pitch = .4;
    rig.update(camera, 1 / 60, frame(feet, { yaw, pitch }));
    assert.equal(rig.armLength, 0);
    const expected = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    assert.ok(camera.getWorldDirection(new THREE.Vector3()).dot(expected) > .999999, 'a collapsed arm must not reset the viewing direction');
  }
});

test('handheld offsets cannot move the final lens past its collision clearance', () => {
  // The camera sphere may move up to x=1 beside a wall. Its unshifted arm is
  // clear, but the normal 1.5 cm handheld offset would cross that clearance.
  const constrain = (from, to) => to.x <= 1 ? to : from.clone().lerp(to, (1 - from.x) / (to.x - from.x));
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(constrain), feet = new THREE.Vector3(.99, 0, 0);
  rig.update(camera, 1 / 60, frame(feet, { offset: { yaw: 0, pitch: 0, roll: 0, lateral: .015, vertical: .012 } }));
  assert.ok(camera.position.x <= 1 + 1e-9, `the final camera crossed the wall clearance: ${camera.position.x}`);
});

test('stair steps glide the view while a jump barely lifts the horizon', () => {
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(open), feet = new THREE.Vector3();
  rig.update(camera, 0, frame(feet));
  feet.y = .2; rig.update(camera, 1 / 60, frame(feet));
  const lifted = camera.position.y - (1.25 + Math.sin(.23) * 5.2);
  assert.ok(lifted > .02 && lifted < .05, `one frame after a 0.2 m riser the view rose ${lifted.toFixed(3)} m`);
  for (let step = 0; step < 30; step++) rig.update(camera, 1 / 60, frame(feet));
  assert.ok(Math.abs(camera.position.y - (1.45 + Math.sin(.23) * 5.2)) < .01, 'the view settles on the new tread');

  const jump = createFollowCamera(open), ground = new THREE.Vector3();
  jump.update(camera, 0, frame(ground));
  let highest = -Infinity;
  for (let t = 0; t <= .62; t += 1 / 120) {
    ground.y = Math.max(0, 5.5 * t - 9 * t * t);
    jump.update(camera, 1 / 120, frame(ground, { grounded: ground.y === 0 && t > 0 }));
    highest = Math.max(highest, camera.position.y);
  }
  const rise = highest - (1.25 + Math.sin(.23) * 5.2);
  assert.ok(rise < .1, `the 0.84 m jump lifted the camera ${rise.toFixed(3)} m`);
  // Walking off a ledge is followed down promptly.
  const ledge = createFollowCamera(open), fall = new THREE.Vector3(0, 3, 0);
  ledge.update(camera, 0, frame(fall));
  for (let t = 0; t <= .6; t += 1 / 120) { fall.y = 3 - 11.5 * t * t; ledge.update(camera, 1 / 120, frame(fall, { grounded: false })); }
  assert.ok(camera.position.y < fall.y + 1.25 + Math.sin(.23) * 5.2 + .65, 'a long fall keeps the character in frame');
});

test('the rig gives the same path at 30, 60 and 144 Hz', () => {
  const sample = hz => {
    const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(open), feet = new THREE.Vector3();
    rig.update(camera, 0, frame(feet));
    for (let index = 1; index <= hz * 2; index++) {
      const t = index / hz;
      feet.set(5.2 * t, t > 1 ? .2 : 0, Math.sin(t) * 2);
      rig.update(camera, 1 / hz, frame(feet, { yaw: t * .4, distance: t > .5 ? 3 : 5.2 }));
    }
    return camera.position.clone();
  };
  // Only the sampling of a moving target differs: about v·Δt/2 at 30 Hz.
  const baseline = sample(60);
  assert.ok(sample(30).distanceTo(baseline) < .06, `30 Hz differs by ${sample(30).distanceTo(baseline)}`);
  assert.ok(sample(144).distanceTo(baseline) < .03, `144 Hz differs by ${sample(144).distanceTo(baseline)}`);
});

test('a hard landing dips the view a few centimetres, and reduced motion removes it', () => {
  const run = reducedMotion => {
    const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(open), feet = new THREE.Vector3();
    rig.update(camera, 0, frame(feet));
    const rest = camera.position.y;
    let lowest = rest;
    rig.update(camera, 1 / 60, frame(feet, { landingSpeed: 9, reducedMotion }));
    for (let step = 0; step < 60; step++) { rig.update(camera, 1 / 60, frame(feet, { reducedMotion })); lowest = Math.min(lowest, camera.position.y); }
    return { dip: rest - lowest, settled: Math.abs(camera.position.y - rest) };
  };
  const normal = run(false), reduced = run(true);
  assert.ok(normal.dip > .015 && normal.dip < .05, `dip ${normal.dip}`);
  assert.ok(normal.settled < .002);
  assert.equal(reduced.dip, 0);
});

test('first person keeps the eye at head height and looks opposite the orbit arm', () => {
  const camera = new THREE.PerspectiveCamera(), rig = createFollowCamera(open), feet = new THREE.Vector3(3, 0, -2);
  rig.update(camera, 0, frame(feet, { firstPerson: true, height: 1.57, yaw: Math.PI / 2, pitch: 0 }));
  assert.ok(camera.position.distanceTo(new THREE.Vector3(3, 1.57, -2)) < 1e-9);
  const direction = camera.getWorldDirection(new THREE.Vector3());
  assert.ok(direction.x < -.99, 'yaw π/2 places the arm at +X, so the eye looks toward −X');
  assert.equal(rig.armLength, 0);
});
