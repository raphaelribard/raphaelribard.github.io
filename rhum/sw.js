/* Offline support for the Route du Rhum tracker.
   - The page itself: network first, last good copy when offline.
   - Feeds and weather (any host): network first, last good copy when offline.
   - Fonts and icons: cache first, refreshed in the background.
   Cache keys ignore the ?cache-busting query so each file is stored once. */
var VER = 'rhum-v1', SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VER; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function key(req) { var u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }

function networkFirst(req) {
  var k = key(req);
  return fetch(req).then(function (res) {
    if (res && res.ok) { var copy = res.clone(); caches.open(VER).then(function (c) { c.put(k, copy); }); }
    return res;
  }).catch(function () {
    return caches.match(k).then(function (hit) { return hit || Promise.reject(new Error('offline')); });
  });
}

function cacheFirst(req) {
  var k = key(req);
  return caches.match(k).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === 'opaque')) { var copy = res.clone(); caches.open(VER).then(function (c) { c.put(k, copy); }); }
      return res;
    });
    return hit || net;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.protocol !== 'https:' && u.hostname !== 'localhost') return;
  var fonts = /(^|\.)(fonts\.googleapis|fonts\.gstatic)\.com$/.test(u.hostname);
  var icon = u.origin === location.origin && /\.(png|webmanifest)$/.test(u.pathname) && !/preview\.png$/.test(u.pathname);
  if (fonts || icon) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req));
});
