"""
Prefetch CARTO basemap raster tiles (OSM-derived) for Las Vegas Motor Speedway
for offline PWA hosting. Tiles are served only from your origin in production.

  python scripts/fetch_osm_tiles.py

Writes tiles/{z}/{x}/{y}.png and data/tiles-manifest.json.

Two zoom regimes:
  * Low zoom (12, 13): wider context box around LVMS so users can zoom out.
  * Mid zoom (14, 15, 16): tight box covering the festival venue itself.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.request

# LVMS infield (must stay in sync with INFIELD_BOUNDS in js/app.js)
INFIELD_SOUTH = 36.2685
INFIELD_NORTH = 36.2755
INFIELD_WEST = -115.0175
INFIELD_EAST = -115.0050

# Wider context box used for low zoom levels and zoom-out behavior
WIDE_SOUTH = 36.245
WIDE_NORTH = 36.298
WIDE_WEST = -115.045
WIDE_EAST = -114.985

# (zoom, south, west, north, east)
ZOOM_BOXES = [
    (12, WIDE_SOUTH, WIDE_WEST, WIDE_NORTH, WIDE_EAST),
    (13, WIDE_SOUTH, WIDE_WEST, WIDE_NORTH, WIDE_EAST),
    (14, INFIELD_SOUTH - 0.005, INFIELD_WEST - 0.008, INFIELD_NORTH + 0.005, INFIELD_EAST + 0.008),
    (15, INFIELD_SOUTH - 0.002, INFIELD_WEST - 0.003, INFIELD_NORTH + 0.002, INFIELD_EAST + 0.003),
    (16, INFIELD_SOUTH - 0.001, INFIELD_WEST - 0.002, INFIELD_NORTH + 0.001, INFIELD_EAST + 0.002),
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES_DIR = os.path.join(ROOT, "tiles")
MANIFEST = os.path.join(ROOT, "data", "tiles-manifest.json")
UA = "EDC-Vegas-2026-Offline-PWA/1.0 (one-time tile prefetch for bundled offline map)"

# CARTO "dark_all" — OSM-based; data © OpenStreetMap, design © CARTO
CARTO_TEMPLATE = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"


def latlon_to_tile(lat_deg: float, lon_deg: float, zoom: int):
    lat_rad = math.radians(lat_deg)
    n = 2.0**zoom
    x = int((lon_deg + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def bbox_tile_ranges(z: int, south: float, west: float, north: float, east: float):
    corners = ((north, west), (north, east), (south, west), (south, east))
    xs, ys = [], []
    for lat, lon in corners:
        x, y = latlon_to_tile(lat, lon, z)
        xs.append(x)
        ys.append(y)
    return range(min(xs), max(xs) + 1), range(min(ys), max(ys) + 1)


def main() -> None:
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    urls: list[str] = []
    for z, s, w, n, e in ZOOM_BOXES:
        xr, yr = bbox_tile_ranges(z, s, w, n, e)
        for x in xr:
            for y in yr:
                rel = f"tiles/{z}/{x}/{y}.png"
                urls.append(rel)
                path = os.path.join(TILES_DIR, str(z), str(x))
                os.makedirs(path, exist_ok=True)
                fp = os.path.join(path, f"{y}.png")
                if os.path.isfile(fp) and os.path.getsize(fp) > 100:
                    continue
                url = CARTO_TEMPLATE.format(z=z, x=x, y=y)
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                try:
                    with urllib.request.urlopen(req, timeout=30) as resp:
                        data = resp.read()
                    with open(fp, "wb") as out:
                        out.write(data)
                except Exception as ex:
                    print("FAIL", url, ex)
                    raise
                time.sleep(0.15)
                print("ok", z, x, y, len(data))
    urls = sorted(set(urls))
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(urls, f, indent=0)
    print("Wrote", len(urls), "tile paths to", MANIFEST)


if __name__ == "__main__":
    main()
