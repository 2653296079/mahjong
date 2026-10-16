const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker(fetch) {
  const handlers = {}, deleted = [], written = [], cached = { offline: true };
  const cache = { put: async (key, value) => written.push(key), match: async key => key === './index.html' ? cached : undefined };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    URL, fetch,
    self: { location: { href: 'https://example.com/mahjong/sw.js' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: { keys: async () => ['zmj-v15', 'zmj-v16', 'zmj-v17', 'zmj-v18', 'another-project-v1'], delete: async key => deleted.push(key), open: async () => cache, match: async () => undefined }
  });
  async function request(url = 'https://example.com/mahjong/?room=1234') {
    let response, pending = [];
    handlers.fetch({ request: { url, method: 'GET', mode: 'navigate', headers: { get: () => 'text/html' } }, respondWith: x => response = x, waitUntil: x => pending.push(x) });
    const result = await response; await Promise.all(pending); return result;
  }
  return { handlers, deleted, written, cached, request };
}

test('offline upgrade removes only this game old caches', async () => {
  const w = worker(); let done;
  w.handlers.activate({ waitUntil: x => done = x }); await done;
  assert.deepEqual(w.deleted, ['zmj-v15', 'zmj-v16', 'zmj-v17']);
});
test('failed HTTP responses are not cached; room links share one offline page', async () => {
  const error = worker(async () => ({ ok: false, status: 503 }));
  assert.equal((await error.request()).status, 503);
  assert.deepEqual(error.written, []);
  const good = worker(async () => ({ ok: true, clone: () => ({}) }));
  await good.request();
  assert.deepEqual(good.written, ['./index.html']);
});
test('offline navigation finds the canonical page; unrelated requests are not intercepted', async () => {
  const w = worker(async () => { throw Error('offline'); });
  assert.equal(await w.request(), w.cached);
  assert.equal(await w.request('https://example.com/another-project/'), undefined);
  assert.equal(await w.request('https://other.example.com/mahjong/'), undefined);
});
