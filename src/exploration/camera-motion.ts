/** Small render-only offsets. The player's movement always uses the orbit's base heading. */
export const FOLLOW_CAMERA_LIMITS = {
  pointerYaw: 5 * Math.PI / 180,
  pointerPitch: 2 * Math.PI / 180,
  driftYaw: .12 * Math.PI / 180,
  driftPitch: .08 * Math.PI / 180,
  roll: .13 * Math.PI / 180,
  lateral: .015,
  vertical: .012,
} as const;

export interface FollowCameraOffset {
  yaw: number;
  pitch: number;
  roll: number;
  lateral: number;
  vertical: number;
}

interface CameraMotionInput {
  enabled: boolean;
  reducedMotion: boolean;
  /** Actual distance travelled / second, so pushing against a wall produces no step shake. */
  speed: number;
  grounded: boolean;
  sprinting: boolean;
}

const bounded = (value: number, limit = 1) => Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0;
const damp = (current: number, target: number, response: number, dt: number) => target + (current - target) * Math.exp(-response * dt);

/** Same damping at 30, 60, or 144 Hz; a short follow lag feels like a camera operator. */
export const followCameraAlpha = (deltaSeconds: number) => 1 - Math.exp(-8.5 * Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0));

export function createFollowCameraMotion() {
  const offset: FollowCameraOffset = { yaw: 0, pitch: 0, roll: 0, lateral: 0, vertical: 0 };
  let targetX = 0, targetY = 0, pointerX = 0, pointerY = 0;
  let elapsed = 0, stridePhase = 0, stepWeight = 0;

  function reset() {
    targetX = targetY = pointerX = pointerY = elapsed = stridePhase = stepWeight = 0;
    offset.yaw = offset.pitch = offset.roll = offset.lateral = offset.vertical = 0;
  }

  return {
    /** Absolute normalized canvas position, never an accumulated orbit rotation. */
    setPointer(x: number, y: number) { targetX = bounded(x); targetY = bounded(y); },
    clearPointer() { targetX = targetY = 0; },
    reset,
    update(deltaSeconds: number, input: CameraMotionInput): Readonly<FollowCameraOffset> {
      if (!input.enabled || input.reducedMotion) { reset(); return offset; }
      const dt = Number.isFinite(deltaSeconds) ? Math.max(0, Math.min(deltaSeconds, .1)) : 0;
      if (dt === 0) return offset;
      const speed = Math.max(0, bounded(input.speed, 6));
      pointerX = damp(pointerX, targetX, 5.5, dt);
      pointerY = damp(pointerY, targetY, 5.5, dt);
      stepWeight = damp(stepWeight, input.grounded ? Math.min(speed / 2.8, 1) : 0, 7, dt);
      elapsed += dt;
      stridePhase += speed * 2.6 * dt;
      const gaitScale = (input.sprinting ? 1 : .72) * stepWeight;
      // Mouse left rotates clockwise when seen from above. Low-frequency drift
      // is deterministic and stays around the base heading rather than walking away.
      offset.yaw = -pointerX * FOLLOW_CAMERA_LIMITS.pointerYaw
        + Math.sin(elapsed * .63) * FOLLOW_CAMERA_LIMITS.driftYaw;
      offset.pitch = -pointerY * FOLLOW_CAMERA_LIMITS.pointerPitch
        + Math.sin(elapsed * .47) * FOLLOW_CAMERA_LIMITS.driftPitch;
      offset.roll = (Math.sin(elapsed * .39) * .25 + Math.sin(stridePhase) * .75 * gaitScale) * FOLLOW_CAMERA_LIMITS.roll;
      offset.lateral = Math.sin(stridePhase) * FOLLOW_CAMERA_LIMITS.lateral * gaitScale;
      offset.vertical = (Math.sin(elapsed * .51) * .2 + Math.sin(stridePhase * 2) * .8 * gaitScale) * FOLLOW_CAMERA_LIMITS.vertical;
      return offset;
    },
  };
}
