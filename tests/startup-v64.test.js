const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the production startup with real Three.js scene objects and substitute the
// browser-only renderer, parser, DOM, and network so stall timing is deterministic.
const modulePath = path.join(__dirname, '..', 'assets', 'table3d', 'table3d.js');
const source = fs.readFileSync(modulePath, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('export async function createTable3D', 'async function createTable3D')
  .replace('import.meta.url', '"https://example.com/mahjong/assets/table3d/table3d.js?build=v64"');

async function startup({ modelFetch, buildCast, failResize, awaitParse } = {}) {
  const three = await import('../assets/vendor/three/three.module.js');
  const pendingTimers = new Map(), children = [], requests = [], disposed = [], listeners = new Set();
  let now = 0, nextTimer = 0, remainingResizeFailures = failResize ? 1 : 0;
  const document = {
    createElement: () => element(), addEventListener: (name, fn) => listeners.add(fn),
    removeEventListener: (name, fn) => listeners.delete(fn),
    defaultView: {
      matchMedia: () => ({ matches: true }), innerWidth: 800, devicePixelRatio: 1,
      performance: { now: () => now },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      ResizeObserver: class { observe() { listeners.add(this); } disconnect() { listeners.delete(this); } },
    },
  };
  const host = {
    ownerDocument: document,
    dataset: {}, getBoundingClientRect: () => ({ width: 800, height: 600 }),
    appendChild(node) { children.push(node); },
  };
  const element = () => ({
    setAttribute() {}, addEventListener() {},
    remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {},
      createRadialGradient: () => ({ addColorStop() {} }), fillRect() {},
    }),
  });
  class WebGLRenderer {
    domElement = element();
    shadowMap = {};
    capabilities = { getMaxAnisotropy: () => 8 };
    getContext() { return { getExtension: () => null }; }
    setPixelRatio() {}
    setSize() { if (remainingResizeFailures-- > 0) throw Error('resize failed'); }
    dispose() { disposed.push('renderer'); }
    forceContextLoss() { disposed.push('context'); }
  }
  class PMREMGenerator {
    fromScene() { return { texture: new three.Texture(), dispose: () => disposed.push('environment') }; }
    dispose() {}
  }
  class GLTFLoader {
    async parseAsync() {
      const scene = new three.Scene(), geometry = new three.BoxGeometry();
      geometry.addEventListener('dispose', () => disposed.push('model geometry'));
      scene.add(new three.Mesh(geometry, new three.MeshStandardMaterial()));
      await awaitParse?.();
      return { scene, scenes: [scene], animations: [] };
    }
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  async function tick(ms) {
    const end = now + ms;
    while (pendingTimers.size) {
      const [id, timer] = [...pendingTimers].sort((a, b) => a[1].at - b[1].at)[0];
      if (timer.at > end) break;
      now = timer.at; pendingTimers.delete(id); timer.fn();
      await settle();
    }
    now = end;
    await settle();
  }
  function slowResponse(signal, delays) {
    const body = new ReadableStream({
      start(controller) {
        const tasks = delays.map((delay, i) => setTimer(() => {
          controller.enqueue(new Uint8Array([i]));
          if (i === delays.length - 1) controller.close();
        }, delay));
        signal.addEventListener('abort', () => {
          tasks.forEach(id => pendingTimers.delete(id));
          try { controller.error(signal.reason); } catch {}
        }, { once: true });
      },
    });
    return new Response(body);
  }
  function setTimer(fn, delay) { const id = ++nextTimer; pendingTimers.set(id, { at: now + delay, fn }); return id; }
  const createTable3D = vm.runInNewContext(source + '\ncreateTable3D', {
    THREE: { ...three, WebGLRenderer, PMREMGenerator }, GLTFLoader, RoomEnvironment: class { dispose() {} },
    createCompanions: buildCast || (() => ({ count: 4, cast: ['cat', 'fox', 'panda', 'rabbit'] })),
    AbortController, URL,
    setTimeout: setTimer, clearTimeout: id => pendingTimers.delete(id),
    fetch: async (url, { signal }) => {
      requests.push({ url, signal });
      return modelFetch?.(url, signal, slowResponse) || new Response(new Uint8Array([1]));
    },
  }, { filename: modulePath });
  return { children, requests, disposed, listeners, settle, tick, start: callbacks => createTable3D(host, callbacks) };
}

test('room download can progress past the former 25-second deadline', async () => {
  const game = await startup({ modelFetch: (url, signal, response) => {
    if (url.pathname.endsWith('/afternoon-room.glb')) return response(signal, [10000, 20000, 30000]);
  } });
  const progress = [];
  const creating = game.start({ onProgress: (done, total) => progress.push([done, total]) });
  creating.catch(() => {});
  await game.settle();
  await game.tick(31000);
  const api = await creating;
  assert.deepEqual(progress.at(-1), [37, 37]);
  api.dispose();
});

test('stalled room downloads identify the stuck model and release startup resources', async () => {
  const game = await startup({ modelFetch: (url, signal, response) => {
    if (url.pathname.endsWith('/afternoon-room.glb')) return response(signal, []);
  } });
  const creating = game.start();
  const rejected = assert.rejects(creating, { code: 'MODEL_TIMEOUT', message: /mahjong-table/ });
  rejected.catch(() => {});
  await game.settle();
  await game.tick(60000);
  await rejected;
  assert.equal(game.children.length, 0);
  assert.ok(game.disposed.includes('environment'));
  assert.ok(game.requests.every(({ signal }) => signal.aborted));
});

test('the room and tiles get a head start before retrieving the versioned companion assets', async () => {
  const game = await startup({ modelFetch: (url, signal, response) => {
    if (url.pathname.endsWith('/afternoon-room.glb')) return response(signal, [1000]);
  } });
  const creating = game.start();
  creating.catch(() => {});
  await game.settle();
  const isCompanion = ({ url }) => url.pathname.includes('/companions/');
  assert.ok(game.requests.some(({ url }) => url.pathname.includes('/tiles/')));
  assert.ok(game.requests.some(({ url }) => url.pathname.endsWith('/afternoon-room.glb') && url.search === '?build=v64'));
  assert.equal(game.requests.some(isCompanion), false);
  await game.tick(1000);
  const api = await creating;
  assert.deepEqual(game.requests.filter(isCompanion).map(({ url }) => url.search), Array(4).fill('?build=v64'));
  api.dispose();
});

test('companion setup failure clears partial resources and a retry mounts a single stage', async () => {
  let first = true;
  const game = await startup({ buildCast: () => {
    if (first) { first = false; throw Error('invalid companion rig'); }
    return { count: 4, cast: ['cat', 'fox', 'panda', 'rabbit'] };
  } });
  await assert.rejects(game.start(), /invalid companion rig/);
  assert.equal(game.children.length, 0);
  assert.equal(game.disposed.filter(name => name === 'model geometry').length, 37);
  assert.ok(game.disposed.includes('environment'));
  assert.ok(game.disposed.includes('renderer'));
  const api = await game.start();
  assert.equal(game.children.length, 2);
  assert.equal(game.listeners.size, 2);
  api.dispose();
  assert.equal(game.children.length, 0);
  assert.equal(game.disposed.filter(name => name === 'model geometry').length, 74);
});

test('a parser that completes after a sibling download fails is disposed without progress updates', async () => {
  let finishParse;
  const parsing = new Promise(resolve => { finishParse = resolve; });
  let startedParses = 0, progress = 0;
  const game = await startup({ awaitParse: () => { startedParses++; return parsing; }, modelFetch: (url, signal, response) => {
    if (url.pathname.endsWith('/afternoon-room.glb')) return response(signal, []);
  } });
  const rejected = assert.rejects(game.start({ onProgress: () => progress++ }), { code: 'MODEL_TIMEOUT' });
  rejected.catch(() => {});
  await game.settle();
  assert.ok(startedParses > 0);
  await game.tick(60000);
  await rejected;
  finishParse();
  await game.settle();
  assert.equal(progress, 0);
  assert.equal(game.disposed.filter(name => name === 'model geometry').length, startedParses);
});

test('a late startup failure unregisters window resources before retry', async () => {
  const game = await startup({ failResize: true });
  await assert.rejects(game.start(), /resize failed/);
  assert.equal(game.children.length, 0);
  assert.equal(game.listeners.size, 0);
  const api = await game.start();
  assert.equal(game.children.length, 2);
  assert.equal(game.listeners.size, 2);
  api.dispose();
  assert.equal(game.listeners.size, 0);
});
