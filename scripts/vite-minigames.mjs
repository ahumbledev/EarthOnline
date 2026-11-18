import express from 'express';
import { createMinigameRouter } from '../server/minigame-api.mjs';
import { createMinigameStore, defaultMinigameDirectory } from '../server/minigame-store.mjs';
import { createMinigameRooms } from '../server/minigame-rooms.mjs';

/** Runtime-only local API; no upload directory or internal key enters browser bundles. */
export function minigameInternalPlugin() {
  const cleanups = new Set();
  function install(server) {
    const projectRoot = server.config.root;
    const enabled = process.env.EARTHONLINE_MINIGAMES_ENABLED !== '0';
    const serverAddress = () => server.httpServer?.address();
    const store = createMinigameStore({ directory: process.env.EARTHONLINE_MINIGAMES_DIR || defaultMinigameDirectory(projectRoot), projectRoot });
    const rooms = createMinigameRooms({ store, enabled, local: true, serverAddress });
    const router = createMinigameRouter({ local: true, enabled, projectRoot, serverAddress, store, rooms });
    const upgrade = (req, socket, head) => rooms.handleUpgrade(req, socket, head);
    const cleanup = async () => {
      cleanups.delete(cleanup); server.httpServer?.removeListener('upgrade', upgrade); await rooms.close();
    };
    cleanups.add(cleanup);
    server.httpServer?.on('upgrade', upgrade);
    server.httpServer?.once('close', () => { void cleanup(); });
    // Preview does not invoke plugin closeServer hooks; stop upgraded sockets
    // before its HTTP close waits for them. Development restart uses the hook.
    if (typeof server.close === 'function') {
      const close = server.close.bind(server);
      server.close = async (...args) => { await cleanup(); return close(...args); };
    }
    if (typeof server._closeServer === 'function') {
      const closeServer = server._closeServer.bind(server);
      server._closeServer = async (...args) => { await cleanup(); return closeServer(...args); };
    }
    const app = express(); app.disable('x-powered-by'); app.use(router);
    server.middlewares.use((req, res, next) => {
      if (!(req.url === '/api/minigames' || req.url?.startsWith('/api/minigames/') || req.url?.startsWith('/api/minigames?'))) return next();
      app(req, res, next);
    });
  }
  return { name: 'earthonline-minigames-internal', configureServer: install, configurePreviewServer: install,
    closeServer: async () => { await Promise.all([...cleanups].map(cleanup => cleanup())); } };
}
