# EDC Vegas 2026 Offline PWA

A static **Progressive Web App** for EDC Las Vegas 2026 at Las Vegas Motor Speedway. It is built to work **offline** after the first successful load: festival map, saved meetup pins, hundreds of venue points (stages, restrooms, rides, services), and **live compass-style navigation** toward any pin or venue point using GPS and device orientation (no mobile data required for those sensors).

---

## How this project is made

| Layer | What it is |
|--------|----------------|
| **Shell** | Single-page app: `index.html`, `css/app.css`, `js/app.js` (no React/Vue; plain JavaScript for small size and simple offline behavior). |
| **Map** | [Leaflet](https://leafletjs.com/) 1.9 is **vendored** under `vendor/leaflet/` so the app does not depend on a CDN at runtime. |
| **Festival map** | The official festival map image is stored locally as `assets/edclv_2026_festival_map.jpg` and shown with `L.imageOverlay()` on a fixed **WGS84** rectangle over the LVMS infield (`MAP_CENTER`, `MAP_NS_METERS` in `js/app.js`). |
| **Venue points** | `data/festival-pois.json` lists each point with normalized coordinates `(u, v)` on the map image (0–1). The app converts those to latitude/longitude using the same bounds as the image overlay. |
| **Meetup pins** | Stored in the browser with **`localStorage`** (`edc2026_pins_v1`). Pins can be dragged on the map and **shared** via a URL hash (`#share=…`) so friends can import them. |
| **Offline cache** | `sw.js` registers a **service worker** that precaches the asset list (HTML, CSS, JS, map JPG, POI JSON, Leaflet, icons). The cache name is bumped when those assets change (currently `edc-vegas-2026-v3`). |
| **Hosting** | `vercel.json` sets sensible **Cache-Control** headers for `sw.js` and the web manifest so updates deploy cleanly on [Vercel](https://vercel.com/). Deploy as a **static** project (no build step): project root contains `index.html`. |

---

## Features

- **Offline-first** — After one online visit (so the service worker can install and precache), core UI, map image, and venue data work without a network connection.
- **Live GPS** — Your position updates from `navigator.geolocation` (works without cellular data when the OS has a GPS lock).
- **Official-style festival map** — Full-resolution map graphic aligned to approximate LVMS coordinates (fine-tune `MAP_CENTER` / `MAP_NS_METERS` and POI `u`/`v` if you calibrate on-site).
- **Meetups tab** — Drop pins at GPS or map center, rename them, drag to adjust, **Share pins** (copy link), **Import** from a friend’s link, **Center on me**.
- **Venue map tab** — Search and filter **~150** preset points: stages, art, rides, restrooms (GA, GA+, ADA, VIP), first aid, lockers, info, VIP areas, Ground Control, stores, food & drink, water, lost & found, charging, Wi‑Fi, and more. Tap a map dot or list row to open navigation.
- **Navigate overlay** — Distance, bearing, and a **rotating arrow** toward the target. Uses the magnetometer when you tap **Enable compass** (iOS requires permission); otherwise course from GPS speed or movement between fixes.
- **Installable PWA** — `manifest.webmanifest` + icons for “Add to Home Screen” / “Install app”.

---

## How to use it

1. **Open the site once online** (HTTPS), for example your Vercel URL or `http://localhost:8765` during development.
2. Wait until the header shows **offline-ready** (service worker installed and cache filled).
3. **Meetups** — Use **Drop pin here** (uses GPS when available, otherwise map center), name the pin, then **Navigate** from the list. **Share pins** copies a link; recipients use **Import** and choose Merge or Replace.
4. **Venue map** — Search or pick a category, tap **Navigate** on a row or tap a **colored dot** on the map. Use **Enable compass** for the arrow to follow how you turn; otherwise walk a short distance so GPS can infer direction.
5. **Optional: install the PWA** (below) for a full-screen icon on your home screen and quicker launch.

**Note:** First-time visitors who have never loaded the app while online will not have the precache; they need at least one successful online load (or a friend’s device that already cached it is not enough for a new device).

---

## Local development

From the project folder:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/` (or `http://localhost:8765/index.html`). Service workers require **localhost** or **HTTPS**; opening `file://` directly will not register the worker.

---

## Deploying on Vercel

1. Connect this repository (or upload the folder) to Vercel.
2. **Framework preset:** Other / static, or leave default.
3. **Root directory:** repository root (where `index.html` and `vercel.json` live).
4. **Build command:** leave empty.
5. **Output:** default (static files from root).

Production URL must use **HTTPS** so the PWA and service worker behave correctly.

---

## Installing the PWA

Instructions vary slightly by browser and OS version; the goal is always to use the browser’s **“Add to Home Screen”** or **“Install app”** action while viewing your deployed URL.

### Android (Chrome)

1. Open the site in **Google Chrome**.
2. Tap the **⋮** menu (three dots).
3. Tap **Add to Home screen** or **Install app** (wording depends on Chrome version).
4. Confirm the name and tap **Add** / **Install**.

You should get a home screen icon that opens the app in **standalone** mode (minimal browser UI). After the first install, keep using that icon so the same origin and cache are used.

### iOS (Safari)

1. Open the site in **Safari** (not Chrome’s in-app browser if you want the most reliable install flow).
2. Tap the **Share** button (square with arrow up).
3. Scroll and tap **Add to Home Screen**.
4. Edit the label if you like, then tap **Add**.

iOS installs PWAs **only through Safari** for this flow. The app opens from the home screen icon; enable **location** and (for the arrow) **motion/orientation** when the app prompts or when you tap **Enable compass**.

### Tips for both platforms

- Use the **installed** home screen icon, not only a bookmark inside the browser, if you want the standalone app experience.
- Grant **location** (and orientation when asked) for GPS and compass navigation.
- Open the app **once while online** after each major deploy so a new service worker and cache version (`sw.js`) can update.

---

## Project layout (short)

```
index.html              App shell
manifest.webmanifest    PWA metadata
sw.js                   Service worker + precache list
vercel.json             Hosting headers
css/app.css             Styles
js/app.js               Map, pins, POIs, navigation, share/import
data/festival-pois.json Venue points (u, v + category)
assets/edclv_2026_festival_map.jpg  Festival map image
vendor/leaflet/         Leaflet library (offline)
icons/                  PWA icons
```

---

## Map accuracy disclaimer

GPS overlay and POI positions are **approximate**. The festival map is georeferenced to a simple rectangle over LVMS; you can refine `MAP_CENTER`, `MAP_NS_METERS`, and individual `u` / `v` values in `data/festival-pois.json` after field checks. Festival map artwork is © Insomniac / EDC Las Vegas; use only in line with their terms for your deployment.
