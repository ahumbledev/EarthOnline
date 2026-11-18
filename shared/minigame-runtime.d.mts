import type { SoloGameDefinition, CooperativeGameDefinition, ProductionGameDefinition } from './minigame-protocol.mjs';
export const FIXED_DT: number;
export const MINIGAME_RUNTIME_VERSION: 'rules-3.0.0';
export const MINIGAME_COMPATIBLE_REPLAY_VERSIONS: readonly string[];
export const MINIGAME_CHECKPOINT_VERSION: 1;
export interface RuntimeInput { x: number; z: number; interact?: boolean }
export interface RuntimeTrace {
  seq: number; tick: number; time: number;
  kind: 'event' | 'rule' | 'message' | 'win' | 'lose' | 'limit';
  event?: 'start' | 'enter' | 'interact' | 'timer';
  ruleId?: string; entityId?: string; timerId?: string; playerId?: string; text?: string;
}
export interface RuntimeSnapshot {
  tick: number; elapsed: number; status: 'playing' | 'won' | 'lost';
  player: { x: number; z: number; yaw: number };
  variables: Record<string, number>;
  entities: Array<{ id: string; visible: boolean; x: number; y: number; z: number }>;
  timers: Record<string, number>;
  message: string | null;
  trace: RuntimeTrace[];
}
export interface GameRuntime {
  step(dt: number, input: RuntimeInput): RuntimeSnapshot;
  advance(dt: number, input: RuntimeInput): RuntimeProgress;
  progress(): RuntimeProgress;
  dynamicSnapshot(): RuntimeDynamicSnapshot;
  checkpoint(): RuntimeCheckpoint;
  snapshot(): RuntimeSnapshot;
  readState(): RuntimeSnapshot;
  drainEvents(): RuntimeTrace[];
}
export interface RuntimePlayer { id: string; slot: number; x: number; z: number; yaw: number }
export interface MultiplayerRuntimeSnapshot extends Omit<RuntimeSnapshot, 'player'> {
  players: RuntimePlayer[];
}
export interface MultiplayerRuntime {
  step(dt: number, inputs: Readonly<Record<string, RuntimeInput>>): MultiplayerRuntimeSnapshot;
  advance(dt: number, inputs: Readonly<Record<string, RuntimeInput>>): RuntimeProgress;
  progress(): RuntimeProgress;
  dynamicSnapshot(): RuntimeDynamicSnapshot;
  checkpoint(): RuntimeCheckpoint;
  snapshot(): MultiplayerRuntimeSnapshot;
  readState(): MultiplayerRuntimeSnapshot;
  drainEvents(): RuntimeTrace[];
}
export interface MultiplayerRuntimeOptions { players: ReadonlyArray<{ id: string; slot: number }> }
export interface RuntimeProgress { tick: number; elapsed: number; status: 'playing' | 'won' | 'lost' }
/** Wire state has no static scene descriptions, internal input state, or diagnostics. */
export interface RuntimeDynamicSnapshot extends Omit<MultiplayerRuntimeSnapshot, 'trace'> {}
export interface RuntimeCheckpoint {
  checkpointVersion: 1; runtimeVersion: 'rules-3.0.0'; definitionFingerprint: string; mode: 'solo' | 'roster';
  tick: number; accumulator: number; status: RuntimeProgress['status']; message: string | null;
  sequence: number; actionsThisTick: number; variables: Record<string, number>; firedOnce: string[];
  players: Array<RuntimePlayer & { inside: string[]; interactHeld: boolean; pendingInteract: boolean; teleportEpoch: number }>;
  entities: Array<RuntimeSnapshot['entities'][number] & { previousX: number; previousZ: number }>;
  timers: Array<{ id: string; duration: number; remaining: number; active: boolean; startedAt: number }>;
  trace: RuntimeTrace[]; pendingEvents: RuntimeTrace[];
}
/** Invalid definitions throw an Error carrying MinigameIssue[] in .issues. */
export function createGameRuntime(definition: SoloGameDefinition): GameRuntime;
export function createMultiplayerRuntime(definition: CooperativeGameDefinition | ProductionGameDefinition, options: MultiplayerRuntimeOptions): MultiplayerRuntime;
/** Restore is for authenticated server persistence, never a client submission. */
export function restoreGameRuntime(definition: SoloGameDefinition, checkpoint: unknown): GameRuntime;
export function restoreMultiplayerRuntime(definition: CooperativeGameDefinition | ProductionGameDefinition, checkpoint: unknown): MultiplayerRuntime;
