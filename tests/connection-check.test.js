'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { attach } = require('../server/mjs-server');
const { checkConnection, summarize } = require('../evaluation/check-connection');
test('read-only probe measures real HTTP and WS without joining or starting a room', async t => {
  const server = http.createServer((req, res) => { res.end(req.url === '/healthz' ? JSON.stringify({ status:'ok',token:'must-not-save' }) : '<h1>麻将</h1>'); });
  const hub = attach(server); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { hub.close(); server.close(); });
  const room = hub.store.create('8888'); room.join('原房间玩家');
  const report = await checkConnection({ url: 'http://127.0.0.1:' + server.address().port, samples: 3, interval: 0 });
  assert.equal(report.page.status, 200); assert.equal(report.websocket.summary.count, 3);
  assert.equal(report.websocket.error, undefined); assert.ok(report.websocket.rows.every(r => r.echoedProbe));
  assert.equal(hub.store.rooms.size, 1); assert.equal(room.members.length, 1); assert.equal(room.game, null);
  assert.equal(report.http[0].health.token, undefined);
});
test('probe summaries and bounded inputs have explicit behavior', async () => {
  assert.deepEqual(summarize([3,1,5,2,4]),{count:5,minMs:1,medianMs:3,p95Ms:5,maxMs:5});
  assert.deepEqual(summarize([]),{count:0});
  await assert.rejects(checkConnection({url:'https://example.com',samples:61}));
  await assert.rejects(checkConnection({url:'https://name:password@example.com'}));
});
