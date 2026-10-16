/* 转转麻将 · Service Worker：离线可用 + 自动更新
 * 策略：页面走 network-first（保证更新及时），静态资源走 cache-first（保证离线）。 */
var CACHE = 'zmj-v16';
var ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-512.png'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('zmj-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var base = new URL('./', self.location.href);
  var allowed = ASSETS.some(function (asset) { return new URL(asset, base).pathname === url.pathname; });
  if (url.origin !== base.origin || !allowed) return;
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
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) {
        var copy = res.clone();
        e.waitUntil(caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}));
      }
      return res;
    });
  }));
});
