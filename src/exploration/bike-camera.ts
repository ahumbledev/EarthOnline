import * as THREE from 'three';

/** A level horizon and a short, damped arm let the rider lean without tilting the view. */
export function createBikeCamera() {
  const pivot = new THREE.Vector3(), target = new THREE.Vector3(), desired = new THREE.Vector3();
  const forward = new THREE.Vector3(), direction = new THREE.Vector3();
  let ready = false, heading = 0, arm = 0;
  return {
    reset() { ready = false; },
    update(camera: THREE.PerspectiveCamera, pose: { position: THREE.Vector3; quaternion: THREE.Quaternion }, speed: number,
      dt: number, constrain: (target: THREE.Vector3, desired: THREE.Vector3) => THREE.Vector3, lookOffset = 0) {
      const step = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
      forward.set(0, 0, 1).applyQuaternion(pose.quaternion);
      const nextHeading = Math.atan2(forward.x, forward.z) + lookOffset;
      if (!ready) { pivot.copy(pose.position); heading = nextHeading; }
      else {
        const turn = THREE.MathUtils.euclideanModulo(nextHeading - heading + Math.PI, Math.PI * 2) - Math.PI;
        heading += turn * (1 - Math.exp(-5.5 * step));
        pivot.x += (pose.position.x - pivot.x) * (1 - Math.exp(-28 * step));
        pivot.z += (pose.position.z - pivot.z) * (1 - Math.exp(-28 * step));
        pivot.y += (pose.position.y - pivot.y) * (1 - Math.exp(-8 * step));
      }
      forward.set(Math.sin(heading), 0, Math.cos(heading));
      target.copy(pivot).addScaledVector(forward, .45); target.y += 1.25;
      const portrait = THREE.MathUtils.clamp(.75 / Math.max(.2, camera.aspect), 1, 1.8);
      desired.copy(pivot).addScaledVector(forward, -(4.1 * portrait + Math.min(.8, Math.abs(speed) * .075)));
      desired.y += 2.25 * Math.sqrt(portrait);
      direction.subVectors(desired, target);
      const requested = direction.length(); direction.divideScalar(requested);
      const clear = Math.min(requested, constrain(target, desired).distanceTo(target));
      arm = !ready || clear < arm ? clear : arm + (clear - arm) * (1 - Math.exp(-4 * step));
      camera.position.copy(target).addScaledVector(direction, arm); camera.lookAt(target);
      if (camera.near !== .12) { camera.near = .12; camera.updateProjectionMatrix(); }
      ready = true;
    },
  };
}
