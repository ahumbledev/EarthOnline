import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import * as runtimeModule from '../shared/minigame-runtime.mjs';
import { validateGameDefinition } from '../shared/minigame-protocol.mjs';
import { minigameError } from './minigame-package.mjs';
import { addressKey, clientAddress, createRateLimiter } from './security.mjs';

export const MINIGAME_REALTIME_PATH = '/api/minigames/realtime';
export const MINIGAME_NETWORK_VERSION = 1;
export const MINIGAME_ROOM_LIMITS = Object.freeze({ rooms: 32, tickets: 128, players: 4, ticketMs: 30_000, reservationMs: 10_000,
  resumeGraceMs: 30_000, lobbyMs: 10 * 60_000, terminalMs: 5 * 60_000, messageBytes: 2048, messagesPerSecond: 80,
  inputHz: 20, snapshotHz: 10, neutralInputMs: 250, bufferedBytes: 1024 * 1024, replaySteps: 1024, replayFrames: 36_000 });
const PROTOCOL = 'earthonline-minigames-v1';
const hash = value => createHash('sha256').update(value).digest();
const token = () => randomBytes(32).toString('base64url');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const fail = (status, code, message) => { throw minigameError(status, code, message); };
const zero = () => ({ x: 0, z: 0, interact: false });

/** Internal participants are scoped to this service, never account player IDs. */
export function createMinigameRooms({ store, enabled = false, local = false, origins = [], serverAddress, clientIpHeader,
  now = () => Date.now(), autoTick = true, limits: overrides = {}, runtimeFactory = (definition, options) => runtimeModule.createMultiplayerRuntime(definition, options) } = {}) {
  const limits = { ...MINIGAME_ROOM_LIMITS, ...overrides };
  const rooms = new Map(), codes = new Map(), tickets = new Map();
  const bootstrapRate = createRateLimiter(60), upgradeRate = createRateLimiter(120);
  let closed = false, creating = 0, lastPump = now();
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.messageBytes, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(PROTOCOL) ? PROTOCOL : false });
  const allowed = () => !closed && (typeof enabled === 'function' ? enabled() : enabled);
  const ordered = room => [...room.members.values()].sort((a, b) => a.slot - b.slot);
  function publicRoom(room) {
    const snapshot = room.runtime?.snapshot() ?? null;
    if (snapshot) snapshot.trace = snapshot.trace.slice(-32);
    return { protocolVersion: MINIGAME_NETWORK_VERSION, runtimeVersion: runtimeModule.MINIGAME_RUNTIME_VERSION, id: room.id, code: room.code, gameId: room.definition.id,
      revisionId: room.revision.id, hostMemberId: room.hostMemberId, phase: room.phase, round: room.round,
      members: ordered(room).map(({ id, name, slot, socket, ready }) => ({ id, name, slot, connected: socket?.readyState === WebSocket.OPEN, ready })),
      snapshot, reason: room.reason, pausedUntil: room.phase === 'paused' ? room.pauseDeadline : null };
  }
  function send(socket, message) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > limits.bufferedBytes) { socket.terminate(); return; }
    socket.send(JSON.stringify(message), error => { if (error) socket.terminate(); });
  }
  const broadcast = room => { const message = { type: 'state', room: publicRoom(room) }; for (const member of room.members.values()) send(member.socket, message); };
  function clearInput(member) { member.input = zero(); member.pendingInteract = false; member.interactHeld = false; member.inputAt = -Infinity; }
  const clearRoomInput = room => { room.accumulator = 0; for (const member of room.members.values()) clearInput(member); };
  function electHost(room) {
    if (!room.members.get(room.hostMemberId)?.socket) room.hostMemberId = (ordered(room).find(member => member.socket) ?? ordered(room)[0])?.id ?? '';
  }
  function forgetTickets(roomId, memberId) {
    for (const [key, ticket] of tickets) if (ticket.roomId === roomId && (!memberId || ticket.memberId === memberId)) tickets.delete(key);
  }
  function closeRoom(room, reason) {
    if (room.phase === 'closed') return;
    room.phase = 'closed'; room.reason = reason; clearRoomInput(room); broadcast(room);
    rooms.delete(room.id); codes.delete(room.code); forgetTickets(room.id);
    for (const member of room.members.values()) { finishSocket(member.socket, 4000, reason); member.socket = null; member.resumeHash = null; }
  }
  function finishSocket(socket, code, reason) {
    if (!socket) return;
    socket.close(code, reason);
    const timer = setTimeout(() => socket.terminate(), 1000); timer.unref();
    socket.once('close', () => clearTimeout(timer));
  }
  function removeMember(room, member) {
    forgetTickets(room.id, member.id); room.members.delete(member.id); member.resumeHash = null;
    const socket = member.socket; member.socket = null; finishSocket(socket, 1000, 'left');
    if (!room.members.size) closeRoom(room, 'room_empty');
    else { electHost(room); broadcast(room); }
  }
  function disconnect(room, member, socket) {
    if (member.socket !== socket || room.phase === 'closed') return;
    member.socket = null; member.ready = false; clearInput(member); member.deadline = now() + limits.resumeGraceMs;
    if (room.phase === 'playing') {
      room.phase = 'paused'; room.reason = 'member_disconnected'; room.pauseDeadline = member.deadline; clearRoomInput(room);
    }
    if (room.phase === 'lobby') electHost(room);
    broadcast(room);
  }
  function resumeIfReady(room) {
    if (room.phase === 'paused' && ordered(room).every(member => member.socket?.readyState === WebSocket.OPEN && member.ready)) {
      room.phase = 'playing'; room.reason = null; room.pauseDeadline = null; clearRoomInput(room);
      for (const member of room.members.values()) member.deadline = null;
    }
  }
  function mint(room, member, origin, resumeToken) {
    forgetTickets(room.id, member.id);
    if (tickets.size >= limits.tickets) fail(429, 'tickets_full', 'Too many connections are pending. Try again shortly.');
    const value = token(), expiresAt = now() + limits.ticketMs;
    tickets.set(hash(value).toString('hex'), { roomId: room.id, memberId: member.id, origin, expiresAt });
    return { room: publicRoom(room), revision: structuredClone(room.revision), member: { id: member.id, name: member.name, slot: member.slot, resumeToken, nextSeq: member.seq + 1 },
      connection: { url: MINIGAME_REALTIME_PATH, protocols: [PROTOCOL, `ticket.${value}`], expiresAt } };
  }
  function newMember(room, name, origin) {
    if (tickets.size >= limits.tickets) fail(429, 'tickets_full', 'Too many connections are pending.');
    const occupied = new Set(ordered(room).map(member => member.slot));
    const slot = Array.from({ length: room.definition.players.max }, (_, index) => index).find(index => !occupied.has(index));
    if (slot === undefined) fail(409, 'room_full', 'This room is full.');
    const secret = token(), id = randomUUID();
    const member = { id, slot, name: name || `玩家 ${slot + 1}`, resumeHash: hash(secret), socket: null, ready: false, // i18n-ignore: sent in Chinese; the client shows member names through td()
      seq: 0, deadline: now() + limits.reservationMs, input: zero(), inputAt: -Infinity, pendingInteract: false, interactHeld: false };
    room.members.set(id, member); if (!room.hostMemberId) room.hostMemberId = id;
    const response = mint(room, member, origin, secret); broadcast(room); return response;
  }
  function requestAccess(context) {
    if (!allowed()) fail(403, 'minigames_disabled', 'Internal minigame rooms are unavailable.');
    if (!context || typeof context.origin !== 'string' || !bootstrapRate(context.ip || 'unknown')) fail(429, 'room_rate_limited', 'Too many room requests. Try again later.');
    reap();
  }
  function playerName(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || !value.trim() || value.length > 32 || /[\x00-\x1f\x7f]/.test(value)) fail(400, 'invalid_name', 'Use a display name of 1–32 characters without control characters.');
    return value.trim();
  }
  function roomFor(id) { const room = rooms.get(id); if (!room) fail(404, 'room_missing', 'This room no longer exists.'); return room; }
  function recordInput(room, inputs, frames) {
    if (room.truncated) return;
    const last = room.steps.at(-1), key = JSON.stringify(inputs);
    if (room.recordedFrames + frames > limits.replayFrames || room.steps.length >= limits.replaySteps && key !== room.lastInputKey) { room.truncated = true; return; }
    if (last && key === room.lastInputKey) last.frames += frames;
    else room.steps.push({ frames, inputs: structuredClone(inputs) });
    room.lastInputKey = key; room.recordedFrames += frames;
  }
  function diagnostics(room) {
    const snapshot = room.runtime?.snapshot() ?? null;
    return { runtimeVersion: runtimeModule.MINIGAME_RUNTIME_VERSION, gameDefinition: structuredClone(room.definition), gameId: room.definition.id, revisionId: room.revision.id, round: room.round,
      players: room.roster ?? ordered(room).map(({ id, slot }) => ({ id, slot })), steps: structuredClone(room.steps),
      expect: snapshot ? { status: snapshot.status, variables: snapshot.variables } : null, snapshot,
      replayable: Boolean(snapshot) && !room.truncated, truncated: room.truncated };
  }
  function message(room, member, socket, bytes, binary) {
    if (member.socket !== socket || room.phase === 'closed') return;
    try {
      if (binary || bytes.length > limits.messageBytes) fail(400, 'invalid_message', 'Expected a small JSON message.');
      if (now() - socket.windowAt >= 1000) { socket.windowAt = now(); socket.messages = 0; }
      if (++socket.messages > limits.messagesPerSecond) { socket.close(4008, 'message_rate'); return; }
      const data = JSON.parse(bytes.toString('utf8'));
      const base = ['type', 'protocolVersion', 'roomId', 'round'];
      if (!plain(data) || data.protocolVersion !== MINIGAME_NETWORK_VERSION || data.roomId !== room.id
        || !Number.isSafeInteger(data.round) || data.round < 1) fail(400, 'invalid_scope', 'Use this connection’s protocol, room ID and integer round.');
      if (data.round !== room.round) fail(409, 'stale_round', 'Round changed; use the latest server state.');
      if (data.type === 'input') {
        if (!exact(data, [...base, 'seq', 'x', 'z', 'interact']) || !Number.isSafeInteger(data.seq) || data.seq <= member.seq || data.seq > 0xffffffff
          || !Number.isFinite(data.x) || Math.abs(data.x) > 1 || !Number.isFinite(data.z) || Math.abs(data.z) > 1 || typeof data.interact !== 'boolean') fail(400, 'invalid_input', 'Input must be a new sequence with bounded x/z and boolean interact.');
        if (room.phase !== 'playing' || !member.ready) fail(409, 'round_not_running', 'The round is not accepting input.');
        member.seq = data.seq; member.input = { x: data.x, z: data.z, interact: false }; member.inputAt = now();
        if (data.interact && !member.interactHeld) member.pendingInteract = true;
        member.interactHeld = data.interact;
      } else if (data.type === 'ready') {
        if (!exact(data, [...base, 'ready', 'revisionId']) || typeof data.ready !== 'boolean' || data.revisionId !== room.revision.id) fail(400, 'invalid_ready', 'Acknowledge this room’s exact loaded revision.');
        if (!['lobby', 'paused'].includes(room.phase)) fail(409, 'wrong_phase', 'Ready can only change in the lobby or during reconnect.');
        member.ready = data.ready;
        if (data.ready) member.deadline = null;
        resumeIfReady(room); broadcast(room);
      } else {
        if (!exact(data, base)) fail(400, 'invalid_message', 'Unsupported message fields.');
        if (data.type === 'start') {
          if (member.id !== room.hostMemberId) fail(403, 'host_required', 'Only the host can start the round.');
          const roster = ordered(room);
          if (room.phase !== 'lobby' || roster.length < room.definition.players.min || !roster.every(value => value.socket?.readyState === WebSocket.OPEN && value.ready)) fail(409, 'players_not_ready', 'All participants must connect and acknowledge the loaded revision.');
          const players = roster.map(({ id, slot }) => ({ id, slot }));
          const runtime = runtimeFactory(room.definition, { players });
          room.roster = players; room.locked = true; room.runtime = runtime; room.phase = runtime.snapshot().status;
          room.reason = null; room.steps = []; room.recordedFrames = 0; room.lastInputKey = null; room.truncated = false; clearRoomInput(room);
          if (['won', 'lost'].includes(room.phase)) room.terminalAt = now(); broadcast(room);
        } else if (data.type === 'restart') {
          if (member.id !== room.hostMemberId) fail(403, 'host_required', 'Only the host can restart the round.');
          if (!['won', 'lost'].includes(room.phase)) fail(409, 'wrong_phase', 'Restart after a completed round.');
          room.round++; room.phase = 'lobby'; room.reason = null; room.runtime = null; room.terminalAt = null; room.lobbyAt = now();
          room.steps = []; room.recordedFrames = 0; room.truncated = false; room.lastInputKey = null; clearRoomInput(room);
          for (const value of room.members.values()) { value.ready = false; value.seq = 0; }
          broadcast(room);
        } else if (data.type === 'leave') {
          if (room.locked) closeRoom(room, 'member_left'); else removeMember(room, member);
        } else if (data.type === 'diagnostics') {
          if (socket.lastDiagnostics && now() - socket.lastDiagnostics < 1000) fail(429, 'diagnostics_rate', 'Wait before requesting another report.');
          socket.lastDiagnostics = now(); send(socket, { type: 'diagnostics', report: diagnostics(room) });
        } else fail(400, 'unsupported_message', 'Unsupported minigame command.');
      }
    } catch (error) {
      const known = error.status >= 400 && error.status < 500;
      send(socket, { type: 'error', code: known ? error.code : 'invalid_message', message: known ? error.message : 'Cannot process this minigame message.' });
      // Inputs may legitimately arrive just after a pause or round transition.
      // These state conflicts are rejected without accumulating abuse strikes.
      if ((!known || error.status === 400) && ++socket.strikes >= 8) socket.close(4008, 'invalid_messages');
    }
  }
  function connect(socket, room, member) {
    const previous = member.socket; member.socket = socket; previous?.close(4009, 'connection_replaced');
    member.ready = false; clearInput(member);
    if (room.phase !== 'paused') member.deadline = null;
    socket.alive = true; socket.windowAt = now(); socket.messages = 0; socket.strikes = 0; socket.lastPing = now();
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (bytes, binary) => message(room, member, socket, bytes, binary));
    socket.on('close', () => disconnect(room, member, socket));
    if (room.phase === 'lobby') electHost(room);
    broadcast(room);
  }
  function upgradeOrigin(req) {
    const origin = req.headers.origin;
    if (typeof origin !== 'string') return false;
    if (!local) return origins.includes(origin);
    const address = serverAddress?.();
    if (!address || typeof address === 'string' || !loopback(address.address) || !loopback(req.socket.remoteAddress)) return false;
    try {
      const expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`);
      return ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) && Number(expected.port || (expected.protocol === 'https:' ? 443 : 80)) === address.port
        && origin === expected.origin && (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
    } catch { return false; }
  }
  function handleUpgrade(req, socket, head) {
    let url;
    try { url = new URL(req.url, 'http://internal'); } catch { return false; }
    if (url.pathname !== MINIGAME_REALTIME_PATH) return false;
    const reject = () => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return true; };
    if (!allowed() || url.search || !upgradeOrigin(req) || !upgradeRate(addressKey(clientAddress(req, clientIpHeader)))) return reject();
    const protocols = typeof req.headers['sec-websocket-protocol'] === 'string' ? req.headers['sec-websocket-protocol'].split(',').map(value => value.trim()) : [];
    if (protocols.length !== 2 || protocols[0] !== PROTOCOL || !/^ticket\.[A-Za-z0-9_-]{43}$/.test(protocols[1])) return reject();
    const key = hash(protocols[1].slice(7)).toString('hex'), ticket = tickets.get(key);
    if (!ticket || ticket.expiresAt <= now() || ticket.origin !== req.headers.origin) return reject();
    tickets.delete(key);
    const room = rooms.get(ticket.roomId), member = room?.members.get(ticket.memberId);
    if (!room || !member || member.deadline && member.deadline <= now()) return reject();
    wss.handleUpgrade(req, socket, head, connection => connect(connection, room, member)); return true;
  }
  function reap() {
    const time = now();
    for (const [key, ticket] of tickets) if (ticket.expiresAt <= time) tickets.delete(key);
    for (const room of [...rooms.values()]) {
      if (room.phase === 'paused' && room.pauseDeadline <= time) { closeRoom(room, 'reconnect_expired'); continue; }
      if (room.phase === 'lobby' && time - room.lobbyAt >= limits.lobbyMs || room.terminalAt && time - room.terminalAt >= limits.terminalMs) { closeRoom(room, 'room_expired'); continue; }
      for (const member of [...room.members.values()]) {
        if (member.deadline && member.deadline <= time) { if (room.locked) closeRoom(room, 'reconnect_expired'); else removeMember(room, member); }
        const socket = member.socket;
        if (socket && time - socket.lastPing >= 5000) {
          if (!socket.alive) socket.terminate();
          else { socket.alive = false; socket.lastPing = time; socket.ping(); }
        }
      }
    }
  }
  function pump() {
    if (closed) return;
    const time = now(), elapsed = Math.min(.1, Math.max(0, (time - lastPump) / 1000)); lastPump = time; reap();
    for (const room of rooms.values()) {
      if (room.phase !== 'playing') continue;
      try {
      room.accumulator += elapsed;
      while (room.accumulator + 1e-10 >= runtimeModule.FIXED_DT && room.phase === 'playing') {
        room.accumulator = Math.max(0, room.accumulator - runtimeModule.FIXED_DT);
        const inputs = Object.fromEntries(ordered(room).map(member => {
          if (time - member.inputAt >= limits.neutralInputMs) clearInput(member);
          const input = { ...member.input, interact: member.pendingInteract }; member.pendingInteract = false;
          return [member.id, input];
        }));
        const before = room.runtime.snapshot().tick;
        const snapshot = room.runtime.step(runtimeModule.FIXED_DT, inputs);
        if (snapshot.tick > before) recordInput(room, inputs, snapshot.tick - before);
        if (snapshot.status !== 'playing') { room.phase = snapshot.status; room.terminalAt = time; clearRoomInput(room); broadcast(room); }
      }
      if (time - room.broadcastAt >= 1000 / limits.snapshotHz) { room.broadcastAt = time; broadcast(room); }
      } catch { closeRoom(room, 'runtime_failed'); }
    }
  }
  const timer = autoTick ? setInterval(pump, 1000 / 60) : null; timer?.unref();
  return {
    limits, handleUpgrade,
    async create(body, context) {
      requestAccess(context);
      if (!plain(body) || !['gameId', 'revisionId'].every(key => typeof body[key] === 'string') || Object.keys(body).some(key => !['gameId', 'revisionId', 'name'].includes(key))) fail(400, 'invalid_room', 'Provide gameId, revisionId and an optional display name.');
      const name = playerName(body.name);
      if (rooms.size + creating >= limits.rooms) fail(429, 'rooms_full', 'The internal room limit has been reached.');
      creating++;
      try {
        const { definition, revision } = await store.published(body.gameId, body.revisionId);
        if (!allowed()) fail(403, 'minigames_disabled', 'Internal minigame rooms are unavailable.');
        if (!validateGameDefinition(definition).valid || definition.schemaVersion !== 2) fail(400, 'multiplayer_required', 'Publish a schemaVersion 2 cooperative game before creating a room.');
        let code; do { code = randomBytes(5).toString('hex').toUpperCase(); } while (codes.has(code));
        const room = { id: randomUUID(), code, definition: structuredClone(definition), revision: structuredClone(revision), members: new Map(), hostMemberId: '',
          phase: 'lobby', round: 1, locked: false, reason: null, runtime: null, roster: null, pauseDeadline: null, accumulator: 0,
          lobbyAt: now(), terminalAt: null, broadcastAt: 0, steps: [], recordedFrames: 0, lastInputKey: null, truncated: false };
        rooms.set(room.id, room); codes.set(code, room.id);
        try { return newMember(room, name, context.origin); } catch (error) { closeRoom(room, 'creation_failed'); throw error; }
      } finally { creating--; }
    },
    async join(body, context) {
      requestAccess(context);
      if (!plain(body) || typeof body.code !== 'string' || !/^[A-Fa-f0-9]{10}$/.test(body.code) || Object.keys(body).some(key => !['code', 'name'].includes(key))) fail(400, 'invalid_invite', 'Enter the 10-character room code.');
      const name = playerName(body.name), room = roomFor(codes.get(body.code.toUpperCase()));
      if (room.phase !== 'lobby' || room.locked) fail(409, 'roster_locked', 'This room has already started; only its original participants can reconnect.');
      const state = await store.state();
      if (!allowed() || !rooms.has(room.id)) fail(404, 'room_missing', 'This room no longer exists.');
      if (!Object.hasOwn(state.active, room.definition.id)) fail(409, 'game_withdrawn', 'This game was withdrawn; new participants cannot join.');
      if (room.phase !== 'lobby' || room.locked) fail(409, 'roster_locked', 'This room has already started.');
      return newMember(room, name, context.origin);
    },
    reconnect(id, body, context) {
      requestAccess(context);
      if (!exact(body, ['memberId', 'resumeToken']) || typeof body.memberId !== 'string' || typeof body.resumeToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.resumeToken)) fail(400, 'invalid_resume', 'Provide the original participant ID and resume token.');
      const room = roomFor(id), member = room.members.get(body.memberId);
      if (!member?.resumeHash || !timingSafeEqual(member.resumeHash, hash(body.resumeToken))) fail(403, 'invalid_resume', 'This participant cannot be resumed.');
      if (member.socket?.readyState === WebSocket.OPEN) fail(409, 'already_connected', 'This participant is already connected.');
      return mint(room, member, context.origin, body.resumeToken);
    },
    pump,
    snapshot: id => rooms.has(id) ? publicRoom(rooms.get(id)) : null,
    stats: () => ({ rooms: rooms.size, tickets: tickets.size, creating }),
    async close() {
      if (closed) return; closed = true; if (timer) clearInterval(timer);
      for (const room of [...rooms.values()]) closeRoom(room, 'server_shutdown'); tickets.clear();
      for (const socket of wss.clients) socket.terminate();
      await new Promise(resolve => wss.close(resolve));
    },
  };
}
