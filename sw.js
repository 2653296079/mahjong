/* 转转麻将 · Service Worker：离线可用 + 自动更新
 * 策略：页面走 network-first（保证更新及时），静态资源走 cache-first（保证离线）。 */
var CACHE = 'zmj-v64';
// An older worker can already have cached the new page's 3D requests before activation.
var PREVIOUS_CACHES = ['zmj-v62'];
var ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('zmj-') === 0 && k !== CACHE && PREVIOUS_CACHES.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var base = new URL('./', self.location.href);
  var allowed = ASSETS.some(function (asset) { return new URL(asset, base).pathname === url.pathname; });
  // Optional 3D resources are cached only after they are requested, never on 2D startup.
  var relative = url.pathname.indexOf(base.pathname) === 0 ? url.pathname.slice(base.pathname.length) : '';
  var threeAsset = /^(?:assets\/table3d\/(?:table3d|companions)\.js|assets\/vendor\/three\/(?:three\.module|three\.core\.min|GLTFLoader|BufferGeometryUtils|RoomEnvironment)\.js|assets\/mahjong-3d\/glb\/(?:(?:tiles\/(?:wan|suo|tong)-0[1-9])|mahjong-table|tile-back|dice|glass-dice-cup|dealer-marker|companions\/(?:cat|fox|panda|rabbit)|room\/(?:afternoon-room|machine-console))\.glb|assets\/mahjong-3d\/glb\/companions\/portraits\/(?:cat|fox|panda|rabbit)\.png)$/.test(relative);
  if (url.origin !== base.origin || !allowed && !threeAsset) return;
  var isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0;
  if (isNav) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(function (c) { return c.put('./index.html', copy); }).catch(function () {}));
      }
      return res;
    }).catch(function () { return caches.open(CACHE).then(function (c) { return c.match('./index.html'); }); }));
    return;
  }
  var script = threeAsset && relative.endsWith('.js');
  function canUse(res) {
    return res && res.ok && (!script || /^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)(?:\s*;|$)/i.test(res.headers.get('Content-Type') || ''));
  }
  e.respondWith(caches.open(CACHE).then(function (current) {
    return current.match(req).then(function (hit) {
      if (canUse(hit)) return hit;
      return fallback(current, threeAsset ? 0 : PREVIOUS_CACHES.length);
    });
  }));
  function fallback(current, index) {
    if (index >= PREVIOUS_CACHES.length) return fetch(req).then(function (res) {
      if (canUse(res)) {
        var copy = res.clone();
        e.waitUntil(current.put(req, copy).catch(function () {}));
      }
      return res;
    });
    // Do not strip query strings here: old and updated models share a pathname.
    return caches.match(req, { cacheName: PREVIOUS_CACHES[index] }).then(function (hit) {
      return canUse(hit) ? hit : fallback(current, index + 1);
    });
  }
});
