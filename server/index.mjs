import { createPresenceServer } from './presence.mjs';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4174);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const server = createPresenceServer({ allowedOrigin: process.env.ALLOWED_ORIGIN || '' });
server.http.listen(port, host, () => console.log('Presence server listening on %s:%d', host, port));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void server.close(); });
