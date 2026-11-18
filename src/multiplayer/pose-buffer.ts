type RideKind = 'electric-bike' | 'motorcycle' | 'car';

export interface TimedPose {
  riding?: RideKind;
  x: number; y: number; z: number; yaw: number; moving: boolean; sprinting: boolean;
  updatedAt: number; serverTime?: number;
}
export interface InterpolatedPose { riding?: RideKind; x: number; y: number; z: number; yaw: number; moving: boolean; sprinting: boolean }
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

/** Server timestamps absorb uneven delivery; at most 100 ms of loss is extrapolated. */
export function createPoseBuffer(delayMs = 120, extrapolationMs = 100) {
  const samples: TimedPose[] = [];
  let offset: number | undefined;
  return {
    push(pose: TimedPose, receivedAt: number) {
      if (![pose.x, pose.y, pose.z, pose.yaw, pose.updatedAt, receivedAt].every(Number.isFinite)) return;
      const last = samples.at(-1);
      if (last && pose.updatedAt < last.updatedAt) return;
      const measured = receivedAt - (Number.isFinite(pose.serverTime) ? pose.serverTime! : pose.updatedAt);
      const teleport = last && Math.hypot(pose.x - last.x, pose.y - last.y, pose.z - last.z) > 12;
      if (teleport || offset !== undefined && Math.abs(measured - offset) > 2000) { samples.length = 0; offset = measured; }
      else offset = offset === undefined ? measured : offset + Math.max(-10, Math.min(10, measured - offset)) * .1;
      if (samples.at(-1)?.updatedAt === pose.updatedAt) samples[samples.length - 1] = { ...pose };
      else samples.push({ ...pose });
      if (samples.length > 12) samples.shift();
    },
    sample(now: number, out: InterpolatedPose): boolean {
      if (!samples.length || offset === undefined) return false;
      const time = now - offset - delayMs;
      while (samples.length > 2 && samples[1].updatedAt <= time) samples.shift();
      const first = samples[0], last = samples.at(-1)!;
      let a = first, b = first, t = 0;
      if (time >= last.updatedAt && samples.length > 1) {
        a = samples[samples.length - 2]; b = last;
        const duration = b.updatedAt - a.updatedAt;
        t = duration > 0 ? 1 + (b.moving ? Math.min(extrapolationMs, time - b.updatedAt) / duration : 0) : 1;
        // A slow arrival after a stationary interval is not a usable velocity.
        if (duration > 500) t = 1;
      } else if (time > first.updatedAt) {
        for (let index = 1; index < samples.length; index++) if (samples[index].updatedAt >= time) {
          a = samples[index - 1]; b = samples[index]; t = (time - a.updatedAt) / (b.updatedAt - a.updatedAt); break;
        }
      }
      out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
      out.yaw = a.yaw + angle(b.yaw - a.yaw) * Math.min(1, t);
      out.moving = (t < 1 ? a.moving || b.moving : b.moving) && time - last.updatedAt <= extrapolationMs;
      out.sprinting = out.moving && b.sprinting;
      out.riding = (t < 1 ? a : b).riding;
      return true;
    },
    clear() { samples.length = 0; offset = undefined; },
  };
}
