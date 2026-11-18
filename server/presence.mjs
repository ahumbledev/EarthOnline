import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { createCitySpatialIndex, selectCityVisibility } from './city-aoi.mjs';
import { MAX_ROOM_CLIENTS, POSE_SEND_HZ } from './visibility-rules.mjs';

const tickMs = 1000 / POSE_SEND_HZ;
const maximumPosition = 1_000_000;
const idleTimeout = 45_000;

function readPose(data) {
  let pose;
  try { pose = JSON.parse(data.toString()); } catch { return undefined; }
  if (!pose || ![pose.x, pose.y, pose.z, pose.yaw].every(n => Number.isFinite(n) && Math.abs(n) <= maximumPosition)) return undefined;
  if (typeof pose.moving !== 'boolean' || typeof pose.sprinting !== 'boolean') return undefined;
  const { x, y, z, yaw, moving, sprinting } = pose;
  return { x, y, z, yaw, moving, sprinting: moving && sprinting };
}

/** Ephemeral city presence. All player identities and positions expire on disconnect. */
export function createPresenceServer({ allowedOrigin = '', playerLimit = MAX_ROOM_CLIENTS } = {}) {
  const players = new Map();
  const http = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    } else res.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  http.on('upgrade', (req, socket, head) => {
    let city;
    try {
      const url = new URL(req.url, 'http://localhost');
      const host = new URL('http://' + req.headers.host).hostname;
      const origin = req.headers.origin;
      if ((origin && origin !== allowedOrigin && new URL(origin).hostname !== host)
          || url.pathname !== '/presence' || players.size >= playerLimit) return socket.destroy();
      city = url.searchParams.get('city');
      if (!city || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(city)) return socket.destroy();
    } catch { return socket.destroy(); }
    sockets.handleUpgrade(req, socket, head, ws => {
      const id = randomUUID();
      const entry = { ws, city, lastPacket: Date.now(), window: Date.now(), count: 0, previous: new Set(), pose: null };
      players.set(id, entry);
      ws.on('error', () => ws.terminate());
      ws.on('close', () => players.delete(id));
      ws.on('message', (data, isBinary) => {
        const now = Date.now();
        if (now - entry.window >= 1000) { entry.count = 0; entry.window = now; }
        if (isBinary || ++entry.count > 35) return ws.close(1008, 'Invalid message rate or format');
        const pose = readPose(data);
        if (!pose) return ws.close(1008, 'Invalid position');
        entry.lastPacket = now;
        entry.pose = { playerId: id, ...pose, updatedAt: now };
      });
    });
  });
  const timer = setInterval(() => {
    const now = Date.now(), groups = new Map();
    for (const peer of players.values()) {
      if (now - peer.lastPacket > idleTimeout || peer.ws.bufferedAmount > 128 * 1024) { peer.ws.terminate(); continue; }
      if (!peer.pose || peer.ws.readyState !== WebSocket.OPEN) continue;
      let group = groups.get(peer.city);
      if (!group) { group = []; groups.set(peer.city, group); }
      group.push(peer);
    }
    for (const group of groups.values()) {
      const index = createCitySpatialIndex(group.map(peer => peer.pose));
      for (const peer of group) {
        const nearby = selectCityVisibility(peer.pose, index.query(peer.pose), peer.previous);
        peer.previous = new Set(nearby.map(pose => pose.playerId));
        peer.ws.send(JSON.stringify({ time: now, players: nearby }));
      }
    }
  }, tickMs);
  timer.unref();
  const close = async () => {
    clearInterval(timer);
    for (const peer of players.values()) peer.ws.terminate();
    sockets.close();
    if (http.listening) await new Promise((resolve,reject) => http.close(error => error ? reject(error) : resolve()));
  };
  return { http, close };
}
