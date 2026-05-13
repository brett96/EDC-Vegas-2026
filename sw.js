/* Offline shell for EDC Vegas 2026 PWA — precache all static assets */
const CACHE = "edc-vegas-2026-v3";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/css/app.css",
  "/js/app.js",
  "/data/festival-pois.json",
  "/assets/edclv_2026_festival_map.jpg",
  "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/leaflet.css",
  "/vendor/leaflet/images/marker-icon.png",
  "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error("[sw] precache failed", err);
      })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((k) => {
            if (k !== CACHE) return caches.delete(k);
            return undefined;
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          try {
            const u = new URL(req.url);
            if (res.ok && u.origin === self.location.origin) {
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
          } catch {
            /* ignore */
          }
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") {
            return caches.match("/index.html");
          }
          return Promise.reject(new Error("offline"));
        });
    })
  );
});
