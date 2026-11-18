import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { frameWorkshopCamera } from '../src/minigames/camera.ts';

function assertFramed(definition, aspect) {
  const frame = frameWorkshopCamera(definition, aspect);
  const camera = new PerspectiveCamera(frame.fov, frame.aspect, frame.near, frame.far);
  camera.position.set(...frame.position); camera.lookAt(...frame.target); camera.updateMatrixWorld();
  const top = Math.max(1.1, ...definition.entities.map(entity => entity.position[1] + entity.size[1] / 2));
  for (const x of [-definition.width / 2 - .6, definition.width / 2 + .6]) {
    for (const y of [-.35, top]) {
      for (const z of [-definition.depth / 2 - .6, definition.depth / 2 + .6]) {
        const projected = new Vector3(x, y, z).project(camera);
        assert.ok(Math.abs(projected.x) < 1, `horizontal crop at ${[x, y, z]}: ${projected.x}`);
        assert.ok(Math.abs(projected.y) < 1, `vertical crop at ${[x, y, z]}: ${projected.y}`);
        assert.ok(projected.z > -1 && projected.z < 1, `depth clipping at ${[x, y, z]}: ${projected.z}`);
      }
    }
  }
  return frame;
}

test('maximum 200m arena fits the camera frustum on desktop and portrait mobile', () => {
  const definition = { width: 200, depth: 200, entities: [] };
  for (const aspect of [16 / 9, 1, 320 / 800]) {
    const frame = assertFramed(definition, aspect);
    assert.ok(frame.far > 200, 'the far plane must follow the actual camera distance');
  }
});

test('50m high entities and the arena floor stay framed across wide and narrow layouts', () => {
  for (const [width, depth] of [[200, 200], [200, 4], [4, 200], [4, 4]]) {
    const definition = { width, depth, entities: [{ position: [0, 25, 0], size: [1, 50, 1], visible: false }] };
    for (const aspect of [1920 / 360, 16 / 9, 1, 320 / 800]) assertFramed(definition, aspect);
  }
});
