import type { RuntimeDynamicSnapshot, RuntimePlayer, RuntimeSnapshot } from './minigame-runtime.mjs';
export const MINIGAME_SYNC_VERSION: 1;
export interface MinigameSyncState { streamId: string; sequence: number; snapshot: RuntimeDynamicSnapshot }
export interface MinigameBaseline {
  protocolVersion: 1; type: 'baseline'; streamId: string; sequence: number; snapshot: RuntimeDynamicSnapshot;
}
export interface MinigameDelta {
  protocolVersion: 1; type: 'delta'; streamId: string; baseSequence: number; sequence: number;
  changes: Partial<Pick<RuntimeDynamicSnapshot, 'tick' | 'elapsed' | 'status' | 'message' | 'variables'>> & {
    players?: Array<Pick<RuntimePlayer, 'id'> & Partial<Pick<RuntimePlayer, 'x' | 'z' | 'yaw'>>>;
    entities?: Array<Pick<RuntimeSnapshot['entities'][number], 'id'> & Partial<Omit<RuntimeSnapshot['entities'][number], 'id'>>>;
    timers?: Record<string, number | null>;
  };
}
export type MinigameSyncMessage = MinigameBaseline | MinigameDelta;
export function createMinigameBaseline(snapshot: RuntimeDynamicSnapshot, options: { streamId: string; sequence?: number }): MinigameBaseline;
export function createMinigameDelta(previous: RuntimeDynamicSnapshot, next: RuntimeDynamicSnapshot,
  options: { streamId: string; baseSequence: number; sequence: number }): MinigameDelta;
/** Throws .code=resync_required for a missing/stale baseline or a different stream;
 * .code=invalid_sync for malformed data. Inputs are never mutated. */
export function applyMinigameSync(current: MinigameSyncState | null, message: unknown): MinigameSyncState;
