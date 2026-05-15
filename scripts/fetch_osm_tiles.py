"""
Prefetch raster tiles for Las Vegas Motor Speedway for offline PWA hosting.

  python scripts/fetch_osm_tiles.py

Writes tiles/{z}/{x}/{y}.png and data/tiles-manifest.json.

Tiles are fetched from **CARTO Positron** (OSM-derived, CDN-friendly). Do not use
tile.openstreetmap.org here — that endpoint often returns small “Access blocked”
PNGs that would be bundled as offline tiles and shown in the app.

Two zoom regimes:
  * Low zoom (12, 13): wider context box around LVMS so users can zoom out.
  * Mid zoom (14, 15, 16): tight box covering the festival venue itself.

Re-download everything: EDC_FORCE_TILE_REFRESH=1
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

# LVMS infield (must stay in sync with INFIELD_BOUNDS in js/app.js)
INFIELD_SOUTH = 36.26894
INFIELD_NORTH = 36.27546
INFIELD_WEST = -115.01691
INFIELD_EAST = -115.00496

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
UA = "EDC-Vegas-2026-Offline-PWA/1.0 (one-time tile prefetch; CARTO Positron basemap)"

# Gentle global pacing so we do not hammer the CDN even with parallel workers.
_rate_lock = threading.Lock()
_next_ok_at = 0.0


def _pace():
    global _next_ok_at
    with _rate_lock:
        now = time.monotonic()
        wait = _next_ok_at - now
        if wait > 0:
            time.sleep(wait)
        _next_ok_at = time.monotonic() + 0.04


# CARTO Positron — same family as the in-app online layer; avoids OSM tile blocks.
def tile_fetch_url(z: int, x: int, y: int) -> str:
    host = "abcd"[(x + y + z) % 4]
    return f"https://{host}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"


def tile_file_usable(fp: str) -> bool:
    """Reject missing files, non-PNG, tiny tiles, or OSM 'Access blocked' bodies."""
    try:
        if not os.path.isfile(fp):
            return False
        sz = os.path.getsize(fp)
        if sz < 500:
            return False
        with open(fp, "rb") as f:
            head = f.read(4096)
    except OSError:
        return False
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return False
    low = head.lower()
    if b"access blocked" in low or b"tile usage policy" in low:
        return False
    return True


FORCE_REDOWNLOAD = os.environ.get("EDC_FORCE_TILE_REFRESH") == "1"


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


def download_one_tile(task: tuple[int, int, int, str, str]) -> tuple[str, int, bool]:
    """Download a single tile; returns (rel_path, byte_len, skipped_existing)."""
    z, x, y, rel, fp = task
    if not FORCE_REDOWNLOAD and tile_file_usable(fp):
        return rel, 0, True
    _pace()
    url = tile_fetch_url(z, x, y)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
    low = data[:8192].lower()
    if len(data) < 100 or b"access blocked" in low or b"tile usage policy" in low:
        raise RuntimeError(f"bad tile body ({len(data)} bytes)")
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "wb") as out:
        out.write(data)
    return rel, len(data), False


def main() -> None:
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    urls: list[str] = []
    tasks: list[tuple[int, int, int, str, str]] = []
    for z, s, w, n, e in ZOOM_BOXES:
        xr, yr = bbox_tile_ranges(z, s, w, n, e)
        for x in xr:
            for y in yr:
                rel = f"tiles/{z}/{x}/{y}.png"
                urls.append(rel)
                path = os.path.join(TILES_DIR, str(z), str(x))
                os.makedirs(path, exist_ok=True)
                fp = os.path.join(path, f"{y}.png")
                tasks.append((z, x, y, rel, fp))

    max_workers = min(8, max(2, (os.cpu_count() or 4)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(download_one_tile, t): t for t in tasks}
        for fut in as_completed(futures):
            t = futures[fut]
            z, x, y, rel, _ = t
            try:
                _rrel, nbytes, skipped = fut.result()
                if skipped:
                    print("skip", z, x, y)
                else:
                    print("ok", z, x, y, nbytes)
            except Exception as exc:
                print("FAIL", tile_fetch_url(z, x, y), exc)
                raise

    urls = sorted(set(urls))
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(urls, f, indent=0)
    print("Wrote", len(urls), "tile paths to", MANIFEST)


if __name__ == "__main__":
    main()
