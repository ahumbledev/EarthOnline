import test from 'node:test';
import assert from 'node:assert/strict';
import { OrthographicCamera, Vector3 } from 'three';
import { fitRoomCamera } from '../../src/room/framing.ts';

const bounds = { width: 5, depth: 5.8, height: 2.85 };
// Authored wall/trim corners, floor base and the visible cube-outline top.
const corners = [
  [-2.68, -.26, -3.08], [2.68, -.26, -3.08], [-2.68, -.26, 3.08], [2.68, -.26, 3.08],
  [-2.68, 2.875, -3.08], [2.68, 2.875, -3.08], [-2.68, 2.875, 3.08],
].map(point => new Vector3(...point));

function screenBounds(fit, viewport, points = corners) {
  const camera = new OrthographicCamera(fit.left, fit.right, fit.top, fit.bottom, .1, 100);
  camera.position.copy(fit.position); camera.lookAt(fit.target); camera.updateMatrixWorld();
  const pixels = points.map(point => {
    const p = point.clone().project(camera);
    assert.ok(p.z >= -1 && p.z <= 1, 'room fits camera depth range');
    return { x: (p.x + 1) * viewport.width / 2, y: (1 - p.y) * viewport.height / 2 };
  });
  return {
    left: Math.min(...pixels.map(p => p.x)), right: Math.max(...pixels.map(p => p.x)),
    top: Math.min(...pixels.map(p => p.y)), bottom: Math.max(...pixels.map(p => p.y)),
  };
}

test('the authored cutaway tightly fits its HUD safe area at desktop and portrait sizes', () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    const fit = fitRoomCamera({ bounds, viewport });
    const screen = screenBounds(fit, viewport), narrow = viewport.width <= 700;
    const margin = narrow ? 12 : 20, bottom = narrow ? 84 : 85;
    assert.ok(screen.left >= margin - 1e-6 && screen.right <= viewport.width - margin + 1e-6);
    assert.ok(screen.top >= 68 - 1e-6 && screen.bottom <= viewport.height - bottom + 1e-6);
    assert.ok(Math.abs((screen.left + screen.right) / 2 - viewport.width / 2) < 1e-6);
    assert.ok(Math.abs((screen.top + screen.bottom) / 2 - (68 + viewport.height - bottom) / 2) < 1e-6);
    const fillsWidth = Math.abs(screen.right - screen.left - (viewport.width - margin * 2)) < 1e-6;
    const fillsHeight = Math.abs(screen.bottom - screen.top - (viewport.height - 68 - bottom)) < 1e-6;
    assert.ok(fillsWidth || fillsHeight, 'one safe-area dimension is filled rather than padded again');
    const direction = fit.position.clone().sub(fit.target).normalize();
    assert.ok(direction.distanceTo(new Vector3(1, 1, 1).normalize()) < 1e-9);
  }
});

test('explicit zoom enlarges around the same safe-area center and can intentionally crop', () => {
  const viewport = { width: 1280, height: 720 };
  const normal = screenBounds(fitRoomCamera({ bounds, viewport }), viewport);
  const larger = screenBounds(fitRoomCamera({ bounds, viewport, zoom: 1.65 }), viewport);
  assert.ok(Math.abs((larger.bottom - larger.top) / (normal.bottom - normal.top) - 1.65) < 1e-9);
  assert.ok(Math.abs(larger.top + larger.bottom - normal.top - normal.bottom) < 1e-6);
  assert.ok(larger.top < 68 && larger.bottom > viewport.height - 85);
  assert.deepEqual(fitRoomCamera({ bounds, viewport, zoom: 100 }), fitRoomCamera({ bounds, viewport, zoom: 1.65 }));
});

test('an authored hull can be translated without changing its fitted size or screen center', () => {
  const viewport = { width: 1280, height: 720 }, shift = new Vector3(10, 4, -7);
  const shiftedPoints = corners.map(point => point.clone().add(shift));
  const original = fitRoomCamera({ bounds, viewport, points: corners });
  const shifted = fitRoomCamera({ bounds, viewport, points: shiftedPoints });
  assert.ok(shifted.target.clone().sub(original.target).distanceTo(shift) < 1e-9);
  assert.ok(Math.abs(shifted.right - shifted.left - original.right + original.left) < 1e-9);
  const screen = screenBounds(shifted, viewport, shiftedPoints);
  assert.ok(Math.abs(screen.top - 68) < 1e-6 && Math.abs(screen.bottom - 635) < 1e-6);
});

test('tiny viewports stay finite, while invalid geometry is rejected', () => {
  for (const viewport of [{ width: 1, height: 1 }, { width: 200, height: 100 }]) {
    const fit = fitRoomCamera({ bounds, viewport });
    assert.ok([fit.left, fit.right, fit.top, fit.bottom, ...fit.target.toArray(), ...fit.position.toArray()].every(Number.isFinite));
    assert.ok(fit.right > fit.left && fit.top > fit.bottom);
  }
  assert.throws(() => fitRoomCamera({ bounds, viewport: { width: 0, height: 720 } }), RangeError);
  assert.throws(() => fitRoomCamera({ bounds: { ...bounds, height: NaN }, viewport: { width: 1280, height: 720 } }), RangeError);
  assert.throws(() => fitRoomCamera({ bounds, viewport: { width: 1280, height: 720 }, points: [] }), RangeError);
});
