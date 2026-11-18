import * as THREE from 'three';

/** A small camera-only follow delay; never writes back into the player pose. */
export function createCharacterFollow() {
  const pivot = new THREE.Vector3();
  let initialized = false;
  return {
    update(target: THREE.Vector3, dt = 0): THREE.Vector3 {
      // Navigation and view switches call without dt. Large corrections also
      // snap, so travel never sweeps the camera through the city.
      if (!initialized || !(dt > 0) || !Number.isFinite(dt) || pivot.distanceToSquared(target) > 64) {
        pivot.copy(target); initialized = true;
      } else {
        const horizontal = 1 - Math.exp(-14 * dt), vertical = 1 - Math.exp(-8 * dt);
        pivot.x += (target.x - pivot.x) * horizontal;
        pivot.z += (target.z - pivot.z) * horizontal;
        pivot.y += (target.y - pivot.y) * vertical;
      }
      return pivot;
    },
  };
}

type CameraConstraint = (target: THREE.Vector3, desired: THREE.Vector3) => THREE.Vector3;
const UP = new THREE.Vector3(0, 1, 0);
/** How fast the arm shortens ahead of an obstacle and lengthens again, metres per second. */
const ARM_PULL = 14, ARM_RELEASE = 7;
/** Arms cast to either side of the camera arm: yaw offset in radians, and the share of the free length an obstacle there still leaves. */
const WHISKERS: readonly (readonly [number, number])[] = [[-.42, 2 / 3], [-.21, 1 / 3], [.21, 1 / 3], [.42, 2 / 3]];

/**
 * A third-person arm that does not leap. An arm that stops only where it strikes moves the lens between
 * full length and the player's head the frame a wall or post crosses it, which reads as flashing while
 * walking or turning along a street. Arms to either side find the obstacle first, so the lens eases in
 * ahead of it and out again after. The arm's own hit stays a hard limit: the lens never sits inside a wall.
 */
export function createCameraArm() {
  const clear = new THREE.Vector3(), whisker = new THREE.Vector3();
  let length = 0, placed = false;
  return {
    /**
     * Write the lens position for this frame. Without dt (a look or view change between frames) the arm keeps its length.
     * `sides` casts the arms to either side; leave it out where only the centre arm can be constrained.
     */
    place(out: THREE.Vector3, target: THREE.Vector3, desired: THREE.Vector3, dt: number, constrain: CameraConstraint, sides: CameraConstraint | undefined = constrain): THREE.Vector3 {
      // The constraint may hand back a vector it reuses.
      clear.copy(constrain(target, desired));
      const full = desired.distanceTo(target), reach = clear.distanceTo(target);
      let ahead = full;
      if (sides) for (const [angle, keep] of WHISKERS) {
        whisker.copy(desired).sub(target).applyAxisAngle(UP, angle).add(target);
        const free = sides(target, whisker).distanceTo(target);
        ahead = Math.min(ahead, free + (full - free) * keep);
      }
      if (!placed) { length = ahead; placed = true; }
      else if (dt > 0 && Number.isFinite(dt)) length += THREE.MathUtils.clamp(ahead - length, -dt * ARM_PULL, dt * ARM_RELEASE);
      length = Math.min(length, reach);
      return reach > 1e-6 ? out.copy(clear).sub(target).setLength(length).add(target) : out.copy(target);
    },
  };
}
