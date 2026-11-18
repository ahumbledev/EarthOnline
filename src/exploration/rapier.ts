import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<void> | undefined;
/** Shared by view preloading and controller creation. A failed request can retry. */
export function initializePhysics(): Promise<void> {
  return ready ??= RAPIER.init().catch((error: unknown) => { ready = undefined; throw error; });
}
