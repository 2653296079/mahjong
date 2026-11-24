const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const base = 'https://example.com/mahjong/';

function worker(fetch, initial = {}) {
  const handlers = {}, written = [], cached = { offline: true };
  const stores = new Map(['zmj-v32b', 'zmj-v61', 'zmj-v62', 'zmj-v63', 'another-project-v1', 'zmj-v64'].map(name => [name, new Map()]));
  stores.get('zmj-v64').set(base + 'index.html', cached);
  for (const [name, assets] of Object.entries(initial)) {
    for (const [url, value] of Object.entries(assets)) stores.get(name).set(new URL(url, base).href, value);
  }
  const keyOf = request => new URL(request.url || request, base).href;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    URL, fetch,
    self: { location: { href: base + 'sw.js' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: {
      keys: async () => [...stores.keys()],
      delete: async name => stores.delete(name),
      open: async name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const entries = stores.get(name);
        return {
          put: async (key, value) => { written.push(key); entries.set(keyOf(key), value); },
          match: async key => entries.get(keyOf(key))
        };
      },
      match: async (request, { cacheName } = {}) => {
        if (cacheName) return stores.get(cacheName)?.get(keyOf(request));
        for (const entries of stores.values()) if (entries.has(keyOf(request))) return entries.get(keyOf(request));
      }
    }
  });
  async function request(url = 'https://example.com/mahjong/?room=1234', mode = 'navigate') {
    let response, pending = [];
    handlers.fetch({ request: { url, method: 'GET', mode, headers: { get: () => mode === 'navigate' ? 'text/html' : '' } }, respondWith: x => response = x, waitUntil: x => pending.push(x) });
    const result = await response; await Promise.all(pending); return result;
  }
  return { handlers, stores, written, cached, request };
}

test('offline upgrade retains only bounded current caches and preserves other projects', async () => {
  const w = worker(); let done;
  w.handlers.activate({ waitUntil: x => done = x }); await done;
  assert.deepEqual([...w.stores.keys()].sort(), ['another-project-v1', 'zmj-v62', 'zmj-v64']);
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

test('new worker serves exact model URLs cached by the previous release after the origin is offline', async () => {
  const roomUrl = base + 'assets/mahjong-3d/glb/room/afternoon-room.glb?build=v62';
  const companionUrl = base + 'assets/mahjong-3d/glb/companions/cat.glb';
  const room = new Response('previous room');
  const companion = new Response('previous cat');
  const upgraded = worker(async () => { throw Error('offline'); }, {
    'zmj-v62': { [roomUrl]: room, [companionUrl]: companion }
  });
  let activated;
  upgraded.handlers.activate({ waitUntil: promise => activated = promise });
  await activated;
  assert.equal(await (await upgraded.request(roomUrl, 'cors')).text(), 'previous room');
  assert.equal(await (await upgraded.request(companionUrl, 'cors')).text(), 'previous cat');
  assert.deepEqual(upgraded.written, [], 'legacy model data is not copied into the current cache');
});

test('the current worker recovers versioned v64 requests warmed before activation', async () => {
  const room = base + 'assets/mahjong-3d/glb/room/afternoon-room.glb?build=v64';
  const companion = base + 'assets/mahjong-3d/glb/companions/cat.glb?build=v64';
  const module = base + 'assets/table3d/table3d.js?build=v64';
  const upgraded = worker(async () => { throw Error('offline'); }, {
    'zmj-v62': { [room]: new Response('warmed v64 room'), [companion]: new Response('warmed v64 cat'), [module]: new Response('previous response') },
    'zmj-v64': { [module]: new Response('current response') },
    'another-project-v1': { [room]: new Response('unrelated response') }
  });
  let activated;
  upgraded.handlers.activate({ waitUntil: promise => activated = promise });
  await activated;
  assert.equal(await (await upgraded.request(room, 'cors')).text(), 'warmed v64 room');
  assert.equal(await (await upgraded.request(companion, 'cors')).text(), 'warmed v64 cat');
  assert.equal(await (await upgraded.request(module, 'cors')).text(), 'current response');
});

test('older model entries cannot satisfy requests with a new build query', async () => {
  const roomUrl = base + 'assets/mahjong-3d/glb/room/afternoon-room.glb';
  const companionUrl = base + 'assets/mahjong-3d/glb/companions/cat.glb';
  const upgraded = worker(async () => new Response('current model'), {
    'zmj-v62': { [roomUrl + '?build=v62']: new Response('previous room') },
    'zmj-v63': { [companionUrl]: new Response('previous cat') }
  });
  for (const url of [roomUrl, companionUrl]) {
    const request = url + '?build=v64';
    assert.equal(await (await upgraded.request(request, 'cors')).text(), 'current model');
    assert.ok(upgraded.stores.get('zmj-v64').has(request));
  }
});
test('visited Blender room, companions and portraits remain available offline', async () => {
  let online = true;
  const w = worker(async () => { if(!online) throw Error('offline'); return {ok:true,clone:()=>({ok:true,fromCache:true})}; });
  const paths = ['assets/table3d/companions.js','assets/mahjong-3d/glb/room/afternoon-room.glb',
    'assets/mahjong-3d/glb/room/machine-console.glb','assets/mahjong-3d/glb/companions/cat.glb',
    'assets/mahjong-3d/glb/companions/portraits/rabbit.png'];
  for(const path of paths) assert.equal((await w.request('https://example.com/mahjong/'+path,'cors')).ok,true);
  online = false;
  for(const path of paths) assert.equal((await w.request('https://example.com/mahjong/'+path,'cors')).fromCache,true);
  assert.equal(await w.request('https://example.com/mahjong/assets/mahjong-3d/glb/room/afternoon-room.blend','cors'),undefined);
});
