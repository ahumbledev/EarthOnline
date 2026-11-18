export type MaterialId = 'concrete' | 'stone' | 'timber' | 'plaster';
export interface MinigameAsset { path: string }
export interface MinigameEntity {
  id: string;
  shape: 'box' | 'sphere' | 'cylinder';
  position: [number, number, number];
  size: [number, number, number];
  material: MaterialId;
  texture?: string;
  solid?: boolean;
  trigger?: boolean;
  interactable?: boolean;
  visible?: boolean;
  motion?: { to: [number, number]; duration: number };
}
export type MinigameEvent = { type: 'start' }
  | { type: 'enter' | 'interact'; entity: string }
  | { type: 'timer'; timer: string };
export interface MinigameCondition {
  variable: string;
  op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  value: number;
}
export type SharedMinigameAction = { type: 'add' | 'set'; variable: string; value: number }
  | { type: 'hide' | 'show'; entity: string }
  | { type: 'message'; text: string }
  | { type: 'timer.start' | 'timer.stop'; timer: string }
  | { type: 'win' | 'lose' };
export type MinigameAction = SharedMinigameAction | { type: 'teleport'; position: [number, number] };
export type CooperativeMinigameAction = SharedMinigameAction
  | { type: 'teleport'; position: [number, number]; target: 'actor' | 'all' };
export interface MinigameTimer { id: string; duration: number; repeat?: boolean; autoStart?: boolean }
export interface MinigameRule<Action = MinigameAction> {
  id: string; on: MinigameEvent; when?: MinigameCondition[];
  once?: boolean; actions: Action[];
}
export interface MinigameArena {
  width: number; depth: number; playerSpeed: number; playerRadius: number; material: MaterialId;
}
export interface MinigameDefinitionBase {
  id: string; title: string; description: string; author: string; version: string;
  assets?: Record<string, MinigameAsset>;
  entities: MinigameEntity[];
  variables: Record<string, number>;
  timers?: MinigameTimer[];
}
export interface SoloGameDefinition extends MinigameDefinitionBase {
  schemaVersion: 1; players: 1;
  arena: MinigameArena & { spawn: [number, number] };
  rules: MinigameRule[];
}
export interface CooperativeGameDefinition extends MinigameDefinitionBase {
  schemaVersion: 2; players: { min: 2 | 3 | 4; max: 2 | 3 | 4 };
  arena: MinigameArena & { spawns: Array<[number, number]> };
  rules: MinigameRule<CooperativeMinigameAction>[];
}
export type MinigameProfile = 'solo' | 'coop4' | 'standard8' | 'party16';
export interface ProductionGameDefinition extends MinigameDefinitionBase {
  schemaVersion: 3; profile: MinigameProfile; players: { min: number; max: number };
  arena: MinigameArena & { spawns: Array<[number, number]> };
  rules: MinigameRule<CooperativeMinigameAction>[];
}
export type GameDefinition = SoloGameDefinition | CooperativeGameDefinition | ProductionGameDefinition;
export const MINIGAME_PROFILES: Readonly<Record<MinigameProfile, Readonly<{ minPlayers: number; maxPlayers: number }>>>;
export interface MinigameIssue { path: string; code: string; message: string }
export interface MinigameValidation { valid: boolean; issues: MinigameIssue[] }
export const MINIGAME_MATERIALS: readonly MaterialId[];
export const MINIGAME_LIMITS: Readonly<{
  archiveBytes: number; unpackedBytes: number; fileBytes: number; files: number;
  definitionBytes: number; assets: number; textureDimension: number;
  texturePixels: number; totalTexturePixels: number; entities: number;
  rules: number; actionsPerRule: number; conditionsPerRule: number;
  variables: number; timers: number; issues: number; trace: number;
  actionsPerTick: number; variableMagnitude: number; sessionSeconds: number;
  arenaSize: number; motionSpeed: number; interactDistance: number;
}>;
export function validateGameDefinition(data: unknown): MinigameValidation;
