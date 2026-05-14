# EDC Vegas 2026 Offline PWA

A static **Progressive Web App** for EDC Las Vegas 2026 at Las Vegas Motor Speedway. It is built to work **offline** after the first successful load: **bundled LVMS raster tiles** (from OpenStreetMap-derived cartography via **CARTO Positron**), saved meetup pins, hundreds of venue points (stages, restrooms, rides, services), and **live compass-style navigation** toward any pin or venue point using GPS and device orientation (no mobile data required for those sensors). A **site-wide light/dark** theme toggles the whole UI while the map basemap stays in a **light CARTO / OSM** style for readability.

---

## Recent updates

Summary of notable changes (theme, map, venue overlays, meetups, schedule, PWA shell).

- **PWA footer** — When the app runs as an **installed** PWA (standalone / fullscreen / minimal-ui display mode, or iOS home-screen `navigator.standalone`), the **Install App** link and its trailing separator are **hidden**. Still shown in the browser before install.
- **Schedule: Saved only** — With **Saved only** checked, the **All sets** section is **hidden**; filters still apply to **My itinerary** and to the saved-only browse list.
- **Stage fills** — `STAGE_UV_ZONES` polygons were **expanded along shared seams** so translucent fills cover inner gaps on the festival map art without changing overall stage placement.
- **Public schedule CSV** — `assets/EDC Las Vegas 2026 Schedule & Planning - Public.csv` is kept in sync with **Insomniac** published set times; it is **precached** in `sw.js` (bump **`CACHE`** when it changes).
- **Online basemap** — World layer uses **CARTO** `light_all` (not `tile.openstreetmap.org`). Local LVMS tiles are built with the same template in `scripts/fetch_osm_tiles.py`.
- **Artwork rotation** — `ARTWORK_ROTATION_DEG` is **45°** in `js/app.js` for POI and stage-ring alignment.
- **Site-wide light and dark mode** — The header **sliding toggle** switches the **entire app** (bottom sheet, tabs, modals, navigation overlay, FABs, inputs, toasts, and map chrome), not just the map canvas. Preference is stored as **`localStorage` key `edc2026_site_theme`** (`"dark"` or `"light"`). A legacy key **`edc2026_online_map_dark`** is read once and migrated into the new key when present. `meta name="theme-color"` tracks the active theme. `applySiteTheme()` runs early during map initialization so the UI matches the saved choice as soon as possible.
- **Map basemap stays light** — When **online**, the world basemap uses **CARTO light_all** (independent of the site theme). Bundled **LVMS** tiles use the same style, remain the infield **underlay** when online, and are the sole basemap when **offline**.
- **Stage and district overlays** — Filled regions are **polygons in festival-map `(u, v)` space** (`STAGE_UV_ZONES` in `js/app.js`). Labels use polygon **centroids** and the same **`ARTWORK_ROTATION_DEG` → `INFIELD_BOUNDS`** pipeline as POIs. See `festival-pois.json` `_notes` for POI vs ring data.
- **Stage and area labels** — Softer translucent pills (`.edc-stage-label`) for readability on light tiles.
- **Main map (online vs offline)** — When **offline**, the map **locks to offline bounds** and snaps back toward the festival; the floating **EDC** button returns the view to the infield. When **online**, you can still pan the wider world; LVMS stays covered by local tiles underneath the active online layer.
- **Navigate mini-map** — Uses the same **online vs offline** tile rules as the main map while the navigation overlay is open.
- **Compass and heading** — **iOS**: `webkitCompassHeading` and motion permission where required. **Android**: listens to **`deviceorientationabsolute`** as well as `deviceorientation`, and converts **`alpha`** to a clockwise bearing (`360 - alpha`). The compass **ring** keeps **N aligned to true north** when a live heading exists; the UI explains missing **location** or **motion** permissions when needed.
- **Navigation distance** — Shown in **feet** under one mile, otherwise **miles**.
- **Meetups** — **Delete** asks for confirmation in a modal. **Replace all** opens a **second confirmation** before wiping existing pins. **Import / Merge** skips pins that duplicate an existing meetup by **same name + same coordinates** (normalized name, lat/lng rounded to six decimals); **Replace** dedupes the imported list the same way. **Share** generates compact links with fragment **`#m=…`**; legacy **`#share=…`** hashes are still accepted on import.
- **Schedule tab** — Search + day/stage/genre filters; **Saved only** filters itinerary + list; **Share / Import** for saved set ids (`#sch=…`); conflict line **“N conflict(s) detected and highlighted”**; sticky headers for **My itinerary** and **All sets**; compact Share/Import in the itinerary header.
- **UI polish** — Footer **Cache Version** parses the numeric build from `sw.js`. Sheet splitter **cannot shrink** the meetups panel past the point where the **footer would overlap** list content. Map popup **close control** does not overlap titles on small screens. Document **title** and header subtitle show **· Online** or **· Offline** from `navigator.onLine`.
- **Icons** — PWA icons are generated by `scripts/gen-icons.ps1` (run after changing the script).

Whenever you ship changes to the shell, styles, scripts, POI JSON, artwork, the public schedule CSV, or precached assets, **bump the `CACHE` string in `sw.js`** so installed clients replace their precache on the next online visit (see the constant at the top of `sw.js` for the current value).

For AI-oriented notes see **`cursor.md`**; for Claude Code conventions see **`CLAUDE.md`**.

---

## How this project is made

| Layer | What it is |
|--------|----------------|
| **Shell** | Single-page app: `index.html`, `css/app.css`, `js/app.js` (no React/Vue; plain JavaScript for small size and simple offline behavior). |
| **Map** | [Leaflet](https://leafletjs.com/) 1.9 is **vendored** under `vendor/leaflet/` so the app does not depend on a CDN at runtime. |
| **Basemap** | Bundled **CARTO Positron (`light_all`)** tiles under `tiles/{z}/{x}/{y}.png`, listed in `data/tiles-manifest.json` using **relative** paths. Generated by `scripts/fetch_osm_tiles.py`. Tiles load only from your origin for the LVMS stack. When **online**, the app shows **CARTO light_all** as the world layer above the local LVMS underlay (data © OpenStreetMap contributors; style © CARTO). |
| **Venue points** | `data/festival-pois.json` lists each point with normalized coordinates `(u, v)` taken from the official 2026 festival map (`assets/edc_map.jpg`). `js/app.js` applies an artwork-rotation transform (`ARTWORK_ROTATION_DEG`, currently **45°**) before projecting onto `INFIELD_BOUNDS`. Translucent **stage and district fills** are polygon rings in **`STAGE_UV_ZONES`** inside `js/app.js` (same `(u, v)` frame as the POIs). There is **no festival JPG overlay**; the user sees the basemap (when online) or bundled tiles with pins and fills on top. |
| **Meetup pins** | Stored in the browser with **`localStorage`** (`edc2026_pins_v1`). Pins can be dragged on the map and **shared** via URL hash: prefer **`#m=…`** (compact); older **`#share=…`** links still import. |
| **Offline cache** | `sw.js` precaches the shell, `install.html`, map JPG, and tile list; URLs are resolved from `registration.scope` so the same files work at the site root or under a subpath. The precache version is the **`CACHE`** constant in `sw.js`. |

---

## Features

- **Offline-first** — After one online visit (so the service worker can install and precache), bundled tiles, UI, POI data, and meetups work without a network connection.
- **Light and dark theme** — Header **switch** applies to the **whole app** and is saved in **`localStorage`** (`edc2026_site_theme`). The map basemap stays **light** (CARTO + local LVMS tiles) in both UI themes so map readability remains consistent.
- **Live GPS** — Your position updates from `navigator.geolocation` (works without cellular data when the OS has a GPS lock).
- **Basemap and speedway** — Pan and zoom on real cartography when online (**CARTO Positron**); **stage and district shading** (light translucent polygons in festival-map space, plus area labels) sits under POIs; venue pins use the same artwork projection as those fills.
- **Meetups tab** — **Press and hold** the map (~1 second) to drop a meetup pin (name it in the dialog), or use **Pin at center** for the map center. Pins can be dragged to adjust. Tapping a saved pin on the map opens a popup with **Navigate** to the compass (the list **Navigate** button still opens the compass directly). **Share pins** copies a link (usually `#m=…`; legacy `#share=…` still works for import). **Import** from a friend’s link; **Replace all** asks for confirmation before clearing existing pins. **Center on me** (also on the floating **⌖** button). **Delete** uses a confirmation modal.
- **Venue map tab** — Search and filter preset points (stages, art, rides, services, and more). Tapping a map dot or a list row flies to the pin and opens a small popup with **Navigate** to the compass overlay; list **Navigate** still jumps straight to the compass if you prefer.
- **Navigate overlay** — Distance (ft/mi), bearing, **north-aligned compass ring** when a live heading exists (magnetometer / gyro + **deviceorientationabsolute** on Android, or GPS course while moving), and a **direction arrow** toward the target. Permission hints when location or motion is blocked.
- **Installable PWA** — `manifest.webmanifest` + icons; footer **Install App** triggers the browser install flow when available, or opens **`install.html`** with add-to-home-screen steps (the link is **hidden** when the app is already running as an installed PWA).

---

## How to use it

1. **Open the site once online** over **HTTPS** (or `http://localhost:8765` during development).
2. Wait until the header shows **offline-ready** (service worker installed and cache filled).
3. **Meetups** — **Press and hold** the map (~1 s) where you want to meet and name the pin (or use **Pin at center**). Tap a pin on the map for a popup, then **Navigate**; or use **Navigate** in the list to open the compass in one step. **Share pins** copies a link (typically `#m=…`); recipients use **Import** and choose Merge or Replace (Replace asks for confirmation before clearing existing pins).
4. **Venue map** — Search or pick a category. Tap a **colored dot** on the map or a list row (not the row’s **Navigate** button) to fly there and open a popup, then **Navigate** for the compass. Row **Navigate** opens the compass in one step.
5. **Optional: install the PWA** (see **Installing the PWA** below, or the in-app **Install App** link) for a full-screen icon on your home screen and quicker launch.

**Note:** First-time visitors who have never loaded the app while online will not have the precache; they need at least one successful online load (a friend’s device that already cached it is not enough for a new device).

---

## Refreshing map tiles

If you change the map bounding box in `scripts/fetch_osm_tiles.py` (keep it in sync with `js/app.js`), regenerate tiles and the manifest:

```bash
python scripts/fetch_osm_tiles.py
```

Commit the updated `tiles/` PNGs and `data/tiles-manifest.json`, then bump the `CACHE` string in `sw.js` so clients fetch the new precache.

---

## Local development

From the project folder:

```bash
python -m http.server 8765
```

Open `http://localhost:8765/` (or `http://localhost:8765/index.html`). Service workers require **localhost** or **HTTPS**; opening `file://` directly will not register the worker.

---

## Installing the PWA

Instructions vary slightly by browser and OS version; the goal is always to use the browser’s **“Add to Home Screen”** or **“Install app”** action while viewing the app URL. In the app footer, **Install App** runs the native install prompt when the browser supports it, or opens **`install.html`** with short Android and iOS steps (footer link is omitted when you opened the app from an installed icon).

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

iOS installs PWAs **only through Safari** for this flow. The app opens from the home screen icon; enable **location** and (for the arrow) **motion/orientation** when the app prompts or when you turn on **Compass** in the navigation view.

### Tips for both platforms

- Use the **installed** home screen icon, not only a bookmark inside the browser, if you want the standalone app experience.
- Grant **location** (and orientation when asked) for GPS and compass navigation.
- Open the app **once while online** after each major deploy so a new service worker and cache version (`sw.js`) can update.

---

## Project layout (short)

```
index.html              App shell
cursor.md               Cursor / AI repo notes (changelog-style)
CLAUDE.md               Claude Code conventions
install.html            Install / add-to-home-screen help (precached)
manifest.webmanifest    PWA metadata
sw.js                   Service worker + precache (shell + tiles + manifest)
css/app.css             Styles (map inset, sheet, floating actions)
js/app.js               Map, tiles, pins, POIs, navigation, share/import
data/festival-pois.json Venue points (u, v + category) sourced from assets/edc_map.jpg
data/tiles-manifest.json URLs for bundled CARTO / OSM-derived LVMS tiles
tiles/{z}/{x}/{y}.png   Raster tiles (LVMS bbox, CARTO Positron light_all)
assets/edc_map.jpg      Official EDC 2026 festival map (cached for reference)
scripts/fetch_osm_tiles.py  Regenerate tiles + manifest
scripts/gen-icons.ps1   Regenerate PWA icons (System.Drawing on Windows)
vendor/leaflet/         Leaflet library (offline)
icons/                  PWA icons
```

---

## Map accuracy disclaimer

GPS alignment and POI positions are **approximate**. Venue `(u, v)` values were derived from the official 2026 festival artwork (`assets/edc_map.jpg`), not survey-grade coordinates.

Two knobs in `js/app.js` control how the artwork is mapped to the real world:

- `INFIELD_BOUNDS` — the LVMS infield rectangle in `(lat, lng)`.
- `ARTWORK_ROTATION_DEG` — how many degrees the festival artwork is rotated **counter-clockwise** from north-up. The current value **`45`** is calibrated against the reference interactive map. Allowed values include `0`, `90`, `180`, or `270`; other angles are supported by the transform in code.

If a future map artwork uses a different orientation, **adjust this constant** — every POI moves with it. Adjust `INFIELD_BOUNDS` (and individual POIs) after a field check if you need tighter accuracy. Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors; © [CARTO](https://carto.com/attributions) (online style).

**Other official PDFs (parking, Camp EDC, and so on)** use their own crops and north arrows. They are useful for **qualitative** checks (for example, which side of the complex a gate sits on) but **gate and “Info · …” POIs in this app are placed on the festival map**, not transcribed from the parking map’s numbered info stars. Tight **GPS** alignment still comes from tuning `INFIELD_BOUNDS` (and optionally individual `(u, v)` values) after walking the venue or comparing to satellite imagery.
