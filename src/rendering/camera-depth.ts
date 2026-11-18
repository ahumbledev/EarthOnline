import type { PerspectiveCamera } from 'three';

export const EXPLORATION_CLIP = {
  walking: { near: 0.18, far: 360 },
  overview: { near: 1, far: 800 },
} as const;

/** A city overview and an eye-level camera need different precision budgets. */
export function setExplorationClip(camera: PerspectiveCamera, overview: boolean): void {
  const clip = EXPLORATION_CLIP[overview ? 'overview' : 'walking'];
  if (camera.near === clip.near && camera.far === clip.far) return;
  camera.near = clip.near; camera.far = clip.far;
  camera.updateProjectionMatrix();
}
