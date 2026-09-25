/*
 * Service Worker der Wishly-App:
 * - Seite und Icons werden zwischengespeichert -> App startet schnell und auch ohne Netz
 * - die Seite kommt immer zuerst frisch vom Server (neue Versionen sofort da)
 * - Preise (/proxy), Konten (/api) und Diagnose werden NIE zwischengespeichert
 */
const CACHE = 'wishly-v2';
const SHELL = ['./', 'favicon.svg', 'favicon-32.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|proxy|debug)\b/.test(url.pathname)) return;

  // Seite: zuerst Netz, bei keinem Netz die gespeicherte Version
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }

  // Icons & Co.: aus dem Zwischenspeicher, im Hintergrund auffrischen
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
