import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, realpath, lstat, chmod, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { unpackMinigameZip, validateMinigamePackage, archiveGameJson, minigameError } from './minigame-package.mjs';

export const MINIGAME_STORAGE_LIMITS = Object.freeze({ games: 200, revisions: 2000, bytes: 2 * 1024 ** 3 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const below = (parent, child) => { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); };
const revisionId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const own = (record, key, fallback) => Object.hasOwn(record, key) ? record[key] : fallback;
const unavailable = () => minigameError(503, 'minigames_storage_unavailable', 'Internal minigame storage is unavailable.');
const queues = new Map();
function serial(key, task) {
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(task); queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}
export function defaultMinigameDirectory(projectRoot = process.cwd()) {
  return resolve(homedir(), '.local/share/earthonline/minigames-internal', hash(resolve(projectRoot)).slice(0, 16));
}

/** Single process owner. Immutable revisions and atomic state commits; no account or city writes. */
export function createMinigameStore({ directory = defaultMinigameDirectory(), projectRoot = process.cwd(),
  validator = validateMinigamePackage, storageLimits = MINIGAME_STORAGE_LIMITS } = {}) {
  const requested = resolve(directory); let initialized;
  const initialize = () => initialized ??= (async () => {
    const project = await realpath(projectRoot);
    if (below(project, requested)) throw unavailable();
    await mkdir(requested, { recursive: true, mode: 0o700 });
    const root = await realpath(requested);
    if (below(project, root)) throw unavailable();
    await chmod(root, 0o700); const revisions = resolve(root, 'revisions');
    await mkdir(revisions, { recursive: true, mode: 0o700 });
    if ((await lstat(revisions)).isSymbolicLink() || !below(root, await realpath(revisions))) throw unavailable();
    return root;
  })().catch(error => { initialized = undefined; throw error; });
  const readState = async root => {
    let state;
    try { state = JSON.parse(await readFile(resolve(root, 'state.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { version: 0, gameVersions: {}, active: {}, revisions: [] }; throw unavailable(); }
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    if (!Number.isSafeInteger(state.version) || state.version < 0 || !object(state.gameVersions) || !object(state.active) || !Array.isArray(state.revisions)
      || state.revisions.length > storageLimits.revisions || state.revisions.some(r => !object(r) || !revisionId(r.id) || typeof r.gameId !== 'string' || !Number.isSafeInteger(r.storageBytes) || r.storageBytes < 0)
      || new Set(state.revisions.map(r => r.id)).size !== state.revisions.length
      || Object.entries(state.gameVersions).some(([game, version]) => !Number.isSafeInteger(version) || version < 0 || !state.revisions.some(r => r.gameId === game))
      || Object.entries(state.active).some(([game, id]) => !state.revisions.some(r => r.id === id && r.gameId === game))) throw unavailable();
    return state;
  };
  const writeState = async (root, state) => {
    const temporary = resolve(root, `.state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, resolve(root, 'state.json'));
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  };
  // Called only under the same process-wide write lock. A crash before the atomic
  // state rename can leave an unreferenced directory, never a published revision.
  const recover = async (root, state) => {
    const ids = new Set(state.revisions.map(r => r.id));
    for (const name of await readdir(root)) if (/^\.(?:pending|state)-[a-f0-9-]+(?:\.tmp)?$/.test(name)) await rm(resolve(root, name), { recursive: true, force: true });
    for (const name of await readdir(resolve(root, 'revisions'))) {
      if (revisionId(name) && !ids.has(name)) await rm(resolve(root, 'revisions', name), { recursive: true, force: true });
    }
  };
  const publicState = state => ({ ...state, revisions: state.revisions.map(({ storageBytes: _bytes, ...revision }) => revision) });
  const checkRevision = async (root, revision) => {
    const directory = resolve(root, 'revisions', revision.id);
    try {
      if ((await lstat(directory)).isSymbolicLink() || !below(root, await realpath(directory))) throw unavailable();
      const record = JSON.parse(await readFile(resolve(directory, 'record.json'), 'utf8'));
      const expected = [['archive.zip', revision.archiveSha256], ...Object.entries(record.hashes).map(([path, digest]) => [`files/${path}`, digest])];
      for (const [name, digest] of expected) {
        const path = resolve(directory, name);
        if (!below(directory, path) || !below(directory, await realpath(path)) || (await lstat(path)).isSymbolicLink() || hash(await readFile(path)) !== digest) throw unavailable();
      }
    } catch { throw unavailable(); }
  };
  return {
    async state() { return publicState(await readState(await initialize())); },
    /** Capture a checked immutable definition under the same lock as publication. */
    async published(gameId, expectedRevisionId) {
      const root = await initialize();
      return serial(root, async () => {
        const state = await readState(root), id = own(state.active, gameId, null);
        if (!id) throw minigameError(404, 'game_not_published', 'This game is not published.');
        if (id !== expectedRevisionId) throw minigameError(409, 'publication_changed', 'The published revision changed; refresh before creating a room.');
        const revision = state.revisions.find(item => item.id === id && item.gameId === gameId);
        if (!revision) throw unavailable();
        await checkRevision(root, revision);
        const definition = JSON.parse(await readFile(resolve(root, 'revisions', id, 'files/game.json'), 'utf8'));
        const { storageBytes: _bytes, ...metadata } = revision;
        return { revision: metadata, definition };
      });
    },
    async upload(input, { json = false } = {}) {
      const archive = json ? archiveGameJson(input) : input;
      const files = await unpackMinigameZip(archive), { definition, report } = await validator(files);
      const root = await initialize();
      return serial(root, async () => {
        const state = await readState(root); await recover(root, state);
        const games = new Set(state.revisions.map(r => r.gameId));
        const id = randomUUID(), staging = resolve(root, `.pending-${id}`), destination = resolve(root, 'revisions', id);
        const prefix = `/api/minigames/revisions/${id}`;
        const assetPaths = Object.fromEntries(Object.entries(definition.assets ?? {}).map(([key, asset]) => [key, asset.path]));
        const revision = { id, gameId: definition.id, name: definition.title, revision: definition.version, createdAt: new Date().toISOString(),
          archiveSha256: hash(archive), bytes: archive.length,
          files: { definition: `${prefix}/files/definition`, archive: `${prefix}/files/archive`, assets: Object.fromEntries(Object.keys(assetPaths).map(key => [key, `${prefix}/assets/${encodeURIComponent(key)}`])) }, report };
        const record = JSON.stringify({ assets: assetPaths, hashes: Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])) }) + '\n';
        // Include persisted metadata, with bounded allowance for the per-game CAS
        // and active indexes and the counter itself. Never silently evict history.
        const storageBytes = archive.length + [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0)
          + Buffer.byteLength(record) + Buffer.byteLength(JSON.stringify(revision)) + 512;
        if (state.revisions.length >= storageLimits.revisions || (!games.has(definition.id) && games.size >= storageLimits.games)
          || state.revisions.reduce((sum, r) => sum + r.storageBytes, 0) + storageBytes > storageLimits.bytes) {
          throw minigameError(507, 'storage_capacity', 'The internal minigame store is full; an operator must archive old data before more uploads.');
        }
        let moved = false;
        try {
          await mkdir(staging, { mode: 0o700 });
          for (const [name, bytes] of files) {
            const target = resolve(staging, 'files', name);
            await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
          }
          await writeFile(resolve(staging, 'archive.zip'), archive, { flag: 'wx', mode: 0o600 });
          await writeFile(resolve(staging, 'record.json'), record, { flag: 'wx', mode: 0o600 });
          const next = { ...state, version: state.version + 1, revisions: [...state.revisions, { ...revision, storageBytes }] };
          await rename(staging, destination); moved = true; await writeState(root, next);
          return { revision, state: publicState(next) };
        } catch (error) { await rm(moved ? destination : staging, { recursive: true, force: true }); throw error; }
      });
    },
    async publish(gameId, id, expectedVersion) {
      if (typeof gameId !== 'string' || !(id === null || revisionId(id)) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw minigameError(400, 'invalid_publication', 'Provide a revisionId or null and a nonnegative expectedVersion.');
      const root = await initialize();
      return serial(root, async () => {
        const state = await readState(root);
        if (!state.revisions.some(r => r.gameId === gameId)) throw minigameError(404, 'unknown_game', 'Unknown minigame.');
        const version = own(state.gameVersions, gameId, 0);
        if (version !== expectedVersion) throw minigameError(409, 'state_conflict', 'This game publication changed; refresh before publishing.');
        if (id !== null) {
          const revision = state.revisions.find(r => r.id === id && r.gameId === gameId);
          if (!revision) throw minigameError(404, 'unknown_revision', 'The revision does not belong to this game.');
          await checkRevision(root, revision);
        }
        const active = { ...state.active }; if (id === null) delete active[gameId]; else active[gameId] = id;
        const next = { ...state, version: state.version + 1, gameVersions: { ...state.gameVersions, [gameId]: version + 1 }, active };
        await writeState(root, next); return publicState(next);
      });
    },
    async file(id, kind, assetId) {
      if (!revisionId(id) || !['definition', 'archive', 'asset'].includes(kind)) throw minigameError(404, 'unknown_file', 'Unknown minigame file.');
      const root = await initialize(), state = await readState(root);
      if (!state.revisions.some(r => r.id === id)) throw minigameError(404, 'unknown_revision', 'Unknown minigame revision.');
      const revisionRoot = resolve(root, 'revisions', id);
      const record = JSON.parse(await readFile(resolve(revisionRoot, 'record.json'), 'utf8'));
      const asset = kind === 'asset' && typeof assetId === 'string' && own(record.assets, assetId, null);
      const path = kind === 'archive' ? resolve(revisionRoot, 'archive.zip') : kind === 'definition' ? resolve(revisionRoot, 'files/game.json') : asset ? resolve(revisionRoot, 'files', asset) : null;
      if (!path || !below(revisionRoot, path)) throw minigameError(404, 'unknown_file', 'Unknown minigame file.');
      const actual = await realpath(path), info = await lstat(path);
      if (!below(root, await realpath(revisionRoot)) || !below(revisionRoot, actual) || !info.isFile() || info.isSymbolicLink()) throw minigameError(404, 'unknown_file', 'Unknown minigame file.');
      return { path, kind, bytes: info.size };
    },
  };
}
