import { t } from '../activities-public/language.ts';

export interface MinigameRevision {
  id: string; gameId: string; name: string; revision: string; createdAt: string;
  archiveSha256: string; bytes: number;
  files: { definition: string; archive: string; assets: Record<string, string> };
  report: Record<string, unknown>;
}
export interface MinigameState {
  version: number; gameVersions: Record<string, number>; active: Record<string, string>;
  revisions: MinigameRevision[];
  permissions?: Record<string, { role: 'owner' | 'editor' | 'publisher'; ownerId: string; scopes: string[] | null }>;
  nextCursor?: string | null;
}
/** Production mutations return only their game's state, not the whole mine page. */
export function mergeMinigameMutationState(current: MinigameState, mutation: MinigameState): MinigameState {
  const affected = new Set(Object.keys(mutation.gameVersions));
  const unaffected = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !affected.has(id)));
  return { ...current, version: mutation.version, gameVersions: { ...current.gameVersions, ...mutation.gameVersions },
    active: { ...unaffected(current.active), ...mutation.active },
    permissions: { ...unaffected(current.permissions ?? {}), ...mutation.permissions },
    revisions: [...current.revisions.filter(revision => !affected.has(revision.gameId)), ...mutation.revisions] };
}
export interface MinigameConfig {
  enabled: boolean; internal: boolean; authRequired: boolean; schemaVersion: 1 | 2 | 3;
  limits: Record<string, number | { games: number; revisions: number; bytes: number }>;
  schemaVersions?: number[];
  realtime?: { enabled: boolean; protocolVersion: 1 | 2; maxPlayers: number; resumeGraceMs: number; inputHz: number; snapshotHz: number };
}
export interface RoomPlayer { id: string; slot: number; x: number; z: number; yaw: number }
export interface RoomSnapshot extends Omit<import('../../shared/minigame-runtime.mjs').RuntimeSnapshot, 'player'> { players: RoomPlayer[] }
export interface RoomMember { id: string; name: string; slot: number; connected: boolean; ready: boolean }
export interface MinigameRoom {
  protocolVersion: 1 | 2; runtimeVersion?: string; id: string; code: string; gameId: string; revisionId: string; hostMemberId: string;
  ownerEpoch?: string | number; roundId?: string; inputHz?: number; snapshotHz?: number;
  phase: 'lobby' | 'playing' | 'paused' | 'won' | 'lost' | 'closed'; round: number;
  members: RoomMember[]; snapshot: RoomSnapshot | null; reason: string | null; pausedUntil: number | null;
}
export interface RoomBootstrap {
  room: MinigameRoom; revision: MinigameRevision;
  member: { id: string; name: string; slot: number; resumeToken: string; nextSeq: number };
  connection: { url: string; protocols: string[]; expiresAt: number };
}
export class MinigameApiError extends Error {
  readonly status: number; readonly code: string; readonly issues: Array<{ path: string; code?: string; message: string }>;
  constructor(message: string, status: number, code = 'request_failed', issues: Array<{ path: string; code?: string; message: string }> = []) {
    super(message); this.name = 'MinigameApiError'; this.status = status; this.code = code; this.issues = issues;
  }
}

interface ApiOptions { base?: string; fetch?: typeof fetch }
/** Files and rooms are scoped to the local workshop service. */
export function createMinigameApi(options: ApiOptions = {}) {
  const pageOrigin = typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const configured = new URL(options.base ?? import.meta.env?.VITE_MINIGAMES_SERVER_URL ?? pageOrigin, pageOrigin);
  if (!['http:', 'https:'].includes(configured.protocol) || configured.username || configured.password) throw new Error(t`小游戏服务地址无效。`);
  const origin = configured.origin;
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  let key = '', configuration: MinigameConfig | null = null;
  async function request(path: string, init: RequestInit = {}, binary = false): Promise<any> {
    const url = new URL(path, origin);
    if (url.origin !== origin || !url.pathname.startsWith('/api/minigames/') || url.username || url.password) throw new MinigameApiError(t`作品资源不属于当前创作服务。`, 0, 'untrusted_url');
    const headers = new Headers(init.headers);
    headers.delete('Authorization'); headers.delete('X-Minigame-Key');
    headers.set('X-Minigame-Request', 'earthonline-minigames');
    const isConfig = url.pathname === '/api/minigames/config';
    if (!isConfig) {
      const config = configuration ?? await request('/api/minigames/config', { signal: init.signal });
      if (config.internal) { if (key) headers.set('X-Minigame-Key', key); }
    }
    let response: Response;
    try { response = await fetchRequest(url.href, { ...init, headers, credentials: 'omit', redirect: 'error', cache: 'no-store' }); }
    catch (error) {
      if (init.signal?.aborted) throw error;
      throw new MinigameApiError(t`创作服务暂时无法连接。本地作品仍可试玩。`, 0, 'network_error');
    }
    
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      
      const message = typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : t`创作服务返回 ${response.status}`;
      const issues = Array.isArray(body.issues) ? body.issues.filter((issue: unknown): issue is { path: string; code?: string; message: string } => !!issue && typeof issue === 'object' && 'path' in issue && typeof issue.path === 'string' && 'message' in issue && typeof issue.message === 'string').slice(0, 100) : [];
      throw new MinigameApiError(message + (issues.length ? '\n' + issues.map((issue: { path: string; message: string }) => t`${issue.path || '/'}：${issue.message}`).join('\n') : ''), response.status, body.code, issues);
    }
    let result: any;
    try { result = binary ? await response.arrayBuffer() : await response.json(); }
    catch {  throw new MinigameApiError(t`创作服务返回的数据无法识别。`, response.status, 'invalid_response'); }
    
    if (isConfig) configuration = result;
    return result;
  }
  return {
    origin,
    setKey(value: string) { key = value.trim(); },
    config: (signal?: AbortSignal): Promise<MinigameConfig> => request('/api/minigames/config', { signal }),
    state: (signal?: AbortSignal): Promise<MinigameState> => request('/api/minigames/state', { signal }),
    catalog: (signal?: AbortSignal): Promise<MinigameState> => request('/api/minigames/catalog', { signal }),
    upload: (file: File | Blob, signal?: AbortSignal): Promise<{ revision: MinigameRevision; state: MinigameState }> => request('/api/minigames/revisions', { method: 'POST', headers: { 'Content-Type': file.type === 'application/json' ? 'application/json' : 'application/zip' }, body: file, signal }),
    publish: (gameId: string, revisionId: string | null, expectedVersion: number, signal?: AbortSignal): Promise<MinigameState> => request(`/api/minigames/games/${encodeURIComponent(gameId)}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revisionId, expectedVersion }), signal }),
    file: (path: string, signal?: AbortSignal): Promise<ArrayBuffer> => request(path, { signal }, true),
    createRoom: (gameId: string, revisionId: string, name?: string, signal?: AbortSignal): Promise<RoomBootstrap> => request('/api/minigames/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId, revisionId, ...(name?.trim() ? { name: name.trim() } : {}) }), signal }),
    joinRoom: (code: string, name?: string, signal?: AbortSignal): Promise<RoomBootstrap> => request('/api/minigames/rooms/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code.trim().toUpperCase(), ...(name?.trim() ? { name: name.trim() } : {}) }), signal }),
    reconnectRoom: (roomId: string, memberId: string, resumeToken: string, signal?: AbortSignal): Promise<RoomBootstrap> => request(`/api/minigames/rooms/${encodeURIComponent(roomId)}/reconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId, resumeToken }), signal }),
  };
}
export type MinigameApi = ReturnType<typeof createMinigameApi>;
