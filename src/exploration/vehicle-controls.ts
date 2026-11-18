/** Keyboard and touch share one bounded input, including brake-before-reverse. */
export interface DrivingInput { throttle: number; steering: number; brake: number; handbrake: boolean }
export type TouchDrivingAction = 'forward' | 'reverse' | 'left' | 'right' | 'handbrake';
export function readDrivingInput(keys: ReadonlySet<string>, touch: ReadonlySet<TouchDrivingAction>, speedMps: number, enabled = true): DrivingInput {
  if (!enabled) return { throttle: 0, steering: 0, brake: 1, handbrake: true };
  const forward = touch.has('forward') || keys.has('KeyW') || keys.has('ArrowUp');
  const reverse = touch.has('reverse') || keys.has('KeyS') || keys.has('ArrowDown');
  const direction = Number(forward) - Number(reverse);
  const braking = direction !== 0 && direction * (Number.isFinite(speedMps) ? speedMps : 0) < -.65;
  return {
    throttle: braking ? 0 : direction,
    steering: Number(touch.has('left') || keys.has('KeyA') || keys.has('ArrowLeft')) - Number(touch.has('right') || keys.has('KeyD') || keys.has('ArrowRight')),
    brake: braking || (forward && reverse) ? 1 : 0,
    handbrake: touch.has('handbrake') || keys.has('Space'),
  };
}
