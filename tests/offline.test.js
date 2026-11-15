const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function worker(fetch) {
  const handlers = {}, deleted = [], written = [], cached = { offline: true }, staticAssets = new Map();
  const cache = { put: async (key, value) => { written.push(key); staticAssets.set(key.url || key, value); }, match: async key => key === './index.html' ? cached : undefined };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), {
    URL, fetch,
    self: { location: { href: 'https://example.com/mahjong/sw.js' }, clients: { claim: async () => {} }, addEventListener: (name, fn) => handlers[name] = fn },
    caches: { keys: async () => ['zmj-v15', 'zmj-v16', 'zmj-v17', 'zmj-v18', 'zmj-v19', 'zmj-v20', 'zmj-v21', 'zmj-v22', 'zmj-v23', 'zmj-v24', 'zmj-v25', 'zmj-v26', 'zmj-v27', 'zmj-v28', 'zmj-v29', 'zmj-v30', 'zmj-v31', 'zmj-v32', 'zmj-v32b', 'zmj-v33', 'zmj-v34', 'zmj-v35', 'zmj-v36', 'zmj-v37', 'zmj-v38', 'zmj-v39', 'zmj-v40', 'zmj-v41', 'zmj-v42', 'zmj-v43', 'zmj-v44', 'zmj-v45', 'zmj-v46', 'zmj-v47', 'zmj-v48', 'zmj-v49', 'zmj-v50', 'zmj-v51', 'zmj-v59', 'zmj-v60', 'zmj-v61', 'another-project-v1'], delete: async key => deleted.push(key), open: async () => cache, match: async request => staticAssets.get(request.url) }
  });
  async function request(url = 'https://example.com/mahjong/?room=1234', mode = 'navigate') {
    let response, pending = [];
    handlers.fetch({ request: { url, method: 'GET', mode, headers: { get: () => mode === 'navigate' ? 'text/html' : '' } }, respondWith: x => response = x, waitUntil: x => pending.push(x) });
    const result = await response; await Promise.all(pending); return result;
  }
  return { handlers, deleted, written, cached, request };
}

test('offline upgrade removes only this game old caches', async () => {
  const w = worker(); let done;
  w.handlers.activate({ waitUntil: x => done = x }); await done;
  assert.deepEqual(w.deleted, ['zmj-v15', 'zmj-v16', 'zmj-v17', 'zmj-v18', 'zmj-v19', 'zmj-v20', 'zmj-v21', 'zmj-v22', 'zmj-v23', 'zmj-v24', 'zmj-v25', 'zmj-v26', 'zmj-v27', 'zmj-v28', 'zmj-v29', 'zmj-v30', 'zmj-v31', 'zmj-v32', 'zmj-v32b', 'zmj-v33', 'zmj-v34', 'zmj-v35', 'zmj-v36', 'zmj-v37', 'zmj-v38', 'zmj-v39', 'zmj-v40', 'zmj-v41', 'zmj-v42', 'zmj-v43', 'zmj-v44', 'zmj-v45', 'zmj-v46', 'zmj-v47', 'zmj-v48', 'zmj-v49', 'zmj-v50', 'zmj-v51', 'zmj-v59', 'zmj-v60', 'zmj-v61']);
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
