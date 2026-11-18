import * as THREE from 'three';
import type { FollowCameraOffset } from './camera-motion.ts';

/** One frame of a walking character's camera request. Angles follow the views' orbit convention. */
export interface FollowCameraFrame {
  /** Interpolated feet position; never the raw fixed-step physics state. */
  feet: THREE.Vector3;
  grounded: boolean;
  /** Orbit heading and elevation. The arm points along (sin yaw · cos pitch, sin pitch, cos yaw · cos pitch). */
  yaw: number;
  pitch: number;
  /** Requested arm length before collision, m. */
  distance: number;
  /** Look-at point above the feet, m. */
  height: number;
  firstPerson?: boolean;
  /** Render-only hover and handheld offsets from createFollowCameraMotion. */
  offset?: Readonly<FollowCameraOffset>;
  /** Downward landing speed reported by the controller this frame, m/s. */
  landingSpeed?: number;
  reducedMotion?: boolean;
  minPitch?: number;
  maxPitch?: number;
}

/** Response rates, 1/s. The orbit angles themselves are never smoothed: drag input stays exact. */
export const FOLLOW_CAMERA_RESPONSE = {
  horizontal: 12,
  /** Stairs and kerbs move the feet in steps; the view glides over them. */
  grounded: 10,
  /** A jump barely lifts the horizon, a fall is followed promptly. */
  rising: 2.5,
  falling: 7,
  eye: 18,
  zoom: 10,
  /** Arms shorten at once against a wall and ease back out once clear. */
  armRecovery: 5,
} as const;
/** Furthest the look point may trail the character, m. */
const MAX_TRAIL = 1.2, MAX_DROP_BEHIND = .6, MAX_RISE_AHEAD = .35;
/** A standing jump's height: hops below it keep the horizon level; higher launches lift the view. */
const HOP_HEIGHT = .9;
/** A released arm dollies back out no faster than this, m/s. */
const ARM_RECOVERY_SPEED = 4;
const LANDING_STIFFNESS = 12, LANDING_IMPULSE = .16, LANDING_IMPULSE_LIMIT = 1, LANDING_THRESHOLD = 2.5;

const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/**
 * Third- and first-person follow camera. The look point trails the character
 * slightly for weight; the arm then hangs from it at the exact orbit angles,
 * so a fast drag rotates the view without swinging the camera inward.
 */
export function createFollowCamera(constrain: (from: THREE.Vector3, to: THREE.Vector3) => THREE.Vector3) {
  const pivot = new THREE.Vector3(), look = new THREE.Vector3(), arm = new THREE.Vector3(), desired = new THREE.Vector3();
  const target = new THREE.Vector3(), head = new THREE.Vector3(), aim = new THREE.Vector3();
  let ready = false, armLength = 0, zoom = 0, eye = 0, dip = 0, dipVelocity = 0, wasFirstPerson = false;
  let takeoff: number | undefined;

  return {
    /** Collision-limited arm of the latest third-person frame, m; 0 in first person. */
    get armLength() { return armLength; },
    /** Place the next frame exactly, e.g. after a teleport, a scene load or a mode change. */
    snap() { ready = false; },
    update(camera: THREE.PerspectiveCamera, deltaSeconds: number, frame: FollowCameraFrame) {
      const dt = Number.isFinite(deltaSeconds) ? THREE.MathUtils.clamp(deltaSeconds, 0, .1) : 0;
      const firstPerson = !!frame.firstPerson;
      if (firstPerson !== wasFirstPerson) ready = false;
      wasFirstPerson = firstPerson;
      target.copy(frame.feet).y += frame.height;
      // Hold the take-off height through an ordinary hop; drops below it and
      // genuinely high launches are still followed.
      if (frame.grounded || firstPerson) takeoff = undefined;
      else takeoff ??= frame.feet.y;
      if (takeoff !== undefined && frame.feet.y > takeoff) target.y = takeoff + frame.height + Math.max(0, frame.feet.y - takeoff - HOP_HEIGHT);
      if (!ready) {
        pivot.copy(target); eye = frame.feet.y + frame.height; zoom = frame.distance; armLength = frame.distance;
        dip = 0; dipVelocity = 0; ready = true;
      } else {
        const follow = ease(FOLLOW_CAMERA_RESPONSE.horizontal, dt);
        pivot.x += (target.x - pivot.x) * follow;
        pivot.z += (target.z - pivot.z) * follow;
        const vertical = frame.grounded ? FOLLOW_CAMERA_RESPONSE.grounded
          : target.y > pivot.y ? FOLLOW_CAMERA_RESPONSE.rising : FOLLOW_CAMERA_RESPONSE.falling;
        pivot.y += (target.y - pivot.y) * ease(vertical, dt);
        eye += (frame.feet.y + frame.height - eye) * ease(FOLLOW_CAMERA_RESPONSE.eye, dt);
        zoom += (frame.distance - zoom) * ease(FOLLOW_CAMERA_RESPONSE.zoom, dt);
        // A landing settles the whole view a few centimetres, like a camera
        // operator's knees; a critically damped spring returns it.
        const impact = frame.landingSpeed ?? 0;
        if (!frame.reducedMotion && impact > LANDING_THRESHOLD) {
          dipVelocity -= Math.min(LANDING_IMPULSE_LIMIT, (impact - LANDING_THRESHOLD) * LANDING_IMPULSE);
        }
        for (let remaining = dt; remaining > 1e-6;) {
          const step = Math.min(remaining, 1 / 120);
          dipVelocity -= (LANDING_STIFFNESS * LANDING_STIFFNESS * dip + 2 * LANDING_STIFFNESS * dipVelocity) * step;
          dip += dipVelocity * step;
          remaining -= step;
        }
        if (frame.reducedMotion) dip = dipVelocity = 0;
      }
      // Keep the character in frame however fast it moves or falls.
      const trailX = pivot.x - target.x, trailZ = pivot.z - target.z, trail = Math.hypot(trailX, trailZ);
      if (trail > MAX_TRAIL) { pivot.x = target.x + trailX / trail * MAX_TRAIL; pivot.z = target.z + trailZ / trail * MAX_TRAIL; }
      pivot.y = THREE.MathUtils.clamp(pivot.y, target.y - MAX_DROP_BEHIND, target.y + MAX_RISE_AHEAD);

      const offset = frame.offset;
      const yaw = frame.yaw + (offset?.yaw ?? 0);
      const pitch = THREE.MathUtils.clamp(frame.pitch + (offset?.pitch ?? 0), frame.minPitch ?? -1.5, frame.maxPitch ?? 1.5);
      arm.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      if (firstPerson) {
        armLength = 0;
        camera.position.set(target.x, eye + dip, target.z);
        camera.lookAt(aim.copy(camera.position).sub(arm));
      } else {
        look.copy(pivot).y += dip;
        // A trailing pivot can cut across a corner even when the character's
        // capsule has cleared it. Sweep from the current head before casting
        // the arm, so that cast never starts inside a wall. Use the real head
        // height: a hop's horizon target can still be below the new support.
        head.copy(frame.feet).y += frame.height;
        if (head.distanceToSquared(look) > 1e-8) look.copy(constrain(head, look));
        desired.copy(look).addScaledVector(arm, zoom);
        const clear = constrain(look, desired).distanceTo(look);
        armLength = clear < armLength ? clear : armLength + Math.min(ARM_RECOVERY_SPEED * dt,
          (Math.min(zoom, clear) - armLength) * ease(FOLLOW_CAMERA_RESPONSE.armRecovery, dt));
        camera.position.copy(look).addScaledVector(arm, armLength);
        if (offset && (offset.lateral || offset.vertical)) {
          camera.position.x += Math.cos(yaw) * offset.lateral;
          camera.position.z -= Math.sin(yaw) * offset.lateral;
          camera.position.y += offset.vertical;
          camera.position.copy(constrain(look, camera.position));
          armLength = Math.min(armLength, camera.position.distanceTo(look));
        }
        // A fully blocked arm can coincide with the pivot. Looking at that
        // same point gives Three.js no direction; keep the orbit angles exact.
        camera.lookAt(aim.copy(camera.position).sub(arm));
      }
      if (offset?.roll) camera.rotateZ(offset.roll);
      camera.updateMatrixWorld();
    },
  };
}
