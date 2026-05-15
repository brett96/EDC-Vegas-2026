/* Offline shell — precache resolves from this script's URL (root or /edc/ etc.) */
const CACHE = "edc-vegas-2026-v76";

/** Set during install if tile precache had failures; flushed to clients after activate + claim. */
let pendingTilePrecacheFailure = null;

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
  "assets/EDC Las Vegas 2026 Schedule & Planning - Public.csv",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

/**
 * Precache map tiles with bounded retries. Returns { failed, total }.
 * Failures are reported to open clients so the UI can warn (offline map may be incomplete).
 */
async function cacheOneTileWithRetries(cache, path) {
  const href = scopedUrl(path);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await cache.add(href);
      return true;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
    }
  }
  console.warn("[sw] tile precache failed after retries", path, lastErr);
  return false;
}

function cacheTileUrls(cache, urls) {
  const list = Array.isArray(urls) ? urls : [];
  const BATCH = 6;
  return (async () => {
    let failed = 0;
    for (let i = 0; i < list.length; i += BATCH) {
      const slice = list.slice(i, i + BATCH);
      const results = await Promise.all(slice.map((path) => cacheOneTileWithRetries(cache, path)));
      results.forEach((ok) => {
        if (!ok) failed++;
      });
    }
    return { failed, total: list.length };
  })();
}

function notifyClientsTilePrecacheStats(failed, total) {
  if (!failed) return Promise.resolve();
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => {
      try {
        c.postMessage({ type: "edc-precache-tiles", failed, total });
      } catch (_) {}
    });
  });
}

self.addEventListener("install", (event) => {
  pendingTilePrecacheFailure = null;
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
            if (!Array.isArray(urls)) return { failed: 0, total: 0 };
            return caches.open(CACHE).then((cache) => cacheTileUrls(cache, urls));
          })
      )
      .then((tileStats) => {
        const failed = tileStats && Number(tileStats.failed);
        if (failed && failed > 0) {
          pendingTilePrecacheFailure = {
            failed,
            total: Number.isFinite(Number(tileStats.total)) ? Number(tileStats.total) : 0,
          };
        } else pendingTilePrecacheFailure = null;
      })
      .then(() => self.skipWaiting())
      .catch((err) => {
        console.error("[sw] precache failed", err);
      })
  );
});

function notifyClientsCacheVersion() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => {
      try {
        c.postMessage({ type: "edc-cache-version", version: CACHE });
      } catch (_) {}
    });
  });
}

function flushPendingTilePrecacheFailure() {
  const p = pendingTilePrecacheFailure;
  pendingTilePrecacheFailure = null;
  if (!p || !p.failed) return Promise.resolve();
  return notifyClientsTilePrecacheStats(p.failed, p.total);
}

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
      .then(() => notifyClientsCacheVersion())
      .then(() => flushPendingTilePrecacheFailure())
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
