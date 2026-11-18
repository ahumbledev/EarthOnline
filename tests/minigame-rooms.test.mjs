import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { WebSocket } from 'ws';
import { createMinigameRooms } from '../server/minigame-rooms.mjs';
import { createMinigameRouter } from '../server/minigame-api.mjs';
import { createMinigameStore } from '../server/minigame-store.mjs';
import { createMultiplayerRuntime, FIXED_DT, MINIGAME_RUNTIME_VERSION } from '../shared/minigame-runtime.mjs';
import { minigameInternalPlugin } from '../scripts/vite-minigames.mjs';

const definition = JSON.parse(await readFile(new URL('../public/minigames/examples/cooperative.json', import.meta.url), 'utf8'));
const turn = () => new Promise(done => setTimeout(done, 5));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await turn(); } assert.ok(check(), 'expected asynchronous state'); }
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function fixture(t, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'minigame-rooms-'));
  const store = createMinigameStore({ directory });
  const uploaded = await store.upload(Buffer.from(JSON.stringify(definition)), { json: true });
  await store.publish(definition.id, uploaded.revision.id, 0);
  let time = 1000;
  const app = express(), server = createServer(app);
  const origin = options.origin;
  const settings = { local: !origin, enabled: true, origins: origin ? [origin] : [], serverAddress: () => server.address(), ...options };
  const rooms = createMinigameRooms({ ...settings, store, now: () => time, autoTick: false });
  app.use(createMinigameRouter({ ...settings, store, rooms }));
  server.on('upgrade', (req, socket, head) => { if (!rooms.handleUpgrade(req, socket, head)) socket.end('HTTP/1.1 404 Not Found\r\n\r\n'); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => fetch(url + path, { ...init, headers: { Origin: origin || url, 'X-Minigame-Request': 'earthonline-minigames', ...(options.key ? { 'X-Minigame-Key': options.key } : {}), ...init.headers } });
  const post = async (path, body, status = 200) => { const response = await request(path, json(body)); const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result; };
  const create = () => post('/api/minigames/rooms', { gameId: definition.id, revisionId: uploaded.revision.id, name: 'Host' });
  const join = code => post('/api/minigames/rooms/join', { code, name: 'Guest' });
  const advance = milliseconds => { time += milliseconds; rooms.pump(); };
  t.after(async () => { await rooms.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await rm(directory, { recursive: true, force: true }); });
  return { url, origin: origin || url, store, rooms, request, post, create, join, advance, revision: uploaded.revision };
}
async function connect(f, bootstrap, options = {}) {
  const socket = new WebSocket(f.url.replace('http:', 'ws:') + bootstrap.connection.url, bootstrap.connection.protocols, { origin: f.origin, ...options });
  const messages = []; socket.on('message', bytes => messages.push(JSON.parse(bytes.toString()))); socket.on('error', () => {});
  await once(socket, 'open'); await until(() => messages.some(message => message.type === 'state'));
  const state = () => messages.filter(message => message.type === 'state').at(-1)?.room;
  const send = (type, fields = {}) => socket.send(JSON.stringify({ type, protocolVersion: 1, roomId: bootstrap.room.id, round: state().round, ...fields }));
  return { socket, messages, state, send, bootstrap };
}
async function pair(f) {
  const a = await f.create(), first = await connect(f, a), b = await f.join(a.room.code), second = await connect(f, b);
  return [first, second];
}
async function start(f, a, b) {
  a.send('ready', { ready: true, revisionId: f.revision.id }); b.send('ready', { ready: true, revisionId: f.revision.id });
  await until(() => f.rooms.snapshot(a.bootstrap.room.id).members.every(member => member.ready));
  a.send('start'); await until(() => a.state().phase === 'playing' && b.state().phase === 'playing');
}
test('authoritative two-player round shares switches, pins runtime, and exports an exact all-player replay', async t => {
  const f = await fixture(t), [a, b] = await pair(f);
  assert.equal(a.state().runtimeVersion, MINIGAME_RUNTIME_VERSION);
  await start(f, a, b);
  const inputs = [{ x: 0, z: 0, interact: true, frames: 1 }, { x: 0, z: 1, interact: false, frames: 160 }, { x: 1, z: 0, interact: false, frames: 100 }];
  let sequence = 0;
  for (const action of inputs) {
    for (let frame = 0; frame < action.frames; frame++) {
      if (frame % 6 === 0) {
        a.send('input', { seq: ++sequence, x: action.x, z: action.z, interact: action.interact });
        b.send('input', { seq: sequence, x: -action.x, z: action.z, interact: action.interact }); await turn();
      }
      f.advance(1000 / 60);
      if (f.rooms.snapshot(a.bootstrap.room.id).phase !== 'playing') break;
    }
  }
  await until(() => a.state().phase === 'won' && b.state().phase === 'won');
  assert.deepEqual(a.state().snapshot.variables, { west: 1, east: 1 });
  for (let seq = sequence + 1; seq < sequence + 13; seq++) a.send('input', { seq, x: 0, z: 0, interact: false });
  await until(() => a.messages.filter(message => message.code === 'round_not_running').length === 12);
  assert.equal(a.socket.readyState, WebSocket.OPEN, 'valid in-flight terminal inputs do not count as abuse');
  a.send('diagnostics'); await until(() => a.messages.some(message => message.type === 'diagnostics'));
  const report = a.messages.find(message => message.type === 'diagnostics').report;
  assert.equal(report.runtimeVersion, MINIGAME_RUNTIME_VERSION); assert.equal(report.replayable, true); assert.equal(report.truncated, false);
  const replay = createMultiplayerRuntime(report.gameDefinition, { players: report.players });
  for (const step of report.steps) for (let frame = 0; frame < step.frames; frame++) replay.step(FIXED_DT, step.inputs);
  assert.deepEqual(replay.snapshot(), report.snapshot);
  assert.equal(report.players.length, 2); assert.ok(report.steps.every(step => Object.keys(step.inputs).length === 2));
  a.send('restart'); await until(() => a.state().phase === 'lobby' && a.state().round === 2);
  assert.ok(a.state().members.every(member => !member.ready));
  a.send('input', { round: 1, seq: 999, x: 1, z: 0, interact: false });
  await until(() => a.messages.some(message => message.code === 'stale_round'));
  await f.post('/api/minigames/rooms/join', { code: a.state().code }, 409);
});

test('readiness, role and input validation reject client authority; absent input becomes neutral', async t => {
  const f = await fixture(t), [a, b] = await pair(f);
  a.send('start'); await until(() => a.messages.some(message => message.code === 'players_not_ready'));
  b.send('start'); await until(() => b.messages.some(message => message.code === 'host_required'));
  a.send('ready', { ready: true, revisionId: 'wrong-revision' }); await until(() => a.messages.some(message => message.code === 'invalid_ready'));
  await start(f, a, b);
  for (const fields of [{ x: 2 }, { seq: 0 }, { position: [0, 0, 0] }, { dt: 1 }]) {
    a.send('input', { seq: 1, x: 1, z: 0, interact: false, ...fields });
  }
  await until(() => a.messages.filter(message => message.code === 'invalid_input').length === 4);
  const before = f.rooms.snapshot(a.bootstrap.room.id).snapshot.players[0].x;
  a.send('input', { seq: 1, x: -1, z: 0, interact: false }); await turn(); f.advance(100);
  const moving = f.rooms.snapshot(a.bootstrap.room.id).snapshot.players[0].x; assert.ok(moving < before);
  f.advance(200); const stopped = f.rooms.snapshot(a.bootstrap.room.id).snapshot.players[0].x;
  f.advance(100); assert.equal(f.rooms.snapshot(a.bootstrap.room.id).snapshot.players[0].x, stopped);
  a.send('input', { seq: 1, x: 1, z: 0, interact: false }); await until(() => a.messages.filter(message => message.code === 'invalid_input').length === 5);
  assert.equal(f.rooms.snapshot(a.bootstrap.room.id).phase, 'playing');
});

test('disconnect freezes the whole room, reconnect keeps identity and requires exact loaded revision; leave aborts', async t => {
  const f = await fixture(t), [a, b] = await pair(f); await start(f, a, b);
  a.send('input', { seq: 7, x: -1, z: 0, interact: false }); await turn(); f.advance(100);
  b.socket.terminate(); await until(() => a.state().phase === 'paused');
  const paused = f.rooms.snapshot(a.bootstrap.room.id).snapshot; f.advance(1000);
  assert.deepEqual(f.rooms.snapshot(a.bootstrap.room.id).snapshot, paused);
  for (let seq = 8; seq < 20; seq++) a.send('input', { seq, x: -1, z: 0, interact: false });
  await until(() => a.messages.filter(message => message.code === 'round_not_running').length === 12);
  assert.equal(a.socket.readyState, WebSocket.OPEN, 'in-flight input during pause is not accumulated as malformed-message abuse');
  await f.post(`/api/minigames/rooms/${b.bootstrap.room.id}/reconnect`, { memberId: b.bootstrap.member.id, resumeToken: a.bootstrap.member.resumeToken }, 403);
  const resumed = await f.post(`/api/minigames/rooms/${b.bootstrap.room.id}/reconnect`, { memberId: b.bootstrap.member.id, resumeToken: b.bootstrap.member.resumeToken });
  assert.equal(resumed.member.id, b.bootstrap.member.id); assert.equal(resumed.member.slot, 1);
  const c = await connect(f, resumed); assert.equal(c.state().phase, 'paused');
  c.send('ready', { ready: true, revisionId: f.revision.id }); await until(() => a.state().phase === 'playing');
  assert.deepEqual(f.rooms.snapshot(a.bootstrap.room.id).snapshot, paused);
  f.advance(100); assert.equal(f.rooms.snapshot(a.bootstrap.room.id).snapshot.players[0].x, paused.players[0].x, 'pre-disconnect inputs cleared');
  c.send('leave'); await until(() => a.state().phase === 'closed'); assert.equal(f.rooms.stats().rooms, 0);
  await f.post(`/api/minigames/rooms/${resumed.room.id}/reconnect`, { memberId: resumed.member.id, resumeToken: resumed.member.resumeToken }, 404);
});

test('published revision is pinned through updates; withdrawal denies new rooms and invites but permits resume', async t => {
  const f = await fixture(t), bootstrap = await f.create(), a = await connect(f, bootstrap);
  const next = await f.store.upload(Buffer.from(JSON.stringify({ ...definition, version: '1.1.0' })), { json: true });
  await f.store.publish(definition.id, next.revision.id, 1);
  const b = await f.join(bootstrap.room.code); assert.equal(b.revision.id, f.revision.id);
  await f.post('/api/minigames/rooms', { gameId: definition.id, revisionId: f.revision.id }, 409);
  await f.store.publish(definition.id, null, 2);
  await f.post('/api/minigames/rooms/join', { code: bootstrap.room.code }, 409);
  await f.post('/api/minigames/rooms', { gameId: definition.id, revisionId: next.revision.id }, 404);
  a.socket.terminate(); await until(() => !f.rooms.snapshot(bootstrap.room.id).members[0].connected);
  const resumed = await f.post(`/api/minigames/rooms/${bootstrap.room.id}/reconnect`, { memberId: bootstrap.member.id, resumeToken: bootstrap.member.resumeToken });
  assert.equal(resumed.revision.id, f.revision.id);
});

test('unused reservations, reconnect grace and room/ticket/replay limits remain bounded', async t => {
  const f = await fixture(t, { limits: { rooms: 1, tickets: 1, replayFrames: 2 } });
  const unused = await f.create(); assert.equal(f.rooms.stats().tickets, 1);
  await f.post('/api/minigames/rooms', { gameId: definition.id, revisionId: f.revision.id }, 429);
  f.advance(10001); assert.deepEqual(f.rooms.stats(), { rooms: 0, tickets: 0, creating: 0 });
  await f.post(`/api/minigames/rooms/${unused.room.id}/reconnect`, { memberId: unused.member.id, resumeToken: unused.member.resumeToken }, 404);
  const [a, b] = await pair(f); await start(f, a, b); f.advance(100);
  a.send('diagnostics'); await until(() => a.messages.some(message => message.type === 'diagnostics'));
  const report = a.messages.find(message => message.type === 'diagnostics').report;
  assert.equal(report.replayable, false); assert.equal(report.truncated, true); assert.ok(report.steps.reduce((sum, value) => sum + value.frames, 0) <= 2);
  b.socket.terminate(); await until(() => f.rooms.snapshot(a.bootstrap.room.id).phase === 'paused');
  f.advance(30001); assert.equal(f.rooms.stats().rooms, 0); await until(() => a.state().phase === 'closed');
});

test('HTTP key/origin gate and single-use origin-bound WS tickets stay independent of city accounts', async t => {
  const f = await fixture(t, { origin: 'https://internal.example', key: 'internal-only' });
  assert.equal((await f.request('/api/minigames/rooms', { ...json({ gameId: definition.id, revisionId: f.revision.id }), headers: { 'Content-Type': 'application/json', 'X-Minigame-Key': 'wrong' } })).status, 403);
  const bootstrap = await f.create();
  async function reject(options = {}, protocols = bootstrap.connection.protocols, path = bootstrap.connection.url) {
    const socket = new WebSocket(f.url.replace('http:', 'ws:') + path, protocols, { origin: f.origin, ...options });
    socket.on('error', () => {});
    const status = await new Promise(resolve => socket.once('unexpected-response', (_request, response) => { const code = response.statusCode; response.resume(); socket.terminate(); resolve(code); }));
    assert.equal(status, 403);
  }
  await reject({ origin: 'https://evil.invalid' });
  await reject({}, ['earthonline-minigames-v1', 'ticket.' + 'a'.repeat(43)]);
  await reject({}, bootstrap.connection.protocols, bootstrap.connection.url + '?key=forbidden');
  const a = await connect(f, bootstrap); await reject();
  assert.equal(a.state().members[0].connected, true);
  await f.post(`/api/minigames/rooms/${bootstrap.room.id}/reconnect`, { memberId: bootstrap.member.id, resumeToken: bootstrap.member.resumeToken }, 409);
});

test('payload and message rates close abusive connections without growing room membership', async t => {
  const f = await fixture(t, { limits: { messagesPerSecond: 3 } });
  const bootstrap = await f.create(), a = await connect(f, bootstrap);
  const rateClosed = once(a.socket, 'close');
  for (let count = 0; count < 4; count++) a.send('ready', { ready: false, revisionId: f.revision.id });
  assert.equal((await rateClosed)[0], 4008);
  const resumed = await f.post(`/api/minigames/rooms/${bootstrap.room.id}/reconnect`, { memberId: bootstrap.member.id, resumeToken: bootstrap.member.resumeToken });
  const b = await connect(f, resumed), sizeClosed = once(b.socket, 'close');
  b.socket.send('x'.repeat(2049)); assert.equal((await sizeClosed)[0], 1009);
  assert.equal(f.rooms.snapshot(bootstrap.room.id).members.length, 1);
});

test('foreign room scopes and unknown fields still accumulate protocol-abuse strikes', async t => {
  const f = await fixture(t), bootstrap = await f.create(), a = await connect(f, bootstrap);
  const closed = once(a.socket, 'close');
  for (let index = 0; index < 8; index++) a.send('ready', { ready: false, revisionId: f.revision.id, ...(index % 2 ? { extra: true } : { roomId: 'another-room' }) });
  assert.equal((await closed)[0], 4008);
  assert.equal(a.messages.filter(message => message.type === 'error').length, 8);
  assert.ok(a.messages.some(message => message.code === 'invalid_scope'));
  assert.ok(a.messages.some(message => message.code === 'invalid_ready'));
});

test('lobby host replacement retains seats, rejects excess players, and recovers an unused join slot', async t => {
  const f = await fixture(t), first = await f.create(), a = await connect(f, first), reservation = await f.join(first.room.code);
  await f.post('/api/minigames/rooms/join', { code: first.room.code }, 409);
  f.advance(10001); assert.equal(f.rooms.snapshot(first.room.id).members.length, 1);
  const second = await f.join(first.room.code), b = await connect(f, second);
  assert.equal(second.member.slot, reservation.member.slot); assert.notEqual(second.member.id, reservation.member.id);
  a.socket.terminate(); await until(() => b.state().hostMemberId === second.member.id);
  assert.equal(b.state().members.length, 2, 'disconnected member keeps its seat during grace');
  await f.post('/api/minigames/rooms/join', { code: first.room.code }, 409);
  f.advance(30001); assert.equal(f.rooms.snapshot(first.room.id).members.length, 1);
  assert.equal(f.rooms.snapshot(first.room.id).hostMemberId, second.member.id);
});

test('Vite development and preview close live upgraded sockets before awaiting HTTP shutdown', async t => {
  const directory = await mkdtemp(resolve(tmpdir(), 'minigame-plugin-'));
  const oldDirectory = process.env.EARTHONLINE_MINIGAMES_DIR; process.env.EARTHONLINE_MINIGAMES_DIR = directory;
  t.after(async () => { if (oldDirectory === undefined) delete process.env.EARTHONLINE_MINIGAMES_DIR; else process.env.EARTHONLINE_MINIGAMES_DIR = oldDirectory; await rm(directory, { recursive: true, force: true }); });
  for (const hook of ['configureServer', 'configurePreviewServer']) {
    const app = express(), httpServer = createServer(app);
    const server = { config: { root: process.cwd() }, httpServer, middlewares: app,
      close: () => new Promise(done => { httpServer.closeAllConnections(); httpServer.close(done); }) };
    minigameInternalPlugin()[hook](server); t.after(() => server.close());
    await new Promise(done => httpServer.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${httpServer.address().port}`;
    const post = async (path, body) => { const response = await fetch(url + path, { ...json(body), headers: { Origin: url, 'Content-Type': 'application/json', 'X-Minigame-Request': 'earthonline-minigames' } }); assert.equal(response.status, path.endsWith('revisions') ? 201 : 200); return response.json(); };
    const { revision, state } = await post('/api/minigames/revisions', definition);
    await post(`/api/minigames/games/${definition.id}/publish`, { revisionId: revision.id, expectedVersion: state.gameVersions[definition.id] ?? 0 });
    const bootstrap = await post('/api/minigames/rooms', { gameId: definition.id, revisionId: revision.id });
    const client = await connect({ url, origin: url }, bootstrap);
    const closed = once(client.socket, 'close');
    await Promise.race([server.close(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('shutdown deadlocked')), 1000); timer.unref(); })]);
    await closed; assert.equal(httpServer.listening, false);
  }
});

