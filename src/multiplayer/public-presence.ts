import { createPoseBuffer, type InterpolatedPose, type TimedPose } from './pose-buffer.ts';

type Pose = Pick<InterpolatedPose, 'x' | 'y' | 'z' | 'yaw' | 'moving' | 'sprinting'>;
type Snapshot = { time: number; players: (TimedPose & { playerId: string })[] };

/** Connect only while a player opts into sharing the current city. */
export function createCityPresence(endpoint: string, city: string, onStatus?: (connected: boolean) => void) {
  const url = new URL(endpoint, window.location.href);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  url.searchParams.set('city', city);

  const tracks = new Map<string, ReturnType<typeof createPoseBuffer>>();
  const visible = new Map<string, InterpolatedPose>();
  let socket: WebSocket | undefined;
  let stopped = false, retry = 0, lastSent = -Infinity;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  function connect() {
    if (stopped) return;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      if (stopped) return;
      retry = 0; lastSent = -Infinity; onStatus?.(true);
    };
    ws.onmessage = event => {
      if (stopped || typeof event.data !== 'string') return;
      let data: Snapshot;
      try { data = JSON.parse(event.data); } catch { return; }
      if (!data || !Number.isFinite(data.time) || !Array.isArray(data.players)) return;
      const present = new Set<string>(), now = performance.now();
      for (const pose of data.players) {
        if (!pose || typeof pose.playerId !== 'string' || ![pose.x, pose.y, pose.z, pose.yaw, pose.updatedAt].every(Number.isFinite)) continue;
        present.add(pose.playerId);
        let track = tracks.get(pose.playerId);
        if (!track) { track = createPoseBuffer(); tracks.set(pose.playerId, track); }
        track.push({ ...pose, serverTime: data.time }, now);
      }
      for (const id of tracks.keys()) if (!present.has(id)) { tracks.delete(id); visible.delete(id); }
    };
    ws.onerror = () => { /* Close handles disconnect and retry across browsers. */ };
    ws.onclose = () => {
      if (stopped) return;
      tracks.clear(); visible.clear(); onStatus?.(false);
      reconnect = setTimeout(connect, Math.min(8000, 500 * 2 ** retry++));
    };
  }
  connect();
  return {
    update(pose: Pose) {
      const now = performance.now();
      if (socket?.readyState !== WebSocket.OPEN || now - lastSent < 100 || socket.bufferedAmount > 8192) return;
      lastSent = now;
      const { x, y, z, yaw, moving, sprinting } = pose;
      socket.send(JSON.stringify({ x, y, z, yaw, moving, sprinting }));
    },
    peers(now = performance.now()): ReadonlyMap<string, InterpolatedPose> {
      for (const [id, track] of tracks) {
        const out = visible.get(id) ?? { x: 0, y: 0, z: 0, yaw: 0, moving: false, sprinting: false };
        if (track.sample(now, out)) visible.set(id, out);
      }
      return visible;
    },
    dispose() {
      stopped = true;
      if (reconnect !== undefined) clearTimeout(reconnect);
      socket?.close();
      tracks.clear(); visible.clear();
    },
  };
}
