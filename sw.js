/* Offline shell — precache resolves from this script's URL (root or /edc/ etc.) */
const CACHE = "edc-vegas-2026-v32";

function scopeBase() {
  const s = self.registration && self.registration.scope ? self.registration.scope : self.location.href;
  return s.endsWith("/") ? s : s + "/";
}

function scopedUrl(rel) {
  const path = String(rel || "").replace(/^\//, "");
  return new URL(path, scopeBase()).href;
}

const CORE_ASSETS_REL = [
  "index.html",
  "install.html",
  "manifest.webmanifest",
  "css/app.css",
  "js/app.js",
  "data/festival-pois.json",
  "data/tiles-manifest.json",
  "assets/edc_map.jpg",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

function cacheTileUrls(cache, urls) {
  return urls.reduce(
    (chain, path) =>
      chain.then(() =>
        cache.add(scopedUrl(path)).catch((err) => {
          console.warn("[sw] tile precache", path, err);
        })
      ),
    Promise.resolve()
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(CORE_ASSETS_REL.map((p) => scopedUrl(p))).then(() => cache.add(scopeBase()).catch(() => undefined))
      )
      .then(() =>
        fetch(scopedUrl("data/tiles-manifest.json"))
          .then((r) => r.json())
          .then((urls) => {
            if (!Array.isArray(urls)) return undefined;
            return caches.open(CACHE).then((cache) => cacheTileUrls(cache, urls));
          })
      )
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
            return caches.match(scopedUrl("index.html"));
          }
          return Promise.reject(new Error("offline"));
        });
    })
  );
});
