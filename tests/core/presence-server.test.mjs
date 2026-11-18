import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createPresenceServer } from '../../server/presence.mjs';

test('nearby clients share anonymous poses in their city and departures clear the last snapshot', {timeout: 6000}, async t => {
  const server = createPresenceServer();
  server.http.listen(0, '127.0.0.1'); await once(server.http, 'listening');
  const url = 'ws://127.0.0.1:' + server.http.address().port + '/presence?city=';
  t.after(() => server.close());
  const sockets = await Promise.all(['paris','paris','oslo','paris'].map(async city => {
    const ws = new WebSocket(url + city);
    await once(ws, 'open');
    t.after(() => ws.terminate());
    return ws;
  }));
  const positions = [2, 8, 2, 160];
  const messages = sockets.map(ws => once(ws, 'message'));
  for (const [i,ws] of sockets.entries()) ws.send(JSON.stringify({ x:positions[i], y:0, z:0, yaw:0, moving:true, sprinting:false }));
  const [one,two,three,far] = (await Promise.all(messages)).map(([message]) => JSON.parse(message).players);
  assert.deepEqual(one.map(player => player.x), [8]);
  assert.deepEqual(two.map(player => player.x), [2]);
  assert.deepEqual(three, []); assert.deepEqual(far, []);
  assert.notEqual(one[0].playerId,two[0].playerId);
  const closed = once(sockets[1], 'close');
  sockets[1].send(JSON.stringify({ x:1e100, y:0, z:0, yaw:0, moving:true, sprinting:false }));
  assert.equal((await closed)[0],1008);
  const [next] = await once(sockets[0], 'message');
  assert.deepEqual(JSON.parse(next).players, []);
});
