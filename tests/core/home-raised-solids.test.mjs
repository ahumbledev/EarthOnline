import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { raisedSolidBoxes } from '../../src/home/raised-solids.ts';
import { createPlayerController } from '../../src/exploration/player.ts';
import { createHomePropPhysics } from '../../src/home/prop-physics.ts';

/** Triangles of closed boxes, as the home view collects them from a model. */
function triangles(...boxes) {
  const out = [];
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).toNonIndexed();
    geometry.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    out.push(...geometry.getAttribute('position').array);
  }
  return out;
}
const region = { minX: -.5, maxX: .5, minZ: -.9, maxZ: .9, base: .46, top: .95 };
// A sofa facing +X: seat, backrest along -X, an arm at each end.
const sofa = triangles([-.5, 0, -.9, .5, .46, .9], [-.5, .2, -.9, -.3, .94, .9], [-.3, .2, -.9, .5, .66, -.72], [-.3, .2, .72, .5, .66, .9]);
const covers = (boxes, x, y, z) => boxes.some(box => x > box.min[0] && x < box.max[0] && y > box.min[1] && y < box.max[1] && z > box.min[2] && z < box.max[2]);

test('a sofa gets a solid back and arms while its seat stays open', () => {
  const boxes = raisedSolidBoxes(sofa, region);
  assert.ok(boxes.length >= 3 && boxes.length <= 12, `a handful of boxes, got ${boxes.length}`);
  assert.ok(covers(boxes, -.4, .8, 0), 'the backrest is solid');
  assert.ok(covers(boxes, .2, .58, -.82) && covers(boxes, .2, .58, .82), 'both arms are solid');
  assert.ok(!covers(boxes, .1, .6, 0), 'the space above the seat is open');
  assert.ok(!covers(boxes, .2, .8, .82), 'an arm is not as tall as the back');
  for (const box of boxes) assert.ok(box.min[1] === region.base && box.max[1] <= region.top + 1e-6);
});

test('a canopy does not fill the space over a mattress, but a headboard and a resting pillow are solid', () => {
  const bed = triangles([-.5, 0, -.9, .5, .46, .9], [-.5, 0, -.9, -.42, .95, .9], [-.5, 1.6, -.9, .5, 1.66, .9], [-.3, .5, -.3, 0, .66, .3]);
  const boxes = raisedSolidBoxes(bed, { ...region, top: 1.66 });
  assert.ok(covers(boxes, -.46, .9, 0), 'the headboard is solid');
  assert.ok(covers(boxes, -.15, .55, 0), 'a pillow a little above the mattress is part of the bed');
  assert.ok(!covers(boxes, .3, 1, 0), 'under the canopy is open');
});

test('a headboard that leans back is solid although each of its columns has air under it', () => {
  // A thin slab tilted away from the mattress, standing on the frame at the head end.
  const panel = new THREE.BoxGeometry(.04, .7, 1.8).toNonIndexed();
  panel.rotateZ(.25); panel.translate(-.42, .75, 0);
  const bed = [...triangles([-.5, 0, -.9, .5, .46, .9]), ...panel.getAttribute('position').array];
  const boxes = raisedSolidBoxes(bed, { ...region, top: 1.15 });
  assert.ok(covers(boxes, -.47, 1, 0), 'the top of the leaning headboard is solid');
  assert.ok(!covers(boxes, 0, .7, 0), 'the mattress stays open');
});

test('an upright panel with no top or underside of its own, capped by a rail, is solid', () => {
  // Two upright faces only, as modelled when the caps are hidden inside the frame and the rail.
  const face = x => [x, .46, -.9, x, 1.05, -.9, x, 1.05, .9, x, .46, -.9, x, 1.05, .9, x, .46, .9];
  const bed = [...triangles([-.5, 0, -.9, .5, .46, .9], [-.5, 1.05, -.9, -.4, 1.15, .9]), ...face(-.47), ...face(-.43)];
  const boxes = raisedSolidBoxes(bed, { ...region, top: 1.15 });
  assert.ok(covers(boxes, -.45, .8, 0) && covers(boxes, -.45, 1.1, 0), 'the panel and its rail are solid');
  assert.ok(!covers(boxes, -.2, .7, 0), 'the mattress stays open');
});

test('a flat top yields nothing', () => {
  assert.deepEqual(raisedSolidBoxes(triangles([-.5, 0, -.9, .5, .46, .9]), region), []);
});

test('a carried box is stopped by the sofa back instead of passing through it', async () => {
  const environment = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, .2, 8)); floor.position.y = -.1; environment.add(floor);
  const player = await createPlayerController(environment, new THREE.Vector3(3, .05, 3));
  const physics = player.attachPhysics(createHomePropPhysics);
  try {
    const slab = { min: [-.5, 0, -.9], max: [.5, .46, .9] };
    physics.addStatic({ id: 'sofa', shape: { kind: 'box' }, size: { width: 1, depth: 1.8, height: .46 }, blocks: [slab, ...raisedSolidBoxes(sofa, region)], position: new THREE.Vector3(), yaw: 0 });
    const box = physics.addDynamic({ id: 'box', shape: { kind: 'box' }, size: { width: .3, depth: .3, height: .25 }, mass: 1, position: new THREE.Vector3(.15, .47, 0), quaternion: new THREE.Quaternion() });
    for (let i = 0; i < 30; i++) player.update(1 / 60, new THREE.Vector3(), false, false);
    assert.ok(physics.grab('box', new THREE.Vector3(.15, .6, 0)));
    // The hand pulls it toward a point behind the backrest.
    physics.dragTo(new THREE.Vector3(-1.2, .6, 0));
    for (let i = 0; i < 120; i++) player.update(1 / 60, new THREE.Vector3(), false, false);
    assert.ok(box.position.x > -.16, `the box stays in front of the backrest, x = ${box.position.x}`);
    const hit = physics.solidHit(new THREE.Vector3(1.5, .8, 0), new THREE.Vector3(-1, 0, 0), 3);
    assert.ok(hit && Math.abs(hit.distance - 1.8) < .08 && hit.normal.x > .9, 'a view ray lands on the front of the backrest');
  } finally { player.dispose(); }
});
