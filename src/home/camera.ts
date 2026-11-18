import * as THREE from 'three';
import type { FollowCameraFrame } from '../exploration/follow-camera.ts';
import type { HomeBounds } from './state.ts';

/**
 * One perspective camera serves both views. The decorating view is a narrow
 * field of view far above the room: visually an isometric diorama, yet its
 * position, orientation and field of view can be eased from the walking camera.
 */
export type HomeCameraMode = 'follow' | 'isometric';
export type QuarterTurn = 0 | 1 | 2 | 3;
export interface CameraPose { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number }

export const FOLLOW_FOV = 55;
export const ISO_FOV = { default: 16, min: 11, max: 24 } as const;
export const ISO_PITCH = THREE.MathUtils.degToRad(38);
export const TRANSITION_SECONDS = .45;

const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Camera placement that shows the whole room from above one corner. */
export function isometricPose(bounds: HomeBounds, quarter: QuarterTurn, fov: number, aspect: number): { position: THREE.Vector3; target: THREE.Vector3; distance: number } {
  const yaw = quarter * Math.PI / 2 + Math.PI / 4;
  const target = new THREE.Vector3(0, bounds.height * .28, 0);
  // Fit the room's bounding sphere in the narrower of the two half-angles, with a small margin for the HUD.
  const radius = Math.hypot(bounds.width, bounds.height, bounds.depth) / 2;
  const vertical = THREE.MathUtils.degToRad(fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(.2, aspect));
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.08;
  const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(ISO_PITCH), Math.sin(ISO_PITCH), Math.cos(yaw) * Math.cos(ISO_PITCH));
  return { position: target.clone().addScaledVector(direction, distance), target, distance };
}

/** Walls between the camera and the room interior; they are cut away in the diorama. */
export function wallsFacingCamera(bounds: HomeBounds, cameraPosition: THREE.Vector3): Set<'back' | 'front' | 'left' | 'right' | 'ceiling'> {
  const result = new Set<'back' | 'front' | 'left' | 'right' | 'ceiling'>();
  if (cameraPosition.z < -bounds.depth / 2) result.add('back');
  if (cameraPosition.z > bounds.depth / 2) result.add('front');
  if (cameraPosition.x < -bounds.width / 2) result.add('left');
  if (cameraPosition.x > bounds.width / 2) result.add('right');
  if (cameraPosition.y > bounds.height) result.add('ceiling');
  return result;
}

export function capturePose(camera: THREE.PerspectiveCamera): CameraPose {
  return { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
}

export function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose) {
  camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion);
  if (camera.fov !== pose.fov) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
  camera.updateMatrixWorld();
}

/** Blend two poses; rotation uses slerp so the horizon never flips on the way. */
export function blendPose(from: CameraPose, to: CameraPose, t: number, out: CameraPose): CameraPose {
  const k = easeInOut(THREE.MathUtils.clamp(t, 0, 1));
  out.position.lerpVectors(from.position, to.position, k);
  out.quaternion.slerpQuaternions(from.quaternion, to.quaternion, k);
  out.fov = THREE.MathUtils.lerp(from.fov, to.fov, k);
  return out;
}

interface FollowRig { update(camera: THREE.PerspectiveCamera, dt: number, frame: FollowCameraFrame): void; snap(): void; readonly armLength: number }

export function createHomeCameraRig(camera: THREE.PerspectiveCamera, follow: FollowRig, bounds: HomeBounds) {
  let mode: HomeCameraMode = 'follow';
  let quarter: QuarterTurn = 1;
  let fov: number = ISO_FOV.default;
  let transition: { from: CameraPose; target: HomeCameraMode; elapsed: number } | undefined;
  const scratch = camera.clone();
  const blended: CameraPose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: FOLLOW_FOV };
  const lookAt = new THREE.Matrix4();
  const isoTarget = (aspect: number): CameraPose => {
    const pose = isometricPose(bounds, quarter, fov, aspect);
    lookAt.lookAt(pose.position, pose.target, THREE.Object3D.DEFAULT_UP);
    return { position: pose.position, quaternion: new THREE.Quaternion().setFromRotationMatrix(lookAt), fov };
  };
  const followTarget = (dt: number, frame: FollowCameraFrame): CameraPose => {
    scratch.aspect = camera.aspect; scratch.fov = FOLLOW_FOV; scratch.updateProjectionMatrix();
    follow.update(scratch, dt, frame);
    return capturePose(scratch);
  };
  return {
    get mode() { return mode; },
    /** True while easing between the two views; input should wait. */
    get busy() { return !!transition; },
    get quarter() { return quarter; },
    get isoFov() { return fov; },
    /** The view currently being presented, including the destination of a running transition. */
    get presenting(): HomeCameraMode { return transition?.target ?? mode; },
    setMode(next: HomeCameraMode, snap = false) {
      if (next === mode && !transition) return;
      if (snap) { transition = undefined; mode = next; if (next === 'follow') follow.snap(); return; }
      if (transition?.target === next) return;
      transition = { from: capturePose(camera), target: next, elapsed: 0 };
      if (next === 'follow') follow.snap();
    },
    rotate(delta: number) { quarter = (((quarter + delta) % 4) + 4) % 4 as QuarterTurn; },
    zoom(deltaFov: number) { fov = THREE.MathUtils.clamp(fov + deltaFov, ISO_FOV.min, ISO_FOV.max); },
    update(dt: number, frame: FollowCameraFrame) {
      const step = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .1) : 0;
      if (transition) {
        transition.elapsed += step;
        const t = transition.elapsed / TRANSITION_SECONDS;
        const to = transition.target === 'isometric' ? isoTarget(camera.aspect) : followTarget(step, frame);
        if (t >= 1) { mode = transition.target; transition = undefined; applyPose(camera, to); return; }
        applyPose(camera, blendPose(transition.from, to, t, blended));
        return;
      }
      if (mode === 'isometric') { applyPose(camera, isoTarget(camera.aspect)); return; }
      if (camera.fov !== FOLLOW_FOV) { camera.fov = FOLLOW_FOV; camera.updateProjectionMatrix(); }
      follow.update(camera, step, frame);
    },
  };
}
export type HomeCameraRig = ReturnType<typeof createHomeCameraRig>;
