import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { MINIGAME_LIMITS } from '../shared/minigame-protocol.mjs';
import { minigameError } from './minigame-package.mjs';
import { createMinigameStore, defaultMinigameDirectory, MINIGAME_STORAGE_LIMITS } from './minigame-store.mjs';
import { MINIGAME_NETWORK_VERSION } from './minigame-rooms.mjs';
import { addressKey, clientAddress } from './security.mjs';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const digest = value => createHash('sha256').update(value).digest();
function localRequest(req, serverAddress) {
  const address = serverAddress?.();
  if (!address || typeof address === 'string' || !loopback(address.address) || !loopback(req.socket.remoteAddress)) return false;
  try {
    const expected = new URL(`${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) || Number(expected.port || (expected.protocol === 'https:' ? 443 : 80)) !== address.port) return false;
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return false;
    const supplied = req.headers.origin || (req.headers.referer && new URL(req.headers.referer).origin);
    return supplied === expected.origin;
  } catch { return false; }
}
const headers = res => {
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Vary', 'Origin');
};

/** Dedicated internal interface: bearer/anonymous game accounts do not confer access. */
export function createMinigameRouter({ enabled = false, key, directory, projectRoot = process.cwd(), origins = [], serverAddress, rooms, clientIpHeader,
  local = false, store = createMinigameStore({ directory: directory || defaultMinigameDirectory(projectRoot), projectRoot }) } = {}) {
  const router = express.Router(); let uploads = 0;
  router.use('/api/minigames', (req, res, next) => {
    headers(res);
    const localAllowed = local && localRequest(req, serverAddress);
    const available = local ? localAllowed && enabled !== false : enabled === true && typeof key === 'string' && key.length > 0;
    req.minigameAuthRequired = !localAllowed;
    req.minigameEnabled = available;
    if (!local) {
      let origin = req.headers.origin;
      if (!origin && req.headers.referer) { try { origin = new URL(req.headers.referer).origin; } catch { /* Rejected below. */ } }
      if (typeof origin !== 'string' || !origins.includes(origin)) throw minigameError(403, 'origin_denied', 'minigame request origin is not allowed.');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Minigame-Request,X-Minigame-Key');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') { if (!available) throw minigameError(403, 'minigames_disabled', 'Internal minigame is not available.'); return res.status(204).end(); }
    if (req.method === 'GET' && req.path === '/config') return next();
    if (!available) throw minigameError(403, 'minigames_disabled', 'Internal minigame is not available.');
    if (req.headers['x-minigame-request'] !== 'earthonline-minigames') throw minigameError(403, 'request_denied', 'The minigame request marker is required.');
    if (!localAllowed && (typeof req.headers['x-minigame-key'] !== 'string' || !timingSafeEqual(digest(req.headers['x-minigame-key']), digest(key)))) throw minigameError(403, 'invalid_minigame_key', 'A valid internal minigame key is required.');
    next();
  });
  router.get('/api/minigames/config', (req, res) => res.json({ enabled: req.minigameEnabled, internal: true, authRequired: req.minigameAuthRequired,
    limits: { ...MINIGAME_LIMITS, storage: MINIGAME_STORAGE_LIMITS }, schemaVersion: 1, schemaVersions: [1, 2],
    realtime: { enabled: req.minigameEnabled && Boolean(rooms), protocolVersion: MINIGAME_NETWORK_VERSION,
      maxPlayers: 4, resumeGraceMs: rooms?.limits.resumeGraceMs ?? 30000, inputHz: 20, snapshotHz: 10 } }));
  router.get('/api/minigames/state', async (_req, res) => res.json(await store.state()));
  const roomBody = express.json({ limit: '2kb', strict: true, inflate: false });
  const roomRequest = operation => async (req, res) => {
    if (!req.is('application/json')) throw minigameError(415, 'invalid_content_type', 'Room requests require application/json.');
    if (!rooms) throw minigameError(503, 'realtime_unavailable', 'Internal minigame rooms are unavailable.');
    const origin = req.headers.origin || new URL(req.headers.referer).origin;
    res.json(await operation(req, { origin, ip: addressKey(clientAddress(req, clientIpHeader)) }));
  };
  router.post('/api/minigames/rooms', roomBody, roomRequest((req, context) => rooms.create(req.body, context)));
  router.post('/api/minigames/rooms/join', roomBody, roomRequest((req, context) => rooms.join(req.body, context)));
  router.post('/api/minigames/rooms/:roomId/reconnect', roomBody, roomRequest((req, context) => rooms.reconnect(req.params.roomId, req.body, context)));
  const parseZip = express.raw({ type: 'application/zip', limit: MINIGAME_LIMITS.archiveBytes, inflate: false });
  const parseDefinition = express.raw({ type: 'application/json', limit: MINIGAME_LIMITS.definitionBytes, inflate: false });
  router.post('/api/minigames/revisions', async (req, res) => {
    const json = Boolean(req.is('application/json'));
    if (!json && !req.is('application/zip')) throw minigameError(415, 'invalid_content_type', 'Upload application/zip or a game definition as application/json.');
    if (uploads >= 1) throw minigameError(429, 'upload_busy', 'Another upload is being processed; try again shortly.');
    uploads++;
    try {
      req.setTimeout(120_000);
      await new Promise((done, reject) => (json ? parseDefinition : parseZip)(req, res, error => error ? reject(error) : done()));
      const result = await store.upload(req.body, { json });
      if (!res.destroyed) res.status(201).json(result);
    } finally { uploads--; }
  });
  router.post('/api/minigames/games/:gameId/publish', express.json({ limit: '2kb', strict: true, inflate: false }), async (req, res) => {
    if (!req.is('application/json')) throw minigameError(415, 'invalid_content_type', 'Publication requires application/json.');
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length !== 2 || !Object.hasOwn(req.body, 'revisionId') || !Object.hasOwn(req.body, 'expectedVersion')) throw minigameError(400, 'invalid_publication', 'Provide only revisionId and expectedVersion.');
    res.json(await store.publish(req.params.gameId, req.body.revisionId, req.body.expectedVersion));
  });
  const sendFile = async (req, res, next, kind, assetId) => {
    const file = await store.file(req.params.id, kind, assetId);
    res.setHeader('Content-Type', kind === 'archive' ? 'application/zip' : kind === 'definition' ? 'application/json; charset=utf-8'
      : ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(file.path).toLowerCase()] || 'application/octet-stream'));
    if (kind === 'archive') res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.zip"`);
    res.sendFile(file.path, { dotfiles: 'allow', cacheControl: false, lastModified: false }, error => { if (error) next(error); });
  };
  router.get('/api/minigames/revisions/:id/files/:kind', (req, res, next) => {
    if (!['definition', 'archive'].includes(req.params.kind)) throw minigameError(404, 'unknown_file', 'Unknown minigame file.');
    return sendFile(req, res, next, req.params.kind);
  });
  router.get('/api/minigames/revisions/:id/assets/:assetId', (req, res, next) => sendFile(req, res, next, 'asset', req.params.assetId));
  router.use('/api/minigames', (_req, _res, next) => next(minigameError(404, 'unknown_endpoint', 'Unknown minigame endpoint.')));
  router.use((error, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    headers(res);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : Number.isInteger(error.status) && (error.status >= 400 && error.status < 500 || error.status === 507) ? error.status : 503;
    const code = error.type === 'entity.too.large' ? 'archive_too_large' : error.type === 'entity.parse.failed' ? 'invalid_json' : status === 503 ? 'minigames_unavailable' : error.code || 'invalid_request';
    const message = status === 503 ? 'Internal minigame storage is unavailable.' : error.type === 'entity.too.large' ? 'Request exceeds the allowed size.' : error.type === 'entity.parse.failed' ? 'Invalid JSON request.' : error.message;
    res.status(status).json({ code, message, error: message, ...(Array.isArray(error.issues) && status === 400 ? { issues: error.issues.slice(0, 64) } : {}) });
  });
  return router;
}
