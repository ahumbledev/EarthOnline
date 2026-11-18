export interface BikeControlInput { throttle: number; steering: number; brake: number }

/** +Z is the bicycle's front: a positive Y rotation turns left in the chase view. */
export function bikeInputFromKeys(keys: ReadonlySet<string>, enabled = true): BikeControlInput {
  if (!enabled) return { throttle: 0, steering: 0, brake: 1 };
  const forward = keys.has('KeyW') || keys.has('ArrowUp');
  const reverse = keys.has('KeyS') || keys.has('ArrowDown');
  return {
    throttle: Number(forward) - Number(reverse),
    steering: Number(keys.has('KeyA') || keys.has('ArrowLeft')) - Number(keys.has('KeyD') || keys.has('ArrowRight')),
    brake: Number(keys.has('Space') || forward && reverse),
  };
}
