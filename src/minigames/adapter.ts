import { validateGameDefinition } from '../../shared/minigame-protocol.mjs';
import { createGameRuntime, createMultiplayerRuntime } from '../../shared/minigame-runtime.mjs';
import type { GameDefinition } from '../../shared/minigame-protocol.mjs';
import type { RuntimeInput, RuntimeSnapshot } from '../../shared/minigame-runtime.mjs';
import type { MinigameConfig } from './api.ts';
import { t } from '../activities-public/language.ts';

export type WorkshopGame = GameDefinition;
export type WorkshopRuntime = ReturnType<typeof createWorkshopRuntime>;
export interface WorkshopSnapshot extends RuntimeSnapshot { players: Array<{ id: string; slot: number; x: number; z: number; yaw: number }> }

export function workshopRoomUnsupportedReason(game: WorkshopGame, config: MinigameConfig | null): string | null {
  if (game.schemaVersion === 1) return t`选择合作样板，上传并发布后，即可创建房间。`;
  if (!config?.realtime?.enabled) return t`当前服务尚未启用合作房间。`;
  if (!(config.schemaVersions ?? [config.schemaVersion]).includes(game.schemaVersion)) return t`当前服务不支持这一作品版本的联机；仍可在本地切换玩家试玩。`;
  if (game.schemaVersion === 3 && config.realtime.protocolVersion !== 2) return t`当前服务的多人协议尚未支持此作品；仍可在本地切换玩家试玩。`;
  if (game.players.max > config.realtime.maxPlayers) return t`当前服务最多支持 ${config.realtime.maxPlayers} 人房间；仍可在本地切换全部玩家试玩。`;
  return null;
}

export function parseWorkshopGame(value: unknown): WorkshopGame {
  const result = validateGameDefinition(value);
  if (!result.valid) throw new Error(result.issues.map((issue: { path: string; message: string }) => t`${issue.path || '/'}：${issue.message}`).join('\n'));
  return value as WorkshopGame;
}

export function createWorkshopRuntime(game: WorkshopGame) {
  let controlledSlot = 0;
  const solo = game.schemaVersion === 1 ? createGameRuntime(game) : null;
  const roster = game.schemaVersion !== 1 ? Array.from({ length: game.players.max }, (_, slot) => ({ id: `local-${slot + 1}`, slot })) : [];
  const cooperative = game.schemaVersion !== 1 ? createMultiplayerRuntime(game, { players: roster }) : null;
  function snapshot(): WorkshopSnapshot {
    if (solo) { const state = solo.snapshot(); return { ...state, players: [{ id: 'local-1', slot: 0, ...state.player }] }; }
    const state = cooperative!.snapshot();
    return { ...state, player: state.players.find(player => player.slot === controlledSlot)!, players: state.players };
  }
  return {
    snapshot,
    get controlledSlot() { return controlledSlot; },
    setControlledSlot(slot: number) { if (Number.isInteger(slot) && slot >= 0 && slot < Math.max(1, roster.length)) controlledSlot = slot; },
    step(dt: number, input: RuntimeInput) { if (solo) solo.step(dt, input); else cooperative!.step(dt, { [roster[controlledSlot].id]: input }); return snapshot(); },
  };
}

export function workshopBrief(game: WorkshopGame) {
  return JSON.stringify(game, null, 2);
}
