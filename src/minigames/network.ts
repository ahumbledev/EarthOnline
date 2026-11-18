import type { MinigameApi, MinigameRoom, MinigameRevision, RoomBootstrap } from './api';
import { MINIGAME_COMPATIBLE_REPLAY_VERSIONS } from '../../shared/minigame-runtime.mjs';
import { applyMinigameSync } from '../../shared/minigame-sync.mjs';
import type { MinigameSyncState } from '../../shared/minigame-sync.mjs';
import { t, td } from '../activities-public/language.ts';

export type RoomConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'disconnected';
type Socket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'addEventListener'>;
// PostgreSQL bigint epochs stay decimal strings across JSON, without rounding.
const epoch = (value: unknown): bigint | null => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) ? BigInt(value)
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
interface NetworkOptions {
  api: Pick<MinigameApi, 'origin' | 'createRoom' | 'joinRoom' | 'reconnectRoom'>;
  onChange(): void;
  onBootstrap(bootstrap: RoomBootstrap, signal: AbortSignal): Promise<boolean>;
  onError(message: string): void;
  onDiagnostics(report: unknown): void;
  socket?: (url: string, protocols: string[]) => Socket;
  retryDelayMs?: number;
  resumeGraceMs?: number;
}

/** A room socket is bound to the bootstrap identity and owner epoch; credentials stay in memory. */
export function createMinigameNetwork(options: NetworkOptions) {
  let active = false, disposed = false, generation = 0, socket: Socket | null = null;
  let operation: AbortController | null = null, inputTimer: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined, diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  let room: MinigameRoom | null = null, revision: MinigameRevision | null = null;
  let member: RoomBootstrap['member'] | null = null;
  let status: RoomConnectionStatus = 'idle', assetsReady = false, sequence = 0, retryCount = 0;
  let reconnectUntil = 0, inputAt = 0, pendingDiagnostics = false;
  let synced: MinigameSyncState | null = null, awaitingBaseline = false, lastResync = -Infinity;
  let resumeGraceMs = options.resumeGraceMs ?? 30000;
  let input = { x: 0, z: 0, interact: false };
  const changed = () => { if (!disposed) options.onChange(); };
  function clearTimers() {
    clearInterval(inputTimer); inputTimer = undefined; clearTimeout(retry); retry = undefined;
    clearTimeout(diagnosticsTimer); diagnosticsTimer = undefined; pendingDiagnostics = false;
    clearTimeout(handshakeTimer); handshakeTimer = undefined;
  }
  function detach() { clearTimers(); const previous = socket; socket = null; previous?.close(); }
  function base(type: string) { return { type, protocolVersion: room!.protocolVersion, roomId: room!.id, round: room!.round,
    ...(room!.protocolVersion === 2 ? { ownerEpoch: room!.ownerEpoch } : {}) }; }
  function send(type: string, fields: Record<string, unknown> = {}) {
    if (!active || !socket || socket.readyState !== 1 || !room || status !== 'online') return false;
    socket.send(JSON.stringify({ ...base(type), ...fields })); return true;
  }
  function sendInput() {
    if (!room || room.phase !== 'playing' || !assetsReady || awaitingBaseline) return;
    const current = Date.now() - inputAt < 250 ? input : { x: 0, z: 0, interact: false };
    if (send('input', { seq: ++sequence, ...current })) input.interact = false;
  }
  function neutral() { input = { x: 0, z: 0, interact: false }; inputAt = Date.now(); sendInput(); }
  function scheduleReconnect() {
    if (!active || disposed || !member || !room || room.phase === 'closed' || retry) return;
    if (!reconnectUntil) reconnectUntil = Date.now() + resumeGraceMs;
    if (Date.now() >= reconnectUntil) { status = 'disconnected'; changed(); return; }
    status = 'reconnecting'; changed();
    retry = setTimeout(() => {
      retry = undefined;
      if (Date.now() >= reconnectUntil) { status = 'disconnected'; changed(); return; }
      void reconnect(false);
    }, Math.min(reconnectUntil - Date.now(), 5000, (options.retryDelayMs ?? 600) * 2 ** Math.min(retryCount++, 3)));
  }
  function restartInputTimer() {
    clearInterval(inputTimer);
    const hz = Number.isFinite(room?.inputHz) ? Math.min(60, Math.max(1, room!.inputHz!)) : 20;
    if (status === 'online') inputTimer = setInterval(sendInput, 1000 / hz);
  }
  function validMetadata(next: MinigameRoom) {
    return !!room && next.id === room.id && next.protocolVersion === room.protocolVersion && next.revisionId === room.revisionId
      && Number.isSafeInteger(next.round) && next.round >= room.round
      && (next.protocolVersion === 1 || epoch(next.ownerEpoch) !== null && epoch(next.ownerEpoch)! >= epoch(room.ownerEpoch)!);
  }
  function acceptState(next: MinigameRoom) {
    if (!room || !validMetadata(next)) return;
    if (next.protocolVersion === 2 && next.phase !== 'lobby' && next.phase !== 'closed') return;
    if (next.round === room.round && next.snapshot && room.snapshot && next.snapshot.tick < room.snapshot.tick) return;
    if (next.round !== room.round) { sequence = 0; input = { x: 0, z: 0, interact: false }; }
    synced = null; awaitingBaseline = false;
    room = next;
    if (next.phase !== 'playing') input = { x: 0, z: 0, interact: false };
    if (next.phase === 'closed') { status = 'disconnected'; detach(); }
    changed();
  }
  function resync() {
    awaitingBaseline = true; input = { x: 0, z: 0, interact: false };
    if (Date.now() - lastResync >= 500 && send('resync')) lastResync = Date.now();
  }
  function acceptSync(data: { room?: MinigameRoom; sync: unknown }) {
    if (!room || room.protocolVersion !== 2) return;
    const next = data.room ?? room;
    if (!validMetadata(next)) return;
    const message = data.sync as { streamId?: string; type?: string } | null;
    const streamId = `${next.id}:${next.ownerEpoch}:${next.round}`;
    if (!message || message.streamId !== streamId) { resync(); return; }
    const newStream = synced?.streamId !== streamId;
    if (next.ownerEpoch !== room.ownerEpoch || next.round !== room.round) {
      if (next.round !== room.round) sequence = 0;
      room = { ...next, snapshot: null }; synced = null; awaitingBaseline = true;
    }
    if (awaitingBaseline && message.type !== 'baseline') { resync(); return; }
    try {
      const result = applyMinigameSync(newStream ? null : synced, message);
      if (next.round !== room.round) { sequence = 0; input = { x: 0, z: 0, interact: false }; }
      synced = result; awaitingBaseline = false;
      const previousHz = room.inputHz;
      room = { ...next, snapshot: { ...result.snapshot, trace: [] } };
      if (room.phase !== 'playing') input = { x: 0, z: 0, interact: false };
      if (previousHz !== room.inputHz) restartInputTimer();
      changed();
    } catch { resync(); }
  }
  async function attach(bootstrap: RoomBootstrap, token: number, controller: AbortController) {
    if (disposed || !active || token !== generation) return;
    if (bootstrap.room.runtimeVersion && !MINIGAME_COMPATIBLE_REPLAY_VERSIONS.includes(bootstrap.room.runtimeVersion)) throw new Error(t`小游戏规则引擎版本已更新，请刷新页面后重新加入。`);
    const connectionUrl = new URL(bootstrap.connection.url, options.api.origin);
    if (connectionUrl.protocol === 'http:' || connectionUrl.protocol === 'https:') connectionUrl.protocol = connectionUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const expected = new URL(options.api.origin); expected.protocol = expected.protocol === 'https:' ? 'wss:' : 'ws:';
    const protocol = bootstrap.room.protocolVersion;
    const validPath = protocol === 1 ? connectionUrl.pathname === '/api/minigames/realtime'
      : protocol === 2 && /^\/api\/minigames\/realtime\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionUrl.pathname);
    if (connectionUrl.origin !== expected.origin || !validPath || connectionUrl.username || connectionUrl.password || connectionUrl.search || connectionUrl.hash
      || bootstrap.connection.protocols.length !== 2 || bootstrap.connection.protocols[0] !== `earthonline-minigames-v${protocol}` || !bootstrap.connection.protocols[1].startsWith('ticket.')
      || bootstrap.room.revisionId !== bootstrap.revision.id || protocol === 2 && epoch(bootstrap.room.ownerEpoch) === null) throw new Error(t`房间连接信息不属于当前小游戏服务。`);
    room = bootstrap.room; revision = bootstrap.revision; member = bootstrap.member;
    synced = null; awaitingBaseline = protocol === 2 && !!room.snapshot; lastResync = -Infinity;
    sequence = Math.max(0, bootstrap.member.nextSeq - 1); assetsReady = false; changed();
    const current = socket = (options.socket ?? ((url, protocols) => new WebSocket(url, protocols)))(connectionUrl.href, bootstrap.connection.protocols);
    const isCurrent = () => !disposed && active && generation === token && socket === current;
    handshakeTimer = setTimeout(() => { if (isCurrent() && current.readyState !== 1) { options.onError(t`房间连接超时，正在尝试恢复。`); current.close(); } }, 10000);
    current.addEventListener('open', () => {
      if (!isCurrent()) { current.close(); return; }
      clearTimeout(handshakeTimer); handshakeTimer = undefined;
      status = 'online'; retryCount = 0; reconnectUntil = 0;
      restartInputTimer(); changed();
      if (assetsReady && room && (room.phase === 'paused' || room.protocolVersion === 2 && room.phase === 'playing')) send('ready', { ready: true, revisionId: room.revisionId });
    });
    current.addEventListener('message', event => {
      if (!isCurrent()) return;
      try {
        const data = JSON.parse(String((event as MessageEvent).data));
        if (data.type === 'state' && data.room) acceptState(data.room);
        else if (data.type === 'sync') acceptSync(data);
        else if (data.type === 'error') options.onError(typeof data.message === 'string' ? td(data.message) : t`房间操作未完成，请重试。`);
        else if (data.type === 'diagnostics') { clearTimeout(diagnosticsTimer); pendingDiagnostics = false; options.onDiagnostics(data.report); changed(); }
      } catch { options.onError(t`房间返回了无法识别的数据，请重新连接。`); }
    });
    const dropped = () => {
      if (!isCurrent()) return;
      socket = null; clearTimers(); assetsReady = false; neutral(); scheduleReconnect();
    };
    current.addEventListener('close', dropped); current.addEventListener('error', () => current.close());
    const loaded = await options.onBootstrap(bootstrap, controller.signal);
    if (!isCurrent() || controller.signal.aborted) return;
    if (!loaded) { detach(); input = { x: 0, z: 0, interact: false }; status = 'disconnected'; changed(); return; }
    assetsReady = loaded;
    if (loaded && room && (room.phase === 'paused' || room.protocolVersion === 2 && room.phase === 'playing')) send('ready', { ready: true, revisionId: room.revisionId });
    changed();
  }
  async function begin(load: (signal: AbortSignal) => Promise<RoomBootstrap>, reconnecting = false) {
    if (disposed || !active) return;
    const token = ++generation; operation?.abort(); detach();
    const controller = operation = new AbortController();
    status = reconnecting ? 'reconnecting' : 'connecting'; assetsReady = false; changed();
    try {
      const bootstrap = await load(AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]));
      if (controller.signal.aborted || token !== generation || disposed || !active) return;
      await attach(bootstrap, token, controller);
    } catch (error) {
      if (controller.signal.aborted || token !== generation || disposed || !active) return;
      detach(); input = { x: 0, z: 0, interact: false }; assetsReady = false;
      status = member ? 'disconnected' : 'idle'; options.onError(error instanceof Error ? td(error.message) : t`无法加入房间。`); changed();
      if (reconnecting) scheduleReconnect();
    } finally { if (operation === controller) operation = null; }
  }
  async function reconnect(manual = true) {
    if (!room || !member || room.phase === 'closed') return;
    if (manual) { reconnectUntil = Date.now() + resumeGraceMs; retryCount = 0; }
    const savedRoom = room, saved = member;
    await begin(signal => options.api.reconnectRoom(savedRoom.id, saved.id, saved.resumeToken, signal), true);
  }
  function leave() {
    send('leave'); ++generation; operation?.abort(); operation = null; detach();
    room = null; revision = null; member = null; assetsReady = false; reconnectUntil = 0;
    synced = null; awaitingBaseline = false;
    status = 'idle'; input = { x: 0, z: 0, interact: false }; changed();
  }

  return {
    get room() { return room; }, get revision() { return revision; }, get member() { return member ? { id: member.id, name: member.name, slot: member.slot } : null; },
    get status() { return status; }, get assetsReady() { return assetsReady; }, get diagnosticsPending() { return pendingDiagnostics; },
    get locked() { return !!room || status === 'connecting'; },
    configure(value: { resumeGraceMs?: number }) { if (Number.isFinite(value.resumeGraceMs)) resumeGraceMs = Math.min(120000, Math.max(1000, value.resumeGraceMs!)); },
    create(gameId: string, revisionId: string, name?: string) { if (!room && status !== 'connecting') return begin(signal => options.api.createRoom(gameId, revisionId, name, signal)); },
    join(code: string, name?: string) { if (!room && status !== 'connecting') return begin(signal => options.api.joinRoom(code, name, signal)); },
    ready(value: boolean) { return assetsReady && send('ready', { ready: value, revisionId: room?.revisionId }); },
    start() { return send('start'); }, restart() { return send('restart'); },
    input(value: { x: number; z: number; interact: boolean }) {
      if (!active || !assetsReady || awaitingBaseline || room?.phase !== 'playing' || status !== 'online') return false;
      input = { x: value.x, z: value.z, interact: input.interact || value.interact }; inputAt = Date.now(); return true;
    },
    diagnostics() {
      if (pendingDiagnostics || !send('diagnostics')) return false;
      pendingDiagnostics = true; changed(); diagnosticsTimer = setTimeout(() => { pendingDiagnostics = false; options.onError(t`服务器运行记录暂未返回，请重试。`); changed(); }, 8000); return true;
    },
    neutral, reconnect, leave,
    setActive(value: boolean) {
      if (disposed || active === value) return;
      if (!value) neutral(); active = value;
      if (!value) { ++generation; operation?.abort(); operation = null; detach(); assetsReady = false; if (room) status = 'disconnected'; else status = 'idle'; changed(); }
      else if (room && member && room.phase !== 'closed') void reconnect();
    },
    dispose() { if (disposed) return; leave(); active = false; disposed = true; },
  };
}
