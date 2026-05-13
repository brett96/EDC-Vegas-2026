"""
Prefetch CARTO basemap raster tiles (OSM-derived) for Las Vegas Motor Speedway
for offline PWA hosting. Tiles are served only from your origin — browsers never
hit public tile CDNs in production.

  python scripts/fetch_osm_tiles.py

Writes tiles/{z}/{x}/{y}.png and data/tiles-manifest.json
See CARTO / OSM attribution in app map footer.
"""
from __future__ import annotations

import json
import math
import os
import time
import urllib.request

# Match js/app.js MAP_CENTER, MAP_NS_METERS, MAP_IMG_ASPECT
MAP_CENTER_LAT = 36.27225
MAP_CENTER_LNG = -115.01145
MAP_NS_METERS = 1220
MAP_IMG_ASPECT = 1080 / 1350
R = 111320.0

d_lat = MAP_NS_METERS / R
cos_lat = math.cos(math.radians(MAP_CENTER_LAT))
d_lng = (MAP_NS_METERS * MAP_IMG_ASPECT) / (R * cos_lat)

SOUTH = MAP_CENTER_LAT - d_lat / 2
NORTH = MAP_CENTER_LAT + d_lat / 2
WEST = MAP_CENTER_LNG - d_lng / 2
EAST = MAP_CENTER_LNG + d_lng / 2

PAD = 0.00035
SOUTH -= PAD
WEST -= PAD
NORTH += PAD
EAST += PAD

ZOOMS = (14, 15, 16)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TILES_DIR = os.path.join(ROOT, "tiles")
MANIFEST = os.path.join(ROOT, "data", "tiles-manifest.json")
UA = "EDC-Vegas-2026-Offline-PWA/1.0 (one-time tile prefetch for bundled offline map)"

# CARTO "dark_all" — suitable for night UI; data © OpenStreetMap contributors, design © CARTO
CARTO_TEMPLATE = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"


def latlon_to_tile(lat_deg: float, lon_deg: float, zoom: int) -> tuple[int, int]:
    lat_rad = math.radians(lat_deg)
    n = 2.0**zoom
    x = int((lon_deg + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return x, y


def bbox_tile_ranges(z: int):
    corners = ((NORTH, WEST), (NORTH, EAST), (SOUTH, WEST), (SOUTH, EAST))
    xs, ys = [], []
    for lat, lon in corners:
        x, y = latlon_to_tile(lat, lon, z)
        xs.append(x)
        ys.append(y)
    return range(min(xs), max(xs) + 1), range(min(ys), max(ys) + 1)


def main() -> None:
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    urls: list[str] = []
    for z in ZOOMS:
        xr, yr = bbox_tile_ranges(z)
        for x in xr:
            for y in yr:
                rel = f"/tiles/{z}/{x}/{y}.png"
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
                except Exception as e:
                    print("FAIL", url, e)
                    raise
                time.sleep(0.15)
                print("ok", z, x, y, len(data))
    urls.sort()
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(urls, f, indent=0)
    print("Wrote", len(urls), "tile paths to", MANIFEST)


if __name__ == "__main__":
    main()
