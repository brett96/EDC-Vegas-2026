(function () {
  "use strict";

  const STORAGE_KEY = "edc2026_pins_v1";
  /** Short hash fragment for new share links (`#m=…`). */
  const SHARE_PREFIX = "m=";
  /** Legacy fragment still accepted on import (`#share=…`). */
  const LEGACY_SHARE_PREFIX = "share=";
  /** Compact schedule share links (`#sch=…`) — saved set ids only, gzip+base64url like meetups. */
  const SCHEDULE_SHARE_PREFIX = "sch=";
  const SPLIT_PX_KEY = "edc2026_split_px";
  /** "dark" | "light" — site-wide UI only. Map basemap stays light in both modes. */
  const SITE_THEME_KEY = "edc2026_site_theme";
  /** Legacy key from map-only toggle; migrated once into SITE_THEME_KEY. */
  const MAP_ONLINE_DARK_KEY = "edc2026_online_map_dark";
  /** Selected artist/set ids for the Schedule tab. */
  const SCHEDULE_STORAGE_KEY = "edc2026_schedule_sets_v1";
  const DEFAULT_SET_MINUTES = 60;
  const WALK_METERS_PER_MINUTE = 62; // ~2.3 mph in dense festival crowds
  const WALK_BUFFER_MINUTES = 5;
  const MIN_TRANSITION_MINUTES = 2;
  /** Next set starts at least this long after current set start → Leave By can relax to start + 1h (flexible). */
  const DECENT_GAP_BETWEEN_STARTS_MS = 90 * 60000;
  const FLEXIBLE_LEAVE_AFTER_START_MS = 60 * 60000;

  /** Directory URL of the app (works at site root or under a path like /edc/). */
  function getAssetBaseUrl() {
    const el = document.querySelector('script[src*="app.js"]');
    if (!el || !el.src) return new URL("./", window.location.href).href;
    return new URL("../", el.src).href;
  }
  const ASSET_BASE_URL = getAssetBaseUrl();

  function asset(relPath) {
    const p = String(relPath || "").replace(/^\//, "");
    return new URL(p, ASSET_BASE_URL).href;
  }

  const POI_DATA_URL = asset("data/festival-pois.json");
  const SCHEDULE_DATA_URL = asset("assets/EDC Las Vegas 2026 Schedule & Planning - Public.csv");
  /**
   * Bundled LVMS raster tiles (precached; used offline and as underlay when online).
   * Leaflet needs literal `{z}/{x}/{y}` — `new URL()` encodes `{` and breaks tiles.
   */
  const BASEMAP_TILE_URL = ASSET_BASE_URL.replace(/\/?$/, "/") + "tiles/{z}/{x}/{y}.png";
  /**
   * Light world basemap when online: CARTO Positron (OSM data).
   * Avoids tile.openstreetmap.org — that endpoint often returns “Access blocked”
   * for in-browser Leaflet traffic; CARTO CDN is intended for web map clients.
   */
  const ONLINE_WORLD_TILE_URL = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png";
  const ONLINE_WORLD_TILE_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> contributors ' +
    '&copy; <a href="https://carto.com/attributions" rel="noreferrer">CARTO</a> · online';

  /**
   * LVMS infield rectangle (landscape). Used to convert each POI's normalized
   * (u, v) layout coordinate into latitude/longitude over the real venue.
   * Tweak in 5–10 m increments after a field check. POI (u,v) values are traced from
   * assets/edc_map.jpg; they are not derived from Google Maps north-up imagery alone.
   */
  const INFIELD_BOUNDS = L.latLngBounds(
    [36.26858, -115.01782], // SW (micro-tuned to better align infield edges)
    [36.27582, -115.00455]  // NE
  );
  const MAP_BOUNDS = INFIELD_BOUNDS;
  const WIDE_BOUNDS = L.latLngBounds(
    [36.245, -115.045],
    [36.298, -114.985]
  );

  /**
   * Rotation of the official festival artwork file (`assets/edc_map.jpg`)
   * relative to true north on the ground.
   *
   * POIs and `STAGE_UV_ZONES` use **artwork (u, v)** in that JPEG’s pixel frame
   * (origin top-left). The portrait poster is not aligned the same way as the
   * north-up Leaflet basemap; `ARTWORK_ROTATION_DEG` maps UV into ground
   * east–north before `uvToLatLng` projects into `INFIELD_BOUNDS`.
   *
   * Calibrated against `assets/edc_map.jpg` vs a **north-up** basemap (Speedway
   * Blvd, I‑15, Pit Rd): the portrait artwork is ~**45° clockwise** from
   * north-up, so kinetic sits on the **top-right** infield arc, Camp EDC north
   * of the oval (Speedway / I‑15), bassPOD / circuitGROUNDS on the **bottom-left**
   * Pit Rd arc. Any integer multiple of 90° still uses the fast path below;
   * other values use the continuous rotation branch.
   *
   *   0   → top of file = North
   *   90  → top of file = East
   *   180 → top of file = South
   *   270 → top of file = West
   */
  const ARTWORK_ROTATION_DEG = 45;

  const PIN_COLORS = ["#ff2dbe", "#00f5ff", "#39ff14", "#ffd400", "#c86bff", "#ff6b35", "#ffffff"];

  const CATEGORY_LABELS = {
    stage: "Stages",
    art_installation: "Art installations",
    art_car: "Art cars",
    ride: "Rides",
    restroom_ga: "Restrooms (GA)",
    restroom_ga_plus: "Restrooms (GA+)",
    restroom_ada: "ADA / accessible",
    restroom_vip: "VIP restrooms",
    first_aid: "First aid",
    locker: "Lockers",
    info: "Info",
    vip: "VIP",
    ground_control: "Ground Control",
    general_store: "General store",
    food_drink: "Food & drinks",
    water_station: "Water stations",
    lost_found: "Lost & Found",
    photo_op: "Photo ops",
    charging_station: "Charging",
    cash_exchange: "Cash exchange",
    wifi: "Wi-Fi",
    merchandise: "Merchandise",
    kandi_station: "Kandi station",
    trinket_trade: "Trinket trade",
    vip_barber: "VIP barber",
    marquee_skydeck: "Marquee Skydeck",
    vip_concierge: "VIP concierge",
    vip_viewing: "VIP viewing",
    vip_water: "VIP water",
    passport: "Insomniac Passport",
    consciousness_group: "Consciousness Group",
    entrance: "Entrances",
    other: "Other",
  };

  const CATEGORY_COLORS = {
    stage: "#ff2dbe",
    art_installation: "#c86bff",
    art_car: "#ff6bc4",
    ride: "#39ff14",
    restroom_ga: "#6eb5ff",
    restroom_ga_plus: "#9ed0ff",
    restroom_ada: "#4a9eff",
    restroom_vip: "#b894ff",
    first_aid: "#ff4444",
    locker: "#ff9e6b",
    info: "#ffb347",
    vip: "#ffd400",
    ground_control: "#ff69b4",
    general_store: "#c0c0c0",
    food_drink: "#7dff9a",
    water_station: "#00c8ff",
    lost_found: "#ffe566",
    photo_op: "#ff8c42",
    charging_station: "#88aaff",
    cash_exchange: "#66ff99",
    wifi: "#66ffcc",
    merchandise: "#d0d0d0",
    kandi_station: "#ff99dd",
    trinket_trade: "#99ddff",
    vip_barber: "#ff6666",
    marquee_skydeck: "#ddaaff",
    vip_concierge: "#ffd580",
    vip_viewing: "#eeccff",
    vip_water: "#aaa0ff",
    passport: "#ffffff",
    consciousness_group: "#dda0dd",
    entrance: "#00f5ff",
    other: "#9a8ab8",
  };

  const DAY_LABELS = {
    FRIDAY: "Friday",
    SATURDAY: "Saturday",
    SUNDAY: "Sunday",
    TBA: "TBA",
  };

  const els = {
    map: document.getElementById("map"),
    appTitle: document.getElementById("app-title"),
    offlineBadge: document.getElementById("offline-badge"),
    siteThemeToggle: document.getElementById("site-theme-toggle"),
    coordStrip: document.getElementById("coord-strip"),
    pinList: document.getElementById("pin-list"),
    btnCenter: document.getElementById("btn-center"),
    btnPin: document.getElementById("btn-pin"),
    btnShare: document.getElementById("btn-share"),
    btnImport: document.getElementById("btn-import"),
    btnCenterFloat: document.getElementById("btn-center-float"),
    btnEdcFloat: document.getElementById("btn-edc-float"),
    installLink: document.getElementById("install-link"),
    footerCacheVersion: document.getElementById("footer-cache-version"),
    compassToggleNav: document.getElementById("compass-toggle-nav"),
    splitter: document.getElementById("split-splitter"),
    mapStack: document.getElementById("map-stack"),
    sheet: document.getElementById("main-sheet"),
    navOverlay: document.getElementById("nav-overlay"),
    navClose: document.getElementById("nav-close"),
    navMap: document.getElementById("nav-map"),
    navDebugToggle: document.getElementById("nav-debug-toggle"),
    navRefreshLocation: document.getElementById("nav-refresh-location"),
    navTitle: document.getElementById("nav-title"),
    navSub: document.getElementById("nav-sub"),
    navDistance: document.getElementById("nav-distance"),
    navBearing: document.getElementById("nav-bearing"),
    navDebugReadout: document.getElementById("nav-debug-readout"),
    navHint: document.getElementById("nav-hint"),
    navCompassLive: document.getElementById("nav-compass-live"),
    navCompassFallback: document.getElementById("nav-compass-fallback"),
    navCompassFallbackText: document.getElementById("nav-compass-fallback-text"),
    navCompassRing: document.getElementById("nav-compass-ring"),
    arrowWrap: document.getElementById("arrow-wrap"),
    dlgName: document.getElementById("dlg-name"),
    inpName: document.getElementById("inp-name"),
    pinHint: document.getElementById("pin-hint"),
    nameCancel: document.getElementById("name-cancel"),
    formName: document.getElementById("form-name"),
    dlgDeletePin: document.getElementById("dlg-delete-pin"),
    deletePinName: document.getElementById("delete-pin-name"),
    deletePinCancel: document.getElementById("delete-pin-cancel"),
    deletePinConfirm: document.getElementById("delete-pin-confirm"),
    dlgDeleteScheduleSet: document.getElementById("dlg-delete-schedule-set"),
    deleteScheduleSetName: document.getElementById("delete-schedule-set-name"),
    deleteScheduleSetCancel: document.getElementById("delete-schedule-set-cancel"),
    deleteScheduleSetConfirm: document.getElementById("delete-schedule-set-confirm"),
    dlgShare: document.getElementById("dlg-share"),
    inpShareUrl: document.getElementById("inp-share-url"),
    btnCopyLink: document.getElementById("btn-copy-link"),
    btnSystemShare: document.getElementById("btn-system-share"),
    shareClose: document.getElementById("share-close"),
    dlgImport: document.getElementById("dlg-import"),
    dlgImportReplace: document.getElementById("dlg-import-replace"),
    inpImport: document.getElementById("inp-import"),
    importCancel: document.getElementById("import-cancel"),
    formImport: document.getElementById("form-import"),
    importReplaceCancel: document.getElementById("import-replace-cancel"),
    importReplaceConfirm: document.getElementById("import-replace-confirm"),
    dlgShareSchedule: document.getElementById("dlg-share-schedule"),
    inpShareScheduleUrl: document.getElementById("inp-share-schedule-url"),
    btnCopyScheduleLink: document.getElementById("btn-copy-schedule-link"),
    btnSystemShareSchedule: document.getElementById("btn-system-share-schedule"),
    scheduleShareClose: document.getElementById("schedule-share-close"),
    dlgImportSchedule: document.getElementById("dlg-import-schedule"),
    formImportSchedule: document.getElementById("form-import-schedule"),
    inpImportSchedule: document.getElementById("inp-import-schedule"),
    importScheduleCancel: document.getElementById("import-schedule-cancel"),
    dlgImportReplaceSchedule: document.getElementById("dlg-import-replace-schedule"),
    importReplaceScheduleCancel: document.getElementById("import-replace-schedule-cancel"),
    importReplaceScheduleConfirm: document.getElementById("import-replace-schedule-confirm"),
    btnScheduleShare: document.getElementById("btn-schedule-share"),
    btnScheduleImport: document.getElementById("btn-schedule-import"),
    toast: document.getElementById("toast"),
    tabMeetups: document.getElementById("tab-meetups"),
    tabVenue: document.getElementById("tab-venue"),
    tabSchedule: document.getElementById("tab-schedule"),
    panelMeetups: document.getElementById("panel-meetups"),
    panelVenue: document.getElementById("panel-venue"),
    panelSchedule: document.getElementById("panel-schedule"),
    poiSearch: document.getElementById("poi-search"),
    catChips: document.getElementById("cat-chips"),
    poiList: document.getElementById("poi-list"),
    scheduleSearch: document.getElementById("schedule-search"),
    scheduleSelectedOnly: document.getElementById("schedule-selected-only"),
    scheduleDay: document.getElementById("schedule-day"),
    scheduleStage: document.getElementById("schedule-stage"),
    scheduleGenre: document.getElementById("schedule-genre"),
    scheduleConflictSummary: document.getElementById("schedule-conflict-summary"),
    scheduleItineraryList: document.getElementById("schedule-itinerary-list"),
    scheduleSetList: document.getElementById("schedule-set-list"),
    meetupsCount: document.getElementById("meetups-count"),
    venueCount: document.getElementById("venue-count"),
    scheduleCount: document.getElementById("schedule-count"),
    emptyMeetups: document.getElementById("empty-meetups"),
  };

  let map;
  let userMarker;
  let pinsLayer;
  let poiLayer;
  let stageFillLayer;
  let stageLabelLayer;
  /** @type {import("leaflet").TileLayer | null} */
  let offlineTiles = null;
  /** @type {import("leaflet").TileLayer | null} */
  let onlineTilesLight = null;
  /** Site-wide dark/light UI only (maps remain light). */
  let siteThemeIsDark = true;
  let onlineMode = false;
  const leafletMarkers = new Map();
  const poiMarkers = new Map();
  let allPois = [];
  let allScheduleSets = [];
  const selectedScheduleSetIds = new Set();
  let scheduleDays = [];
  let scheduleStages = [];
  let scheduleGenres = [];
  let lastPosition = null;
  let compassHeading = null;
  /** @type {{ kind: 'pin'|'poi', id: string, name: string, lat: number, lng: number, category?: string } | null} */
  let activeNavTarget = null;
  let geoWatchId = null;
  /** We pushed a history entry when opening nav so the device back button closes the overlay. */
  let navHistoryPushed = false;
  let navInterval = null;
  /** Throttle expensive minimap refits so GPS callbacks stay snappy. */
  let lastNavMiniMapFitAt = 0;
  /** Most recent movement vector inferred from successive GPS fixes. */
  let motionHeadingDeg = null;
  let motionSpeedMps = 0;
  let motionUpdatedAtMs = 0;
  let prevGeoPosition = null;
  let navDebugEnabled = false;
  /** Pins waiting for Replace-all confirmation (`dlg-import-replace`). */
  let importReplacePendingPins = null;
  /** Set ids waiting for Replace-all schedule confirmation (`dlg-import-replace-schedule`). */
  let importReplacePendingScheduleIds = null;
  /** Coalesce compass DOM updates to one per animation frame. */
  let navReadoutRaf = null;
  let orientationHooked = false;
  let compassEnabled = false;
  /** User or OS blocked motion/orientation (e.g. iOS Safari prompt denied). */
  let compassMotionPermissionDenied = false;
  /** Geolocation watch reported permission denied. */
  let geoPermissionDenied = false;
  const selectedCategories = new Set();
  let navMap = null;
  let navMapUserMk = null;
  let navMapTargetMk = null;
  let navMapLine = null;
  /** @type {import("leaflet").TileLayer | null} */
  let navMapOfflineTiles = null;
  /** @type {import("leaflet").TileLayer | null} */
  let navMapOnlineTilesLight = null;
  let navMapOnlineMode = false;
  /** @type {any | null} */
  let deferredInstallPrompt = null;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "p-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  /**
   * Convert artwork-frame (u, v) — origin at the artwork's top-left, both in
   * [0, 1] — into ground-frame (nx, ny), where nx grows east and ny grows
   * north, both in [0, 1]. The transform is the inverse of the artwork's
   * counter-clockwise rotation from true north.
   */
  function artworkUvToGroundXY(u, v) {
    const r = ARTWORK_ROTATION_DEG;
    const rot = ((r % 360) + 360) % 360;
    if (rot === 0 || rot === 90 || rot === 180 || rot === 270) {
      switch (rot) {
        case 0:
          return [u, 1 - v];
        case 90:
          return [1 - v, 1 - u];
        case 180:
          return [1 - u, v];
        case 270:
          return [v, u];
        default:
          break;
      }
    }
    // Non-cardinal (e.g. 45°): use signed `r` so negative angles are not folded to 315°.
    const cx = u - 0.5;
    const cy = 0.5 - v;
    const rad = (-r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const nx = cx * cos - cy * sin + 0.5;
    const ny = cx * sin + cy * cos + 0.5;
    return [nx, ny];
  }

  function uvToLatLng(bounds, u, v) {
    const [nx, ny] = artworkUvToGroundXY(u, v);
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const lat = south + ny * (north - south);
    const lng = west + nx * (east - west);
    return L.latLng(lat, lng);
  }

  /**
   * Stage / major zones in **edc_map.jpg** artwork (u, v). Each `uvRing` is a
   * simple polygon in file space (0–1, origin top-left). Regions may overlap in
   * UV where the printed map physically overlaps (stacked translucency is fine).
   * Lat/lng comes from `uvToLatLng` after `ARTWORK_ROTATION_DEG`.
   */
  const STAGE_UV_ZONES = [
    {
      name: "bionicJUNGLE",
      fill: "#7dff9a",
      uvRing: [
        [0.04, 0.06],
        [0.36, 0.04],
        [0.42, 0.22],
        [0.28, 0.26],
        [0.08, 0.28],
      ],
    },
    {
      name: "stereoBLOOM",
      fill: "#ffd400",
      uvRing: [
        [0.28, 0.26],
        [0.42, 0.22],
        [0.44, 0.24],
        [0.38, 0.38],
        [0.24, 0.4],
      ],
    },
    {
      name: "kineticFIELD",
      fill: "#ff2dbe",
      uvRing: [
        [0.42, 0.22],
        [0.44, 0.06],
        [0.56, 0.04],
        [0.56, 0.2],
        [0.5, 0.22],
      ],
    },
    {
      name: "quantumVALLEY",
      fill: "#c86bff",
      uvRing: [
        [0.56, 0.04],
        [0.9, 0.06],
        [0.9, 0.14],
        [0.88, 0.32],
        [0.56, 0.32],
      ],
    },
    {
      name: "cosmicMEADOW",
      fill: "#6eb5ff",
      uvRing: [
        [0.04, 0.32],
        [0.24, 0.4],
        [0.34, 0.5],
        [0.36, 0.5],
        [0.18, 0.52],
        [0.04, 0.48],
      ],
    },
    {
      name: "Rainbow Bazaar",
      fill: "#dda0dd",
      uvRing: [
        [0.4, 0.36],
        [0.54, 0.34],
        [0.56, 0.48],
        [0.4, 0.48],
        [0.4, 0.4],
      ],
    },
    {
      name: "neonGARDEN",
      fill: "#39ff14",
      uvRing: [
        [0.56, 0.32],
        [0.88, 0.32],
        [0.9, 0.46],
        [0.9, 0.605],
        [0.74, 0.605],
        [0.58, 0.605],
        [0.56, 0.48],
      ],
    },
    {
      name: "Downtown EDC",
      fill: "#9a8ab8",
      uvRing: [
        [0.36, 0.5],
        [0.56, 0.48],
        [0.56, 0.64],
        [0.36, 0.64],
      ],
    },
    {
      name: "Camp EDC",
      fill: "#88aaff",
      uvRing: [
        [0.02, 0.04],
        [0.14, 0.03],
        [0.16, 0.17],
        [0.10, 0.19],
        [0.02, 0.14],
      ],
    },
    {
      name: "wasteLAND",
      fill: "#ff9e40",
      uvRing: [
        [0.04, 0.64],
        [0.22, 0.63],
        [0.34, 0.64],
        [0.36, 0.76],
        [0.32, 0.9],
        [0.1, 0.93],
        [0.06, 0.94],
        [0.04, 0.78],
      ],
    },
    {
      name: "bassPOD",
      fill: "#00f5ff",
      uvRing: [
        [0.36, 0.64],
        [0.56, 0.64],
        [0.56, 0.86],
        [0.52, 0.9],
        [0.4, 0.9],
        [0.36, 0.8],
      ],
    },
    {
      name: "circuitGROUNDS",
      fill: "#ff6bc4",
      uvRing: [
        [0.56, 0.615],
        [0.72, 0.615],
        [0.88, 0.615],
        [0.9, 0.78],
        [0.88, 0.92],
        [0.7, 0.93],
        [0.58, 0.94],
        [0.56, 0.8],
      ],
    },
  ];

  function uvRingToLatLngRing(uvRing) {
    return uvRing.map(([u, v]) => uvToLatLng(MAP_BOUNDS, u, v));
  }

  /** Centroid of a simple polygon in (u,v) artwork space (for label anchor). */
  function uvPolygonCentroid(uvRing) {
    const n = uvRing.length;
    if (n === 0) return [0.5, 0.5];
    if (n < 3) {
      let su = 0;
      let sv = 0;
      uvRing.forEach(([u, v]) => {
        su += u;
        sv += v;
      });
      return [su / n, sv / n];
    }
    let twice = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = uvRing[i];
      const [x1, y1] = uvRing[(i + 1) % n];
      const cr = x0 * y1 - x1 * y0;
      twice += cr;
      cx += (x0 + x1) * cr;
      cy += (y0 + y1) * cr;
    }
    if (Math.abs(twice) < 1e-12) {
      let su = 0;
      let sv = 0;
      uvRing.forEach(([u, v]) => {
        su += u;
        sv += v;
      });
      return [su / n, sv / n];
    }
    const inv = 1 / (3 * twice);
    return [cx * inv, cy * inv];
  }

  function stageLabelIcon(name) {
    const safe = String(name).replace(/</g, "");
    return L.divIcon({
      className: "edc-stage-label-wrap",
      html: '<span class="edc-stage-label">' + safe + "</span>",
      iconSize: [200, 34],
      iconAnchor: [100, 17],
    });
  }

  function buildStageOverlays() {
    if (!map || !stageFillLayer || !stageLabelLayer) return;
    stageFillLayer.clearLayers();
    stageLabelLayer.clearLayers();
    STAGE_UV_ZONES.forEach((z) => {
      const ring = uvRingToLatLngRing(z.uvRing);
      const [cx, cy] = uvPolygonCentroid(z.uvRing);
      L.polygon(ring, {
        stroke: true,
        color: z.fill,
        weight: 1,
        opacity: 0.42,
        fillColor: z.fill,
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(stageFillLayer);
      L.marker(uvToLatLng(MAP_BOUNDS, cx, cy), {
        icon: stageLabelIcon(z.name),
        interactive: false,
        keyboard: false,
      }).addTo(stageLabelLayer);
    });
  }

  function scheduleNavReadoutFromOrientation() {
    if (els.navOverlay.dataset.open !== "true") return;
    if (navReadoutRaf != null) return;
    navReadoutRaf = requestAnimationFrame(() => {
      navReadoutRaf = null;
      updateNavReadout();
    });
  }

  function onDeviceOrientation(e) {
    if (typeof e.webkitCompassHeading === "number") {
      // iOS: proprietary but reliable true-north heading
      compassHeading = e.webkitCompassHeading;
    } else if (e.absolute === true && typeof e.alpha === "number") {
      // Android: alpha is 0 at North and increases counter-clockwise (90 = West).
      // Convert to standard compass bearing (clockwise, 90 = East).
      compassHeading = (360 - e.alpha) % 360;
    }
    scheduleNavReadoutFromOrientation();
  }

  function loadPins() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  function savePins(pins) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  }

  function haversineM(a, b) {
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLon = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function bearingDeg(from, to) {
    const φ1 = (from.lat * Math.PI) / 180;
    const φ2 = (to.lat * Math.PI) / 180;
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function offsetLatLngMeters(from, bearing, meters) {
    const R = 6371000;
    const br = (bearing * Math.PI) / 180;
    const dR = meters / R;
    const lat1 = (from.lat * Math.PI) / 180;
    const lon1 = (from.lng * Math.PI) / 180;
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinDR = Math.sin(dR);
    const cosDR = Math.cos(dR);
    const sinLat2 = sinLat1 * cosDR + cosLat1 * sinDR * Math.cos(br);
    const lat2 = Math.asin(Math.min(1, Math.max(-1, sinLat2)));
    const y = Math.sin(br) * sinDR * cosLat1;
    const x = cosDR - sinLat1 * Math.sin(lat2);
    const lon2 = lon1 + Math.atan2(y, x);
    return { lat: (lat2 * 180) / Math.PI, lng: ((((lon2 * 180) / Math.PI + 540) % 360) - 180) };
  }

  function navEstimatedHere() {
    if (!lastPosition) return null;
    const base = { lat: lastPosition.coords.latitude, lng: lastPosition.coords.longitude };
    const now = Date.now();
    const fixTs = typeof lastPosition.timestamp === "number" ? lastPosition.timestamp : now;

    let heading = null;
    const rawHeading = lastPosition.coords.heading;
    if (typeof rawHeading === "number" && Number.isFinite(rawHeading) && rawHeading >= 0) heading = rawHeading;

    let speed = null;
    const rawSpeed = lastPosition.coords.speed;
    if (typeof rawSpeed === "number" && Number.isFinite(rawSpeed) && rawSpeed > 0.35) speed = rawSpeed;

    if (
      (heading == null || speed == null) &&
      motionHeadingDeg != null &&
      Number.isFinite(motionSpeedMps) &&
      motionSpeedMps > 0.35 &&
      now - motionUpdatedAtMs <= 6000
    ) {
      if (heading == null) heading = motionHeadingDeg;
      if (speed == null) speed = motionSpeedMps;
    }

    const elapsedSec = Math.max(0, (now - fixTs) / 1000);
    if (heading == null || speed == null || speed <= 0.35 || elapsedSec < 0.05) return base;

    // Limit dead-reckoning horizon so estimates stay close to real GPS fixes.
    const projectSec = Math.min(elapsedSec, 2.2);
    return offsetLatLngMeters(base, heading, speed * projectSec);
  }

  function setNavDebugEnabled(on) {
    navDebugEnabled = !!on;
    if (els.navDebugToggle) {
      els.navDebugToggle.dataset.on = navDebugEnabled ? "true" : "false";
      els.navDebugToggle.setAttribute("aria-pressed", navDebugEnabled ? "true" : "false");
    }
    if (els.navDebugReadout) els.navDebugReadout.hidden = !navDebugEnabled;
  }

  function updateNavDebugReadout(here, distMeters, brgDeg) {
    if (!navDebugEnabled || !els.navDebugReadout) return;
    if (els.navDebugReadout.hidden) els.navDebugReadout.hidden = false;
    const fix = lastPosition;
    const now = Date.now();
    const fixAgeMs = fix && typeof fix.timestamp === "number" ? Math.max(0, now - fix.timestamp) : null;
    const accuracy = fix && typeof fix.coords.accuracy === "number" ? Math.round(fix.coords.accuracy) : null;
    const speed = fix && typeof fix.coords.speed === "number" && Number.isFinite(fix.coords.speed) ? fix.coords.speed : null;
    const gpsHeading =
      fix && typeof fix.coords.heading === "number" && Number.isFinite(fix.coords.heading) && fix.coords.heading >= 0
        ? fix.coords.heading
        : null;
    const source =
      speed != null && speed > 0.35 && gpsHeading != null
        ? "gps_speed+heading"
        : motionUpdatedAtMs && now - motionUpdatedAtMs <= 6000
          ? "inferred_motion"
          : "raw_fix";
    const lines = [
      "Debug Readout",
      "fix age: " + (fixAgeMs == null ? "n/a" : fixAgeMs + " ms"),
      "location: watchPosition only (↻ = one-shot refresh; avoids repeat prompts on some browsers)",
      "accuracy: " + (accuracy == null ? "n/a" : "±" + accuracy + " m"),
      "gps speed: " + (speed == null ? "n/a" : speed.toFixed(2) + " m/s"),
      "gps heading: " + (gpsHeading == null ? "n/a" : Math.round(gpsHeading) + " deg"),
      "motion est: " + (motionSpeedMps > 0 ? motionSpeedMps.toFixed(2) + " m/s @ " + Math.round(motionHeadingDeg || 0) + " deg" : "n/a"),
      "position source: " + source,
      "estimated here: " + (here ? here.lat.toFixed(6) + ", " + here.lng.toFixed(6) : "n/a"),
      "distance: " + (Number.isFinite(distMeters) ? Math.round(distMeters) + " m" : "n/a"),
      "bearing: " + (Number.isFinite(brgDeg) ? Math.round(brgDeg) + " deg" : "n/a"),
    ];
    els.navDebugReadout.textContent = lines.join("\n");
  }

  function formatDist(m) {
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(2) + " km";
  }

  function formatDistNav(m) {
    const FT_PER_M = 3.280839895;
    const M_PER_MI = 1609.344;
    if (!Number.isFinite(m) || m < 0) return "—";
    if (m >= M_PER_MI) return (m / M_PER_MI).toFixed(m >= 10 * M_PER_MI ? 1 : 2) + " mi";
    return Math.round(m * FT_PER_M) + " ft";
  }

  function cardinal(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    return dirs[Math.round(deg / 45) % 8];
  }

  function normalizeKey(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function loadScheduleSelection() {
    selectedScheduleSetIds.clear();
    try {
      const raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      arr.forEach((id) => {
        if (typeof id === "string" && id) selectedScheduleSetIds.add(id);
      });
    } catch (_) {
      /* ignore malformed data */
    }
  }

  function saveScheduleSelection() {
    try {
      localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(Array.from(selectedScheduleSetIds)));
    } catch (_) {}
  }

  function parseCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function parseCsvRows(csvText) {
    const lines = String(csvText || "")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    if (!lines.length) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = (cols[idx] || "").trim();
      });
      rows.push(row);
    }
    return rows;
  }

  function parseScheduleDateTime(dateText, timeText) {
    const dateRaw = String(dateText || "").trim();
    const timeRaw = String(timeText || "").trim();
    if (!dateRaw || !timeRaw) return null;
    if (dateRaw.toUpperCase() === "TBA" || timeRaw.toUpperCase() === "TBA") return null;
    const dm = dateRaw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!dm) return null;
    const tm = timeRaw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!tm) return null;
    let hour = Number(tm[1]);
    const min = Number(tm[2]);
    const ampm = tm[3].toUpperCase();
    if (!Number.isFinite(hour) || !Number.isFinite(min)) return null;
    if (hour < 1 || hour > 12 || min < 0 || min > 59) return null;
    if (ampm === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    const month = Number(dm[1]);
    const day = Number(dm[2]);
    const year = Number(dm[3]);
    const dt = new Date(year, month - 1, day, hour, min, 0, 0);
    const ts = dt.getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  function formatScheduleStamp(ms) {
    if (!Number.isFinite(ms)) return "TBA";
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(ms);
  }

  function formatScheduleTime(ms) {
    if (!Number.isFinite(ms)) return "TBA";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(ms);
  }

  function setSelectOptions(selectEl, options, allLabel) {
    if (!selectEl) return;
    const prior = selectEl.value || "all";
    selectEl.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = allLabel;
    selectEl.appendChild(allOpt);
    options.forEach((opt) => {
      const optionEl = document.createElement("option");
      optionEl.value = opt.value;
      optionEl.textContent = opt.label;
      selectEl.appendChild(optionEl);
    });
    selectEl.value = Array.from(selectEl.options).some((o) => o.value === prior) ? prior : "all";
  }

  function inferScheduleSetEndTimes(sets) {
    const grouped = new Map();
    sets.forEach((set) => {
      if (!Number.isFinite(set.startMs)) {
        set.endMs = null;
        return;
      }
      const key = set.stageKey + "|" + set.dateText;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(set);
    });
    grouped.forEach((items) => {
      items.sort((a, b) => {
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
        return a.artist.localeCompare(b.artist);
      });
      for (let i = 0; i < items.length; i++) {
        const cur = items[i];
        const next = items[i + 1];
        const defaultEnd = cur.startMs + DEFAULT_SET_MINUTES * 60000;
        if (!next || !Number.isFinite(next.startMs)) {
          cur.endMs = defaultEnd;
          continue;
        }
        const minEnd = cur.startMs + 30 * 60000;
        cur.endMs = Math.max(minEnd, next.startMs);
      }
    });
  }

  function parseScheduleCsv(csvText) {
    const rows = parseCsvRows(csvText);
    const sets = [];
    rows.forEach((row, idx) => {
      const artist = String(row["Artist"] || "").trim();
      if (!artist) return;
      const dayRaw = String(row["Day"] || "TBA").trim().toUpperCase() || "TBA";
      const stageName = String(row["Stage"] || "TBA").trim() || "TBA";
      const genre = String(row["Genre/Style"] || "Unknown").trim() || "Unknown";
      const dateText = String(row["Date"] || "TBA").trim() || "TBA";
      const timeText = String(row["Set Time"] || "TBA").trim() || "TBA";
      const startMs = parseScheduleDateTime(dateText, timeText);
      sets.push({
        id: "set-" + (idx + 1),
        artist,
        genre,
        stage: stageName,
        stageKey: normalizeKey(stageName),
        dayRaw,
        dayLabel: DAY_LABELS[dayRaw] || dayRaw || "TBA",
        dateText,
        timeText,
        startMs,
        endMs: null,
        stagePoiId: null,
        stageLat: null,
        stageLng: null,
      });
    });
    inferScheduleSetEndTimes(sets);
    return sets;
  }

  function buildScheduleStageLookup() {
    const lookup = new Map();
    allPois.forEach((p) => {
      if (p.category !== "stage" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
      lookup.set(normalizeKey(p.name), { poiId: p.id, lat: p.lat, lng: p.lng, label: p.name });
    });
    STAGE_UV_ZONES.forEach((z) => {
      const key = normalizeKey(z.name);
      if (lookup.has(key)) return;
      const [u, v] = uvPolygonCentroid(z.uvRing);
      const ll = uvToLatLng(MAP_BOUNDS, u, v);
      lookup.set(key, { poiId: null, lat: ll.lat, lng: ll.lng, label: z.name });
    });
    return lookup;
  }

  function hydrateScheduleStageRefs() {
    const lookup = buildScheduleStageLookup();
    allScheduleSets.forEach((set) => {
      const ref = lookup.get(set.stageKey);
      if (!ref) return;
      set.stagePoiId = ref.poiId;
      set.stageLat = ref.lat;
      set.stageLng = ref.lng;
    });
  }

  function buildScheduleFilterOptions() {
    scheduleDays = Array.from(new Set(allScheduleSets.map((s) => s.dayRaw))).sort((a, b) => {
      const order = ["FRIDAY", "SATURDAY", "SUNDAY", "TBA"];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    scheduleStages = Array.from(new Set(allScheduleSets.map((s) => s.stage))).sort((a, b) => a.localeCompare(b));
    scheduleGenres = Array.from(new Set(allScheduleSets.map((s) => s.genre))).sort((a, b) => a.localeCompare(b));

    setSelectOptions(
      els.scheduleDay,
      scheduleDays.map((d) => ({ value: d, label: DAY_LABELS[d] || d })),
      "All days"
    );
    setSelectOptions(
      els.scheduleStage,
      scheduleStages.map((s) => ({ value: normalizeKey(s), label: s })),
      "All stages"
    );
    setSelectOptions(
      els.scheduleGenre,
      scheduleGenres.map((g) => ({ value: g, label: g })),
      "All genres"
    );
  }

  function scheduleSetPassesFilters(set) {
    if (!set) return false;
    const q = (els.scheduleSearch && els.scheduleSearch.value ? els.scheduleSearch.value : "").trim().toLowerCase();
    const day = els.scheduleDay ? els.scheduleDay.value : "all";
    const stage = els.scheduleStage ? els.scheduleStage.value : "all";
    const genre = els.scheduleGenre ? els.scheduleGenre.value : "all";
    const selectedOnly = !!(els.scheduleSelectedOnly && els.scheduleSelectedOnly.checked);
    if (selectedOnly && !selectedScheduleSetIds.has(set.id)) return false;
    if (day !== "all" && set.dayRaw !== day) return false;
    if (stage !== "all" && set.stageKey !== stage) return false;
    if (genre !== "all" && set.genre !== genre) return false;
    if (!q) return true;
    return (
      set.artist.toLowerCase().includes(q) ||
      set.genre.toLowerCase().includes(q) ||
      set.stage.toLowerCase().includes(q) ||
      set.dayLabel.toLowerCase().includes(q) ||
      set.timeText.toLowerCase().includes(q)
    );
  }

  function filteredScheduleSets() {
    const list = allScheduleSets.filter((set) => scheduleSetPassesFilters(set));
    list.sort((a, b) => {
      const aTimed = Number.isFinite(a.startMs);
      const bTimed = Number.isFinite(b.startMs);
      if (aTimed && bTimed) {
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      } else if (aTimed !== bTimed) {
        return aTimed ? -1 : 1;
      }
      return a.artist.localeCompare(b.artist);
    });
    return list;
  }

  function addScheduleConflict(map, a, b) {
    if (!map.has(a.id)) map.set(a.id, new Set());
    if (!map.has(b.id)) map.set(b.id, new Set());
    map.get(a.id).add(b.id);
    map.get(b.id).add(a.id);
  }

  function computeSchedulePlan() {
    const selected = allScheduleSets.filter((set) => selectedScheduleSetIds.has(set.id));
    const timed = selected
      .filter((set) => Number.isFinite(set.startMs))
      .sort((a, b) => (a.startMs !== b.startMs ? a.startMs - b.startMs : a.artist.localeCompare(b.artist)));
    const untimed = selected.filter((set) => !Number.isFinite(set.startMs)).sort((a, b) => a.artist.localeCompare(b.artist));
    const conflictsById = new Map();
    const conflictPairs = [];

    for (let i = 0; i < timed.length; i++) {
      const a = timed[i];
      const aEnd = Number.isFinite(a.endMs) ? a.endMs : a.startMs + DEFAULT_SET_MINUTES * 60000;
      for (let j = i + 1; j < timed.length; j++) {
        const b = timed[j];
        const bStart = b.startMs;
        if (bStart >= aEnd) break;
        const bEnd = Number.isFinite(b.endMs) ? b.endMs : b.startMs + DEFAULT_SET_MINUTES * 60000;
        if (bStart < aEnd && a.startMs < bEnd) {
          addScheduleConflict(conflictsById, a, b);
          conflictPairs.push([a, b]);
        }
      }
    }

    const itinerary = timed.map((set, idx) => {
      const next = timed[idx + 1] || null;
      let walkMinutes = null;
      let leaveByMs = null;
      let transitTight = false;
      let leaveFlexible = false;
      if (next && Number.isFinite(set.stageLat) && Number.isFinite(set.stageLng) && Number.isFinite(next.stageLat) && Number.isFinite(next.stageLng)) {
        const distMeters = haversineM({ lat: set.stageLat, lng: set.stageLng }, { lat: next.stageLat, lng: next.stageLng });
        walkMinutes = Math.max(
          MIN_TRANSITION_MINUTES,
          Math.ceil(distMeters / WALK_METERS_PER_MINUTE + WALK_BUFFER_MINUTES)
        );
        const hardEnd = Number.isFinite(set.endMs) ? set.endMs : set.startMs + DEFAULT_SET_MINUTES * 60000;
        const mustLeaveBy = next.startMs - walkMinutes * 60000;
        const gapBetweenStarts = next.startMs - set.startMs;
        const idealFlexible = set.startMs + FLEXIBLE_LEAVE_AFTER_START_MS;
        if (
          gapBetweenStarts >= DECENT_GAP_BETWEEN_STARTS_MS &&
          idealFlexible <= mustLeaveBy &&
          idealFlexible <= hardEnd
        ) {
          leaveByMs = idealFlexible;
          leaveFlexible = true;
          transitTight = false;
        } else {
          leaveByMs = Math.min(hardEnd, mustLeaveBy);
          leaveFlexible = false;
          transitTight = leaveByMs < set.startMs;
        }
      }
      return {
        set,
        next,
        walkMinutes,
        leaveByMs,
        transitTight,
        leaveFlexible,
        hasConflict: conflictsById.has(set.id),
      };
    });

    return { selected, timed, untimed, conflictsById, conflictPairs, itinerary };
  }

  function makeScheduleSetMeta(set) {
    const when = Number.isFinite(set.startMs) ? formatScheduleStamp(set.startMs) : set.dayLabel + " · " + set.dateText + " " + set.timeText;
    return when + " · " + set.stage + " · " + set.genre;
  }

  function wireScheduleMapButtons(root, set) {
    const mapBtn = root.querySelector('[data-a="map"]');
    const navBtn = root.querySelector('[data-a="go"]');
    const canMap = !!(set.stagePoiId && poiMarkers.has(set.stagePoiId));
    if (mapBtn) {
      mapBtn.disabled = !canMap;
      mapBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canMap) return;
        const mk = poiMarkers.get(set.stagePoiId);
        if (mk) flyToAndOpenPopup(mk, 16);
      });
    }
    if (navBtn) {
      navBtn.disabled = !canMap;
      navBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canMap) return;
        openNavForPoi(set.stagePoiId);
      });
    }
  }

  function renderScheduleItinerary(plan) {
    if (!els.scheduleItineraryList) return;
    els.scheduleItineraryList.innerHTML = "";
    if (!plan.selected.length) {
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.innerHTML =
        '<div class="schedule-meta">No sets saved yet. Tap Save on any artist below to build your itinerary.</div>';
      els.scheduleItineraryList.appendChild(li);
      return;
    }

    const itineraryFiltered = plan.itinerary.filter((entry) => scheduleSetPassesFilters(entry.set));
    const untimedFiltered = plan.untimed.filter((set) => scheduleSetPassesFilters(set));
    if (!itineraryFiltered.length && !untimedFiltered.length) {
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.innerHTML =
        '<div class="schedule-meta">No saved sets match your current search or filters. Clear filters or pick another day/stage/genre.</div>';
      els.scheduleItineraryList.appendChild(li);
      return;
    }

    itineraryFiltered.forEach((entry) => {
      const set = entry.set;
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.dataset.selected = "true";
      li.dataset.conflict = entry.hasConflict ? "true" : "false";
      const leaveLine = (() => {
        if (!entry.next) return "Leave by: Last scheduled set";
        if (!Number.isFinite(entry.leaveByMs) || !Number.isFinite(entry.walkMinutes)) {
          return "Leave by: unavailable (missing stage route)";
        }
        if (entry.leaveFlexible) {
          return "Leave by: " + formatScheduleTime(entry.leaveByMs) + " (flexible)";
        }
        if (entry.transitTight) {
          return "Leave by: " + formatScheduleTime(entry.leaveByMs) + " (tight transfer)";
        }
        return "Leave by: " + formatScheduleTime(entry.leaveByMs) + " (" + entry.walkMinutes + " min walk)";
      })();
      const conflictChip =
        entry.hasConflict ?
          '<div class="schedule-conflict-chip" role="status">Overlapping set</div>'
        : "";
      li.innerHTML = `
        ${conflictChip}
        <div class="schedule-row">
          <div class="schedule-name"></div>
          <div class="schedule-actions">
            <button type="button" data-a="go">Navigate</button>
            <button type="button" data-a="map">Map</button>
            <button type="button" data-a="toggle">Remove</button>
          </div>
        </div>
        <div class="schedule-meta"></div>
        <div class="schedule-leave"></div>
      `;
      li.querySelector(".schedule-name").textContent = set.artist;
      li.querySelector(".schedule-meta").textContent = makeScheduleSetMeta(set);
      li.querySelector(".schedule-leave").textContent = leaveLine;
      li.querySelector('[data-a="toggle"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteScheduleSetConfirm(set.id);
      });
      wireScheduleMapButtons(li, set);
      els.scheduleItineraryList.appendChild(li);
    });

    untimedFiltered.forEach((set) => {
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.dataset.selected = "true";
      li.innerHTML = `
        <div class="schedule-row">
          <div class="schedule-name"></div>
          <div class="schedule-actions">
            <button type="button" data-a="go">Navigate</button>
            <button type="button" data-a="map">Map</button>
            <button type="button" data-a="toggle">Remove</button>
          </div>
        </div>
        <div class="schedule-meta"></div>
        <div class="schedule-leave">Leave by: TBA until official time is published.</div>
      `;
      li.querySelector(".schedule-name").textContent = set.artist;
      li.querySelector(".schedule-meta").textContent = makeScheduleSetMeta(set);
      li.querySelector('[data-a="toggle"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openDeleteScheduleSetConfirm(set.id);
      });
      wireScheduleMapButtons(li, set);
      els.scheduleItineraryList.appendChild(li);
    });
  }

  function renderScheduleSetList(plan) {
    if (!els.scheduleSetList) return;
    const conflictIds = new Set(plan.conflictsById.keys());
    const filtered = filteredScheduleSets();
    els.scheduleSetList.innerHTML = "";
    if (!filtered.length) {
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.innerHTML = '<div class="schedule-meta">No sets match your current search/filter.</div>';
      els.scheduleSetList.appendChild(li);
      return;
    }
    filtered.forEach((set) => {
      const selected = selectedScheduleSetIds.has(set.id);
      const li = document.createElement("li");
      li.className = "schedule-item";
      li.dataset.selected = selected ? "true" : "false";
      const isConflict = selected && conflictIds.has(set.id);
      li.dataset.conflict = isConflict ? "true" : "false";
      const conflictChip = isConflict ? '<div class="schedule-conflict-chip" role="status">Overlapping set</div>' : "";
      li.innerHTML = `
        ${conflictChip}
        <div class="schedule-row">
          <div class="schedule-name"></div>
          <div class="schedule-actions">
            <button type="button" data-a="go">Navigate</button>
            <button type="button" data-a="map">Map</button>
            <button type="button" data-a="toggle"></button>
          </div>
        </div>
        <div class="schedule-meta"></div>
      `;
      li.querySelector(".schedule-name").textContent = set.artist;
      li.querySelector(".schedule-meta").textContent = makeScheduleSetMeta(set);
      li.querySelector('[data-a="toggle"]').textContent = selected ? "Remove" : "Save";
      li.querySelector('[data-a="toggle"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (selected) openDeleteScheduleSetConfirm(set.id);
        else toggleScheduleSelection(set.id);
      });
      wireScheduleMapButtons(li, set);
      els.scheduleSetList.appendChild(li);
    });
  }

  function renderScheduleTab() {
    if (els.scheduleCount) els.scheduleCount.textContent = String(selectedScheduleSetIds.size);
    const plan = computeSchedulePlan();
    if (els.scheduleConflictSummary) {
      const conflicts = plan.conflictPairs.length;
      if (conflicts > 0) {
        const pairWord = conflicts === 1 ? "conflict" : "conflicts";
        els.scheduleConflictSummary.hidden = false;
        els.scheduleConflictSummary.textContent =
          conflicts + " " + pairWord + " detected in your saved itinerary. Overlapping sets are highlighted.";
      } else {
        els.scheduleConflictSummary.hidden = true;
      }
    }
    renderScheduleItinerary(plan);
    renderScheduleSetList(plan);
  }

  function toggleScheduleSelection(setId) {
    if (!setId) return;
    if (selectedScheduleSetIds.has(setId)) selectedScheduleSetIds.delete(setId);
    else selectedScheduleSetIds.add(setId);
    saveScheduleSelection();
    renderScheduleTab();
  }

  async function loadFestivalSchedule() {
    try {
      const res = await fetch(SCHEDULE_DATA_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const csvText = await res.text();
      allScheduleSets = parseScheduleCsv(csvText);
      hydrateScheduleStageRefs();
      const validIds = new Set(allScheduleSets.map((s) => s.id));
      let changed = false;
      Array.from(selectedScheduleSetIds).forEach((id) => {
        if (!validIds.has(id)) {
          selectedScheduleSetIds.delete(id);
          changed = true;
        }
      });
      if (changed) saveScheduleSelection();
      buildScheduleFilterOptions();
      renderScheduleTab();
    } catch (err) {
      console.error(err);
      if (els.scheduleSetList) {
        els.scheduleSetList.innerHTML =
          '<li class="schedule-item"><div class="schedule-meta">Schedule failed to load. Open the app online once, then retry.</div></li>';
      }
      toast("Schedule failed to load — open online once, then retry.");
    }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.dataset.visible = "true";
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      els.toast.dataset.visible = "false";
    }, 3200);
  }

  function setOfflineBadge(state) {
    if (state === "ready") {
      els.offlineBadge.textContent = "offline-ready";
      els.offlineBadge.dataset.state = "ready";
    } else if (state === "basic") {
      els.offlineBadge.textContent = "limited cache";
      els.offlineBadge.dataset.state = "pending";
    } else {
      els.offlineBadge.textContent = "cache…";
      els.offlineBadge.dataset.state = "pending";
    }
  }

  function setOnlineOfflineTitle() {
    const isOnline = typeof navigator !== "undefined" && navigator.onLine === true;
    const suffix = isOnline ? " · Online" : " · Offline";
    const baseDocTitle = "EDC Vegas 2026";
    document.title = baseDocTitle + suffix;
    if (els.appTitle) els.appTitle.textContent = "EDC VEGAS 2026" + (isOnline ? " · ONLINE" : " · OFFLINE");
  }

  function refreshFooterCacheVersion() {
    if (!els.footerCacheVersion) return;
    fetch(asset("sw.js"), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        const m = text.match(/const\s+CACHE\s*=\s*"([^"]+)"/);
        const id = m && m[1].match(/v(\d+)\s*$/i);
        if (id) els.footerCacheVersion.textContent = id[1];
        else if (m) els.footerCacheVersion.textContent = m[1];
        else els.footerCacheVersion.textContent = "—";
      })
      .catch(() => {
        els.footerCacheVersion.textContent = "—";
      });
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) {
      setOfflineBadge("basic");
      return;
    }
    const swUrl = asset("sw.js");
    const swScope = ASSET_BASE_URL;
    navigator.serviceWorker
      .register(swUrl, { scope: swScope })
      .then((reg) => {
        if (reg.installing) {
          reg.installing.addEventListener("statechange", () => {
            if (reg.installing && reg.installing.state === "installed") setOfflineBadge("ready");
          });
        }
        if (reg.waiting) setOfflineBadge("ready");
        if (reg.active) setOfflineBadge("ready");
        navigator.serviceWorker.addEventListener("controllerchange", () => setOfflineBadge("ready"));
      })
      .catch(() => setOfflineBadge("basic"));
  }

  function pinIcon(color) {
    return L.divIcon({
      className: "",
      html: `<div class="pin-marker-inner" style="background:${color}"></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
  }

  function userIcon() {
    return L.divIcon({
      className: "user-marker",
      html: '<div class="user-dot"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
  }

  /**
   * Popup body: title, optional subtitle, Navigate → compass overlay.
   */
  function createNavigatePopupEl(title, subtitle, onNavigate) {
    const wrap = L.DomUtil.create("div", "map-nav-popup");
    const tit = L.DomUtil.create("div", "map-nav-popup-title", wrap);
    tit.textContent = title;
    if (subtitle) {
      const sub = L.DomUtil.create("div", "map-nav-popup-sub", wrap);
      sub.textContent = subtitle;
    }
    const btn = L.DomUtil.create("button", "btn btn-primary btn-sm map-nav-popup-btn", wrap);
    btn.type = "button";
    btn.textContent = "Navigate";
    L.DomEvent.on(btn, "mousedown dblclick", L.DomEvent.stopPropagation);
    L.DomEvent.on(btn, "click", (ev) => {
      L.DomEvent.stop(ev);
      if (map) map.closePopup();
      onNavigate();
    });
    return wrap;
  }

  /** Fly map to a layer, then open its popup (list / “show on map” flows). */
  function flyToAndOpenPopup(layer, minZoom) {
    if (!map || !layer || typeof layer.getLatLng !== "function") return;
    const z = Math.max(map.getZoom(), minZoom ?? 17);
    const dur = 0.42;
    map.flyTo(layer.getLatLng(), z, { duration: dur });
    window.setTimeout(() => {
      if (layer && typeof layer.openPopup === "function") layer.openPopup();
    }, Math.round(dur * 1000) + 80);
  }

  function loadSiteThemePreference() {
    try {
      const v = localStorage.getItem(SITE_THEME_KEY);
      if (v === "dark") return true;
      if (v === "light") return false;
      const legacy = localStorage.getItem(MAP_ONLINE_DARK_KEY);
      if (legacy === "1") return true;
      if (legacy === "0") return false;
    } catch {
      /* ignore */
    }
    return true;
  }

  function saveSiteThemePreference(isDark) {
    try {
      localStorage.setItem(SITE_THEME_KEY, isDark ? "dark" : "light");
    } catch (_) {}
  }

  function applySiteTheme() {
    document.documentElement.dataset.siteTheme = siteThemeIsDark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", siteThemeIsDark ? "#0a0514" : "#ebe6f4");
    if (els.siteThemeToggle) {
      els.siteThemeToggle.checked = siteThemeIsDark;
      els.siteThemeToggle.setAttribute("aria-checked", siteThemeIsDark ? "true" : "false");
      els.siteThemeToggle.setAttribute(
        "aria-label",
        siteThemeIsDark ? "Dark mode on. Switch to light mode." : "Light mode on. Switch to dark mode."
      );
    }
    const themeCap = document.getElementById("site-theme-toggle-caption");
    if (themeCap) themeCap.textContent = siteThemeIsDark ? "Dark" : "Light";
    if (onlineMode) {
      applyMainMapOnlineBasemapLayers();
      applyNavMapOnlineBasemapLayers();
    }
    if (map) map.invalidateSize({ animate: false });
    if (navMap) navMap.invalidateSize({ animate: false });
  }

  function applyMainMapOnlineBasemapLayers() {
    if (!map || !onlineMode || !offlineTiles) return;
    if (onlineTilesLight && map.hasLayer(onlineTilesLight)) map.removeLayer(onlineTilesLight);
    if (!map.hasLayer(offlineTiles)) offlineTiles.addTo(map);
    if (onlineTilesLight && !map.hasLayer(onlineTilesLight)) onlineTilesLight.addTo(map);
    if (onlineTilesLight) onlineTilesLight.bringToFront();
  }

  function applyNavMapOnlineBasemapLayers() {
    if (!navMap || !navMapOnlineMode) return;
    if (navMapOnlineTilesLight && navMap.hasLayer(navMapOnlineTilesLight)) navMap.removeLayer(navMapOnlineTilesLight);
    if (navMapOfflineTiles && !navMap.hasLayer(navMapOfflineTiles)) navMapOfflineTiles.addTo(navMap);
    if (navMapOnlineTilesLight && !navMap.hasLayer(navMapOnlineTilesLight)) navMapOnlineTilesLight.addTo(navMap);
    if (navMapOnlineTilesLight) navMapOnlineTilesLight.bringToFront();
  }

  function initMap() {
    const WORLD_BOUNDS = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));
    const startOnline = typeof navigator !== "undefined" && navigator.onLine === true;
    onlineMode = startOnline;
    siteThemeIsDark = loadSiteThemePreference();
    applySiteTheme();

    map = L.map(els.map, {
      maxBounds: startOnline ? WORLD_BOUNDS : WIDE_BOUNDS,
      maxBoundsViscosity: startOnline ? 0 : 1.0,
      zoomControl: true,
      attributionControl: true,
      minZoom: startOnline ? 2 : 12,
      maxZoom: 19,
    });

    // Online basemap: CARTO Positron (light). Local tiles remain the infield underlay.
    onlineTilesLight = L.tileLayer(ONLINE_WORLD_TILE_URL, {
      minZoom: 2,
      maxZoom: 20,
      subdomains: "abcd",
      attribution: ONLINE_WORLD_TILE_ATTRIBUTION,
    });
    // Offline bundled EDC-area tiles (light style) and underlay when online.
    offlineTiles = L.tileLayer(BASEMAP_TILE_URL, {
      minZoom: 12,
      maxZoom: 19,
      maxNativeZoom: 16,
      minNativeZoom: 12,
      tileSize: 256,
      bounds: WIDE_BOUNDS,
      attribution:
        'EDC LVMS · local tiles · data © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> contributors',
    });

    if (startOnline) {
      offlineTiles.addTo(map);
      applyMainMapOnlineBasemapLayers();
    } else {
      offlineTiles.addTo(map);
    }

    map.fitBounds(MAP_BOUNDS.pad(0.08));

    stageFillLayer = L.layerGroup().addTo(map);
    stageLabelLayer = L.layerGroup().addTo(map);
    buildStageOverlays();

    poiLayer = L.layerGroup().addTo(map);
    pinsLayer = L.layerGroup().addTo(map);
    userMarker = L.marker(MAP_BOUNDS.getCenter(), { icon: userIcon() }).addTo(map);

    const lockToOfflineBounds = () => {
      if (!map) return;
      if (onlineMode) return;
      // Keep the viewport firmly inside the offline tile area so the user never scrolls into blank space.
      try {
        map.panInsideBounds(WIDE_BOUNDS, { animate: false });
      } catch (_) {}
    };

    map.on("moveend", lockToOfflineBounds);

    const applyConnectivityMode = (isOnline) => {
      if (!map) return;
      onlineMode = !!isOnline;

      if (onlineMode) {
        map.options.maxBoundsViscosity = 0;
        map.setMinZoom(2);
        try {
          map.setMaxBounds(WORLD_BOUNDS);
        } catch (_) {}

        if (offlineTiles && !map.hasLayer(offlineTiles)) offlineTiles.addTo(map);
        applyMainMapOnlineBasemapLayers();
      } else {
        // Offline: remove online tiles, lock bounds, and snap back to EDC.
        if (onlineTilesLight && map.hasLayer(onlineTilesLight)) map.removeLayer(onlineTilesLight);
        if (offlineTiles && !map.hasLayer(offlineTiles)) offlineTiles.addTo(map);

        map.options.maxBoundsViscosity = 1.0;
        map.setMinZoom(12);
        map.setMaxBounds(WIDE_BOUNDS);
        map.flyToBounds(MAP_BOUNDS.pad(0.08), { duration: 0.6 });
        lockToOfflineBounds();
      }
      applySiteTheme();
    };

    window.addEventListener("online", () => applyConnectivityMode(true));
    window.addEventListener("offline", () => applyConnectivityMode(false));
    applySiteTheme();
  }

  function renderCategoryChips() {
    const cats = [...new Set(allPois.map((p) => p.category))].sort();
    const container = els.catChips;
    container.innerHTML = "";

    const makeChip = (label, active, accentColor, onClick) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-chip";
      btn.textContent = label;
      btn.dataset.active = active ? "true" : "false";
      if (active) {
        if (accentColor) {
          btn.style.borderColor = accentColor;
          btn.style.background = accentColor + "28";
        } else {
          btn.style.borderColor = "rgba(255,45,196,0.65)";
          btn.style.background = "rgba(255,45,196,0.2)";
        }
      }
      btn.addEventListener("click", onClick);
      return btn;
    };

    container.appendChild(
      makeChip("All", selectedCategories.size === 0, null, () => {
        selectedCategories.clear();
        renderCategoryChips();
        renderPoiList();
      })
    );

    cats.forEach((cat) => {
      container.appendChild(
        makeChip(CATEGORY_LABELS[cat] || cat, selectedCategories.has(cat), CATEGORY_COLORS[cat] || "#888", () => {
          if (selectedCategories.has(cat)) selectedCategories.delete(cat);
          else selectedCategories.add(cat);
          renderCategoryChips();
          renderPoiList();
        })
      );
    });
  }

  function filteredPois() {
    const q = (els.poiSearch.value || "").trim().toLowerCase();
    return allPois.filter((p) => {
      if (selectedCategories.size > 0 && !selectedCategories.has(p.category)) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (CATEGORY_LABELS[p.category] || "").toLowerCase().includes(q);
    });
  }

  function syncPoiMarkerVisibility() {
    const visibleIds = new Set(filteredPois().map((p) => p.id));
    allPois.forEach((p) => {
      const mk = poiMarkers.get(p.id);
      if (!mk) return;
      if (visibleIds.has(p.id)) {
        if (!poiLayer.hasLayer(mk)) mk.addTo(poiLayer);
      } else {
        if (poiLayer.hasLayer(mk)) poiLayer.removeLayer(mk);
      }
    });
  }

  function renderPoiList() {
    const list = filteredPois();
    els.poiList.innerHTML = "";
    if (els.venueCount) els.venueCount.textContent = String(list.length);
    list.forEach((p) => {
      const li = document.createElement("li");
      li.className = "pin-item poi-item";
      const active = activeNavTarget && activeNavTarget.kind === "poi" && activeNavTarget.id === p.id;
      li.dataset.active = active ? "true" : "false";
      const col = CATEGORY_COLORS[p.category] || "#888";
      li.innerHTML = `
        <div class="pin-swatch" style="background:${col}"></div>
        <div class="pin-meta">
          <div class="pin-name"></div>
          <div class="pin-ll"></div>
        </div>
        <div class="pin-actions">
          <button type="button" data-a="go">Navigate</button>
          <button type="button" data-a="map">Map</button>
        </div>`;
      li.querySelector(".pin-name").textContent = p.name;
      li.querySelector(".pin-ll").textContent = CATEGORY_LABELS[p.category] || p.category;
      li.querySelector('[data-a="go"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openNavForPoi(p.id);
      });
      li.querySelector('[data-a="map"]').addEventListener("click", (e) => {
        e.stopPropagation();
        const mk = poiMarkers.get(p.id);
        if (mk) flyToAndOpenPopup(mk, 17);
      });
      li.addEventListener("click", () => {
        const mk = poiMarkers.get(p.id);
        if (mk) flyToAndOpenPopup(mk, 16);
      });
      els.poiList.appendChild(li);
    });
    syncPoiMarkerVisibility();
  }

  function buildPoiMarkers() {
    poiLayer.clearLayers();
    poiMarkers.clear();
    allPois.forEach((p) => {
      const ll = uvToLatLng(MAP_BOUNDS, p.u, p.v);
      p.lat = ll.lat;
      p.lng = ll.lng;
      const col = CATEGORY_COLORS[p.category] || "#888";
      const m = L.circleMarker(ll, {
        radius: 6,
        color: "#0a0514",
        weight: 1,
        fillColor: col,
        fillOpacity: 0.92,
      });
      const popupEl = createNavigatePopupEl(p.name, CATEGORY_LABELS[p.category] || p.category || "Venue", () =>
        openNavForPoi(p.id)
      );
      m.bindPopup(popupEl, {
        maxWidth: 300,
        className: "leaflet-popup-nav-shell",
        closeButton: true,
        autoPan: true,
        autoPanPadding: [20, 20],
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        const raw = e.originalEvent;
        if (raw && typeof raw.detail === "number" && raw.detail > 1) return;
        m.openPopup();
      });
      m.bindTooltip(p.name, { sticky: true, direction: "top", opacity: 0.95, className: "poi-tip" });
      m.addTo(poiLayer);
      poiMarkers.set(p.id, m);
    });
  }

  async function loadFestivalPois() {
    try {
      const res = await fetch(POI_DATA_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const raw = data.pois || [];
      allPois = raw.map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        u: row.u,
        v: row.v,
      }));
      buildPoiMarkers();
      renderCategoryChips();
      renderPoiList();
    } catch (err) {
      console.error(err);
      toast("Venue points failed to load — open online once, then retry.");
    }
  }

  function syncMarkersFromPins(pins) {
    pinsLayer.clearLayers();
    leafletMarkers.clear();
    pins.forEach((p) => {
      const m = L.marker([p.lat, p.lng], {
        icon: pinIcon(p.color || PIN_COLORS[0]),
        draggable: true,
      });
      const pinPopupEl = createNavigatePopupEl(p.name, "Meetup pin", () => openNavForPin(p.id));
      m.bindPopup(pinPopupEl, {
        maxWidth: 300,
        className: "leaflet-popup-nav-shell",
        closeButton: true,
        autoPan: true,
        autoPanPadding: [20, 20],
      });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        const raw = e.originalEvent;
        if (raw && typeof raw.detail === "number" && raw.detail > 1) return;
        m.openPopup();
      });
      m.on("dragend", () => {
        const ll = m.getLatLng();
        const list = loadPins();
        const ix = list.findIndex((x) => x.id === p.id);
        if (ix >= 0) {
          list[ix].lat = ll.lat;
          list[ix].lng = ll.lng;
          savePins(list);
          renderPinList();
          toast("Pin location updated");
        }
      });
      m.addTo(pinsLayer);
      leafletMarkers.set(p.id, m);
    });
  }

  function renderPinList() {
    const pins = loadPins();
    els.pinList.innerHTML = "";
    if (els.meetupsCount) els.meetupsCount.textContent = String(pins.length);
    if (els.emptyMeetups) els.emptyMeetups.hidden = pins.length > 0;
    pins.forEach((p) => {
      const li = document.createElement("li");
      li.className = "pin-item";
      const active = activeNavTarget && activeNavTarget.kind === "pin" && activeNavTarget.id === p.id;
      li.dataset.active = active ? "true" : "false";
      li.innerHTML = `
        <div class="pin-swatch" style="background:${p.color || PIN_COLORS[0]}"></div>
        <div class="pin-meta">
          <div class="pin-name"></div>
          <div class="pin-ll"></div>
        </div>
        <div class="pin-actions">
          <button type="button" data-a="go">Navigate</button>
          <button type="button" data-a="del">Delete</button>
        </div>`;
      li.querySelector(".pin-name").textContent = p.name;
      li.querySelector(".pin-ll").textContent = p.lat.toFixed(5) + ", " + p.lng.toFixed(5);
      li.querySelector('[data-a="go"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openNavForPin(p.id);
      });
      li.querySelector('[data-a="del"]').addEventListener("click", (e) => {
        e.stopPropagation();
        openDeletePinConfirm(p.id);
      });
      li.addEventListener("click", () => {
        const mk = leafletMarkers.get(p.id);
        if (mk) flyToAndOpenPopup(mk, 16);
      });
      els.pinList.appendChild(li);
    });
  }

  function removePin(id) {
    const next = loadPins().filter((p) => p.id !== id);
    savePins(next);
    if (activeNavTarget && activeNavTarget.kind === "pin" && activeNavTarget.id === id) closeNav();
    syncMarkersFromPins(next);
    renderPinList();
  }

  function openDeletePinConfirm(id) {
    if (!els.dlgDeletePin || !els.deletePinName) return;
    const p = loadPins().find((x) => x.id === id);
    if (!p) return;
    els.deletePinName.textContent = p.name || "Meetup";
    els.dlgDeletePin.dataset.pinId = id;
    els.dlgDeletePin.showModal();
  }

  function openDeleteScheduleSetConfirm(setId) {
    if (!els.dlgDeleteScheduleSet || !els.deleteScheduleSetName) return;
    const set = allScheduleSets.find((x) => x.id === setId);
    els.deleteScheduleSetName.textContent = (set && set.artist) || "This set";
    els.dlgDeleteScheduleSet.dataset.setId = setId;
    els.dlgDeleteScheduleSet.showModal();
  }

  function openNavTo(target) {
    if (map) map.closePopup();
    const wasClosed = els.navOverlay.dataset.open !== "true";
    activeNavTarget = target;
    els.navOverlay.dataset.open = "true";
    els.navOverlay.setAttribute("aria-hidden", "false");
    els.navTitle.textContent = target.name;
    if (target.kind === "pin") {
      els.navSub.textContent = "Your saved meetup pin";
    } else {
      els.navSub.textContent = (CATEGORY_LABELS[target.category] || target.category || "Venue") + " · festival map";
    }
    if (wasClosed) {
      lastNavMiniMapFitAt = 0;
      try {
        history.pushState({ edc2026Nav: 1 }, "", location.href);
        navHistoryPushed = true;
      } catch (_) {
        navHistoryPushed = false;
      }
      if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === "function") {
        navigator.geolocation.getCurrentPosition(onGeoSuccess, () => {}, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 10000,
        });
      }
    }
    renderPinList();
    renderPoiList();
    if (els.navDebugReadout) els.navDebugReadout.hidden = !navDebugEnabled;
    updateNavReadout();
    if (navInterval) clearInterval(navInterval);
    navInterval = setInterval(() => {
      updateNavReadout();
      updateNavMiniMap();
    }, 90);
    requestAnimationFrame(() => {
      initNavMap();
      updateNavMiniMap();
      if (els.navOverlay.dataset.open === "true") syncNavCompassPanel();
    });
  }

  function openNavForPin(id) {
    const p = loadPins().find((x) => x.id === id);
    if (!p) return;
    openNavTo({ kind: "pin", id: p.id, name: p.name, lat: p.lat, lng: p.lng });
  }

  function openNavForPoi(id) {
    const p = allPois.find((x) => x.id === id);
    if (!p || !Number.isFinite(p.lat)) return;
    openNavTo({ kind: "poi", id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category });
  }

  function closeNav(opts) {
    const fromPop = opts && opts.fromPopstate;
    if (els.navOverlay.dataset.open !== "true") return;
    activeNavTarget = null;
    els.navOverlay.dataset.open = "false";
    els.navOverlay.setAttribute("aria-hidden", "true");
    if (navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }
    if (navReadoutRaf != null) {
      cancelAnimationFrame(navReadoutRaf);
      navReadoutRaf = null;
    }
    lastNavMiniMapFitAt = 0;
    renderPinList();
    renderPoiList();
    if (fromPop) {
      navHistoryPushed = false;
    } else if (navHistoryPushed) {
      navHistoryPushed = false;
      history.back();
    }
    if (els.navRefreshLocation) els.navRefreshLocation.disabled = false;
    if (els.navDebugReadout) els.navDebugReadout.hidden = true;
  }

  /**
   * Heading that can drive the live compass UI: magnetometer / gyro compass
   * (deviceorientation) or GPS-reported course — not a heading inferred only
   * from successive position fixes.
   * Many mobile browsers omit `speed` while still reporting `heading`; only
   * ignore course when speed is known and clearly stationary.
   */
  function navRealtimeHeading() {
    if (typeof compassHeading === "number" && !Number.isNaN(compassHeading)) return compassHeading;
    if (!lastPosition) return null;
    const h = lastPosition.coords.heading;
    if (typeof h !== "number" || Number.isNaN(h) || h < 0) return null;
    const sp = lastPosition.coords.speed;
    if (sp != null && Number.isFinite(sp) && sp <= 0.35) return null;
    return h;
  }

  function buildNavCompassFallbackMessage(hasGps) {
    if (!navigator.geolocation) {
      return "This browser does not support geolocation, so distance and the directional compass cannot run here.";
    }
    if (geoPermissionDenied) {
      return "Location is blocked for this site. Allow location in your browser or system settings, then reload the page if needed.";
    }
    if (!hasGps) {
      return "Waiting for GPS. Allow location if prompted and step into an open area. For the live arrow you will also need motion/orientation (iPhone: turn Compass on below and allow Motion & Orientation when asked) or a GPS course while moving.";
    }
    if (compassMotionPermissionDenied) {
      return "Motion and orientation access was denied. Reload this page, turn Compass on below, and tap Allow when prompted. If there is no prompt, check the browser or site settings for motion/sensor access.";
    }
    if (!window.DeviceOrientationEvent) {
      return "This browser does not expose device orientation, so the compass ring stays hidden. Walk at a moderate pace in a straight line so GPS can report your course when your device supports it.";
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function" && !compassEnabled) {
      return "Turn Compass on below. When Safari asks, allow Motion & Orientation access so the magnetometer-based arrow can appear.";
    }
    if (compassEnabled) {
      return "Direction can come from GPS as you move. Hold the phone flat and turn slowly for sensor heading, or walk in a straight line if the arrow is slow to settle.";
    }
    return "Turn Compass on below (and allow motion if prompted), or walk several meters in a line so GPS can report your heading while you move.";
  }

  function syncNavCompassPanel() {
    if (!els.navCompassLive || !els.navCompassFallback || !els.navCompassFallbackText) return;
    if (els.navOverlay.dataset.open !== "true") return;

    const hasGps = !!(lastPosition && Number.isFinite(lastPosition.coords.latitude));
    // Live ring/arrow only when the Compass switch is on; GPS course alone must not show it.
    const liveH = compassEnabled && hasGps ? navRealtimeHeading() : null;

    if (liveH != null) {
      els.navCompassLive.hidden = false;
      els.navCompassLive.setAttribute("aria-hidden", "false");
      els.navCompassFallback.hidden = true;
      if (els.navCompassRing) els.navCompassRing.style.transform = "rotate(" + (-liveH) + "deg)";
      return;
    }

    if (els.navCompassRing) els.navCompassRing.style.transform = "rotate(0deg)";
    els.navCompassLive.hidden = true;
    els.navCompassLive.setAttribute("aria-hidden", "true");
    els.navCompassFallback.hidden = false;
    els.navCompassFallbackText.textContent = buildNavCompassFallbackMessage(hasGps);
  }

  function updateNavReadout() {
    if (!activeNavTarget) return;
    const here = navEstimatedHere();
    if (!here) {
      els.navDistance.textContent = "—";
      els.navBearing.textContent = "Waiting for GPS…";
      if (els.arrowWrap) els.arrowWrap.style.transform = "rotate(0deg)";
      if (els.navCompassRing) els.navCompassRing.style.transform = "rotate(0deg)";
      els.navHint.textContent = "Enable location and walk into an open area for a faster lock.";
      updateNavDebugReadout(null, NaN, NaN);
      syncNavCompassPanel();
      return;
    }
    const there = { lat: activeNavTarget.lat, lng: activeNavTarget.lng };
    const dist = haversineM(here, there);
    const brg = bearingDeg(here, there);
    els.navDistance.textContent = formatDistNav(dist);
    els.navBearing.textContent = Math.round(brg) + "° · " + cardinal(brg) + " to target";
    updateNavDebugReadout(here, dist, brg);

    const deviceH = compassEnabled ? navRealtimeHeading() : null;
    if (deviceH == null) {
      if (els.arrowWrap) els.arrowWrap.style.transform = "rotate(0deg)";
      if (els.navCompassRing) els.navCompassRing.style.transform = "rotate(0deg)";
      els.navHint.textContent = compassEnabled
        ? "No heading yet — hold the phone flat and turn slowly, or walk in a straight line so GPS can show your course."
        : "Turn Compass on for the live ring and arrow toward your target.";
    } else {
      // Rotate the ring so "N" points to true North, and rotate the arrow by the
      // absolute bearing to target. Net effect on screen: arrow points correctly
      // relative to the device while the compass ring tracks North.
      if (els.navCompassRing) els.navCompassRing.style.transform = "rotate(" + (-deviceH) + "deg)";
      if (els.arrowWrap) els.arrowWrap.style.transform = "rotate(" + brg + "deg)";
      els.navHint.textContent =
        "Hold your phone flat like a compass. Arrow follows your body as you turn — works without mobile data.";
    }
    syncNavCompassPanel();
  }

  function onGeoSuccess(pos) {
    geoPermissionDenied = false;
    if (prevGeoPosition && prevGeoPosition.coords) {
      const prev = prevGeoPosition.coords;
      const dtSec = Math.max(0, (pos.timestamp - prevGeoPosition.timestamp) / 1000);
      if (dtSec >= 0.35 && dtSec <= 8) {
        const prevHere = { lat: prev.latitude, lng: prev.longitude };
        const currHere = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const movedM = haversineM(prevHere, currHere);
        if (movedM >= 0.9) {
          motionHeadingDeg = bearingDeg(prevHere, currHere);
          motionSpeedMps = movedM / dtSec;
          motionUpdatedAtMs = Date.now();
        }
      }
    }
    prevGeoPosition = pos;
    lastPosition = pos;
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    userMarker.setLatLng(ll);
    els.coordStrip.textContent =
      "GPS: " +
      pos.coords.latitude.toFixed(6) +
      ", " +
      pos.coords.longitude.toFixed(6) +
      (pos.coords.accuracy ? " · ±" + Math.round(pos.coords.accuracy) + " m" : "");

    if (els.navOverlay.dataset.open === "true") {
      updateNavReadout();
      updateNavMiniMap();
    }
  }

  function onGeoErr(err) {
    if (err && err.code === 1) geoPermissionDenied = true;
    els.coordStrip.textContent = "GPS error: " + (err && err.message ? err.message : "unknown");
    updateNavDebugReadout(navEstimatedHere(), NaN, NaN);
    if (els.navOverlay.dataset.open === "true") syncNavCompassPanel();
  }

  /** One-shot high-accuracy fix from the nav screen (↻). Reuses watch pipeline via onGeoSuccess. */
  function refreshNavLocationFromButton() {
    if (!els.navRefreshLocation || els.navRefreshLocation.disabled) return;
    if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== "function") {
      toast("Geolocation is not available");
      return;
    }
    if (els.navOverlay.dataset.open !== "true") return;
    els.navRefreshLocation.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (els.navRefreshLocation) els.navRefreshLocation.disabled = false;
        lastNavMiniMapFitAt = 0;
        onGeoSuccess(pos);
      },
      (err) => {
        if (els.navRefreshLocation) els.navRefreshLocation.disabled = false;
        if (err && err.code === 1) toast("Location permission denied");
        else toast("Could not refresh GPS. Try again in an open area.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  }

  function startGeolocation() {
    if (!navigator.geolocation) {
      toast("Geolocation is not available in this browser.");
      return;
    }
    if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoErr, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    });
  }

  function syncCompassToggle(on) {
    if (els.compassToggleNav) els.compassToggleNav.checked = on;
  }

  function enableCompass() {
    const ori = window.DeviceOrientationEvent;
    if (!ori) {
      toast("Device orientation is not available here. Use GPS course while moving if your device reports it.");
      syncCompassToggle(false);
      return;
    }
    const attach = () => {
      compassMotionPermissionDenied = false;
      if (!orientationHooked) {
        window.addEventListener("deviceorientation", onDeviceOrientation, true);
        // Android true-north requires a separate event in many browsers.
        window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
        orientationHooked = true;
      }
      compassEnabled = true;
      syncCompassToggle(true);
      updateNavReadout();
    };
    const maybePromise = ori.requestPermission && ori.requestPermission();
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise
        .then((st) => {
          if (st === "granted") attach();
          else {
            toast("Compass permission denied");
            compassMotionPermissionDenied = true;
            syncCompassToggle(false);
            if (els.navOverlay.dataset.open === "true") syncNavCompassPanel();
          }
        })
        .catch(() => {
          toast("Could not enable compass");
          compassMotionPermissionDenied = true;
          syncCompassToggle(false);
          if (els.navOverlay.dataset.open === "true") syncNavCompassPanel();
        });
    } else {
      attach();
    }
  }

  function disableCompass() {
    if (orientationHooked) {
      window.removeEventListener("deviceorientation", onDeviceOrientation, true);
      window.removeEventListener("deviceorientationabsolute", onDeviceOrientation, true);
      orientationHooked = false;
    }
    compassHeading = null;
    compassEnabled = false;
    syncCompassToggle(false);
    updateNavReadout();
  }

  function initNavMap() {
    if (navMap) {
      navMap.invalidateSize();
      return;
    }
    const WORLD_BOUNDS = L.latLngBounds(L.latLng(-85, -180), L.latLng(85, 180));
    const startOnline = typeof navigator !== "undefined" && navigator.onLine === true;
    navMapOnlineMode = startOnline;

    navMap = L.map("nav-mini-map", {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      keyboard: false,
      maxBounds: startOnline ? WORLD_BOUNDS : WIDE_BOUNDS,
      maxBoundsViscosity: startOnline ? 0 : 1.0,
      minZoom: startOnline ? 2 : 12,
      maxZoom: 19,
    });

    navMapOnlineTilesLight = L.tileLayer(ONLINE_WORLD_TILE_URL, {
      minZoom: 2,
      maxZoom: 20,
      subdomains: "abcd",
    });

    navMapOfflineTiles = L.tileLayer(BASEMAP_TILE_URL, {
      minZoom: 12,
      maxZoom: 19,
      maxNativeZoom: 16,
      minNativeZoom: 12,
      tileSize: 256,
      bounds: WIDE_BOUNDS,
    });

    if (startOnline) {
      navMapOfflineTiles.addTo(navMap);
      applyNavMapOnlineBasemapLayers();
    } else {
      navMapOfflineTiles.addTo(navMap);
    }

    const lockToOfflineBounds = () => {
      if (!navMap) return;
      if (navMapOnlineMode) return;
      try {
        navMap.panInsideBounds(WIDE_BOUNDS, { animate: false });
      } catch (_) {}
    };

    navMap.on("moveend", lockToOfflineBounds);

    const applyConnectivityMode = (isOnline) => {
      if (!navMap) return;
      navMapOnlineMode = !!isOnline;

      if (navMapOnlineMode) {
        navMap.options.maxBoundsViscosity = 0;
        navMap.setMinZoom(2);
        try {
          navMap.setMaxBounds(WORLD_BOUNDS);
        } catch (_) {}

        if (navMapOfflineTiles && !navMap.hasLayer(navMapOfflineTiles)) navMapOfflineTiles.addTo(navMap);
        applyNavMapOnlineBasemapLayers();
      } else {
        if (navMapOnlineTilesLight && navMap.hasLayer(navMapOnlineTilesLight)) navMap.removeLayer(navMapOnlineTilesLight);
        if (navMapOfflineTiles && !navMap.hasLayer(navMapOfflineTiles)) navMapOfflineTiles.addTo(navMap);

        navMap.options.maxBoundsViscosity = 1.0;
        navMap.setMinZoom(12);
        navMap.setMaxBounds(WIDE_BOUNDS);
        lockToOfflineBounds();
      }
    };

    window.addEventListener("online", () => applyConnectivityMode(true));
    window.addEventListener("offline", () => applyConnectivityMode(false));

    navMapUserMk = L.circleMarker(MAP_BOUNDS.getCenter(), {
      radius: 6,
      color: "#fff",
      weight: 2,
      fillColor: "#00f5ff",
      fillOpacity: 1,
    }).addTo(navMap);
    navMapTargetMk = L.circleMarker(MAP_BOUNDS.getCenter(), {
      radius: 8,
      color: "#fff",
      weight: 2,
      fillColor: "#ff2dbe",
      fillOpacity: 1,
    }).addTo(navMap);
    navMapLine = L.polyline([], {
      color: "#ff2dbe",
      weight: 2,
      opacity: 0.75,
      dashArray: "6 5",
    }).addTo(navMap);
  }

  function updateNavMiniMap() {
    if (!navMap || !activeNavTarget) return;
    const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
    const targetLL = L.latLng(activeNavTarget.lat, activeNavTarget.lng);
    navMapTargetMk.setLatLng(targetLL);
    const hereEst = navEstimatedHere();
    if (hereEst) {
      const here = L.latLng(hereEst.lat, hereEst.lng);
      navMapUserMk.setLatLng(here);
      navMapLine.setLatLngs([here, targetLL]);
      if (now - lastNavMiniMapFitAt >= 380) {
        lastNavMiniMapFitAt = now;
        navMap.fitBounds(L.latLngBounds([here, targetLL]).pad(0.35), { animate: false });
      }
    } else {
      navMapUserMk.setLatLng(targetLL);
      navMapLine.setLatLngs([]);
      navMap.setView(targetLL, 17, { animate: false });
      lastNavMiniMapFitAt = now;
    }
    navMap.invalidateSize();
  }

  function addPinAt(latlng, name) {
    const pins = loadPins();
    pins.push({
      id: uid(),
      name: name || "Meetup",
      lat: latlng.lat,
      lng: latlng.lng,
      color: PIN_COLORS[pins.length % PIN_COLORS.length],
      created: Date.now(),
    });
    savePins(pins);
    syncMarkersFromPins(pins);
    renderPinList();
    toast("Pin saved on this device");
  }

  function bytesToBase64Url(u8) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
      bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlToBytes(b64) {
    let norm = String(b64 || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    while (norm.length % 4) norm += "=";
    const bin = atob(norm);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function extractShareB64FromAny(str) {
    if (!str) return null;
    const trimmed = str.trim();
    let b64 = null;
    const hashIdx = trimmed.indexOf("#");
    if (hashIdx >= 0) {
      const frag = trimmed.slice(hashIdx + 1);
      if (frag.startsWith(SHARE_PREFIX)) b64 = frag.slice(SHARE_PREFIX.length);
      else if (frag.startsWith(LEGACY_SHARE_PREFIX)) b64 = frag.slice(LEGACY_SHARE_PREFIX.length);
    }
    if (!b64 && trimmed.startsWith(SHARE_PREFIX)) b64 = trimmed.slice(SHARE_PREFIX.length);
    if (!b64 && trimmed.startsWith(LEGACY_SHARE_PREFIX)) b64 = trimmed.slice(LEGACY_SHARE_PREFIX.length);
    if (!b64) {
      const m = trimmed.match(/[?&#]m=([^&]+)/);
      if (m) b64 = decodeURIComponent(m[1]);
    }
    if (!b64) {
      const m2 = trimmed.match(/[?&#]share=([^&]+)/);
      if (m2) b64 = decodeURIComponent(m2[1]);
    }
    return b64 || null;
  }

  function extractScheduleShareB64FromAny(str) {
    if (!str) return null;
    const trimmed = str.trim();
    let b64 = null;
    const hashIdx = trimmed.indexOf("#");
    if (hashIdx >= 0) {
      const frag = trimmed.slice(hashIdx + 1);
      if (frag.startsWith(SCHEDULE_SHARE_PREFIX)) b64 = frag.slice(SCHEDULE_SHARE_PREFIX.length);
    }
    if (!b64 && trimmed.startsWith(SCHEDULE_SHARE_PREFIX)) b64 = trimmed.slice(SCHEDULE_SHARE_PREFIX.length);
    if (!b64) {
      const m = trimmed.match(/[?&#]sch=([^&]+)/);
      if (m) b64 = decodeURIComponent(m[1]);
    }
    return b64 || null;
  }

  function pinsToWireV3(pins) {
    return pins.map((p, i) => {
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return [normalizeMeetupName(p.name || "Meetup").slice(0, 80), 0, 0, i % PIN_COLORS.length];
      }
      let ci = PIN_COLORS.indexOf(p.color);
      if (ci < 0) ci = i % PIN_COLORS.length;
      return [normalizeMeetupName(p.name || "Meetup").slice(0, 80), Math.round(lat * 1e6), Math.round(lng * 1e6), ci];
    });
  }

  function decodeShareDataToPins(data) {
    if (!data) return null;
    if (data.v === 1 && Array.isArray(data.pins)) return data.pins;
    if (data.v === 3 && Array.isArray(data.p)) {
      const out = [];
      data.p.forEach((row, i) => {
        if (!Array.isArray(row) || row.length < 4) return;
        const name = normalizeMeetupName(row[0] || "Meetup");
        const la = Number(row[1]);
        const lo = Number(row[2]);
        const ci = Number(row[3]);
        if (!Number.isFinite(la) || !Number.isFinite(lo)) return;
        const color = PIN_COLORS[(((Number.isFinite(ci) ? ci : i) % PIN_COLORS.length) + PIN_COLORS.length) % PIN_COLORS.length];
        out.push({
          id: uid(),
          name,
          lat: la / 1e6,
          lng: lo / 1e6,
          color,
        });
      });
      return out.length ? out : null;
    }
    return null;
  }

  function decodeScheduleShareData(data) {
    if (!data) return null;
    if (data.v === 1 && Array.isArray(data.s)) {
      const out = data.s.map(String).filter((id) => id && id.length > 0 && id.length < 200);
      return out.length ? out : null;
    }
    return null;
  }

  async function decodeUrlSafeB64ToJson(b64) {
    if (!b64) return null;
    let bytes;
    try {
      bytes = base64UrlToBytes(b64);
    } catch {
      return null;
    }
    if (!bytes || !bytes.length) return null;
    let jsonStr;
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      if (typeof DecompressionStream === "undefined") return null;
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
        const out = await new Response(stream).arrayBuffer();
        jsonStr = new TextDecoder().decode(out);
      } catch {
        return null;
      }
    } else {
      jsonStr = new TextDecoder().decode(bytes);
    }
    try {
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  }

  async function extractSharePayload(str) {
    const b64 = extractShareB64FromAny(str);
    const data = await decodeUrlSafeB64ToJson(b64);
    return decodeShareDataToPins(data);
  }

  async function extractScheduleSharePayload(str) {
    const b64 = extractScheduleShareB64FromAny(str);
    const data = await decodeUrlSafeB64ToJson(b64);
    return decodeScheduleShareData(data);
  }

  async function encodeShareTokenAsync(pins) {
    const compact = { v: 3, p: pinsToWireV3(pins) };
    const json = JSON.stringify(compact);
    const utf8 = new TextEncoder().encode(json);
    if (typeof CompressionStream === "undefined" || utf8.length < 140) return bytesToBase64Url(utf8);
    try {
      const stream = new Blob([utf8]).stream().pipeThrough(new CompressionStream("gzip"));
      const gzBuf = await new Response(stream).arrayBuffer();
      const gz = new Uint8Array(gzBuf);
      if (gz.length + 28 < utf8.length) return bytesToBase64Url(gz);
    } catch (_) {}
    return bytesToBase64Url(utf8);
  }

  function shareUrlBase() {
    const u = new URL(location.href);
    u.hash = "";
    u.search = "";
    let path = u.pathname;
    if (!path.endsWith("/")) {
      const last = path.split("/").pop() || "";
      if (last.includes(".")) path = path.slice(0, path.lastIndexOf("/") + 1) || "/";
    }
    if (!path.endsWith("/")) path += "/";
    u.pathname = path;
    return u.href;
  }

  async function buildShareUrl() {
    const base =
      location.origin && location.origin !== "null"
        ? shareUrlBase()
        : location.pathname.split("/").pop() === "index.html"
          ? location.pathname
          : location.pathname.replace(/\/?$/, "/index.html");
    const token = await encodeShareTokenAsync(loadPins());
    return base + "#" + SHARE_PREFIX + token;
  }

  async function encodeScheduleShareTokenAsync(setIds) {
    const unique = [...new Set((setIds || []).map(String))]
      .filter((id) => id && id.length < 200)
      .sort();
    const compact = { v: 1, s: unique };
    const json = JSON.stringify(compact);
    const utf8 = new TextEncoder().encode(json);
    if (typeof CompressionStream === "undefined" || utf8.length < 140) return bytesToBase64Url(utf8);
    try {
      const stream = new Blob([utf8]).stream().pipeThrough(new CompressionStream("gzip"));
      const gzBuf = await new Response(stream).arrayBuffer();
      const gz = new Uint8Array(gzBuf);
      if (gz.length + 28 < utf8.length) return bytesToBase64Url(gz);
    } catch (_) {}
    return bytesToBase64Url(utf8);
  }

  async function buildScheduleShareUrl() {
    const base =
      location.origin && location.origin !== "null"
        ? shareUrlBase()
        : location.pathname.split("/").pop() === "index.html"
          ? location.pathname
          : location.pathname.replace(/\/?$/, "/index.html");
    const ids = Array.from(selectedScheduleSetIds);
    const token = await encodeScheduleShareTokenAsync(ids);
    return base + "#" + SCHEDULE_SHARE_PREFIX + token;
  }

  function normalizeMeetupName(name) {
    return String(name || "Meetup")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
  }

  /** Same name + same coordinates (6 dp) counts as one meetup for import deduping. */
  function meetupDedupeKey(p) {
    const name = normalizeMeetupName(p.name);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return name + "\0" + lat.toFixed(6) + "\0" + lng.toFixed(6);
  }

  function dedupePinsByMeetupIdentity(pins) {
    const seen = new Set();
    const out = [];
    pins.forEach((p) => {
      const k = meetupDedupeKey(p);
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(p);
    });
    return out;
  }

  function importPinsFromPayload(payload, mode) {
    if (!payload || !payload.length) {
      toast("No pins found in that link");
      return;
    }
    const cleaned = payload.map((x, i) => ({
      id: x.id && String(x.id).length < 200 ? x.id : uid(),
      name: normalizeMeetupName(x.name || "Meetup"),
      lat: Number(x.lat),
      lng: Number(x.lng),
      color: x.color || PIN_COLORS[i % PIN_COLORS.length],
      created: Date.now(),
    }));
    const bad = cleaned.some((p) => !Number.isFinite(p.lat) || !Number.isFinite(p.lng));
    if (bad) {
      toast("Invalid pin data");
      return;
    }
    let next;
    if (mode === "replace") {
      next = dedupePinsByMeetupIdentity(cleaned);
    } else {
      const existing = loadPins();
      const sig = new Set();
      existing.forEach((p) => {
        const k = meetupDedupeKey(p);
        if (k) sig.add(k);
      });
      const toAdd = [];
      cleaned.forEach((p) => {
        const k = meetupDedupeKey(p);
        if (!k || sig.has(k)) return;
        sig.add(k);
        toAdd.push(p);
      });
      const existingIds = new Set(existing.map((p) => p.id));
      toAdd.forEach((p) => {
        while (existingIds.has(p.id)) {
          p.id = uid();
        }
        existingIds.add(p.id);
      });
      next = existing.concat(toAdd);
    }
    savePins(next);
    syncMarkersFromPins(next);
    renderPinList();
    toast(mode === "replace" ? "Replaced with imported pins" : "Merged imported pins");
    history.replaceState(null, "", location.pathname + location.search);
  }

  function importScheduleFromPayload(rawIds, mode) {
    const valid = new Set((allScheduleSets || []).map((s) => s.id));
    const cleaned = [...new Set((rawIds || []).map(String))].filter((id) => id && id.length < 200 && valid.has(id));
    if (!cleaned.length) {
      toast("No matching sets in that link for this schedule");
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    if (mode === "replace") {
      selectedScheduleSetIds.clear();
      cleaned.forEach((id) => selectedScheduleSetIds.add(id));
    } else {
      cleaned.forEach((id) => selectedScheduleSetIds.add(id));
    }
    saveScheduleSelection();
    renderScheduleTab();
    toast(mode === "replace" ? "Replaced with imported schedule" : "Merged schedule sets");
    history.replaceState(null, "", location.pathname + location.search);
  }

  async function tryConsumeHashImport() {
    const h = location.hash;
    if (!h || (!h.includes(SHARE_PREFIX) && !h.includes(LEGACY_SHARE_PREFIX))) return;
    const pins = await extractSharePayload(h);
    if (!pins || !pins.length) return;
    const ok = window.confirm("This link includes " + pins.length + " meetup pin(s). Merge into your saved pins?");
    if (ok) importPinsFromPayload(pins, "merge");
    else history.replaceState(null, "", location.pathname + location.search);
  }

  async function tryConsumeScheduleHashImport() {
    const h = location.hash;
    if (!h || !h.includes(SCHEDULE_SHARE_PREFIX)) return;
    const ids = await extractScheduleSharePayload(h);
    if (!ids || !ids.length) return;
    const ok = window.confirm(
      "This link includes " + ids.length + " saved set(s). Merge them into your schedule on this device?"
    );
    if (ok) {
      importScheduleFromPayload(ids, "merge");
      setSheetTab("schedule");
    } else history.replaceState(null, "", location.pathname + location.search);
  }

  function setSheetTab(which) {
    const isMeet = which === "meetups";
    const isVenue = which === "venue";
    const isSchedule = which === "schedule";
    els.tabMeetups.setAttribute("aria-selected", isMeet ? "true" : "false");
    els.tabVenue.setAttribute("aria-selected", isVenue ? "true" : "false");
    if (els.tabSchedule) els.tabSchedule.setAttribute("aria-selected", isSchedule ? "true" : "false");
    els.panelMeetups.hidden = !isMeet;
    els.panelVenue.hidden = !isVenue;
    if (els.panelSchedule) els.panelSchedule.hidden = !isSchedule;
  }

  function clampPanelPx(px) {
    // Keep enough room so the attribution footer can't overlap the panel content
    // when the user drags the splitter to maximize the map.
    const baseMin = 140;
    let min = baseMin;
    if (els.sheet) {
      const tabs = els.sheet.querySelector(".sheet-tabs");
      const footer = els.sheet.querySelector(".map-attribution");
      const tabsH = tabs && tabs instanceof HTMLElement ? tabs.offsetHeight : 0;
      const footerH = footer && footer instanceof HTMLElement ? footer.offsetHeight : 0;
      const minPanelContent = 140; // enough to show at least a couple rows + avoid visual collision
      min = Math.max(baseMin, tabsH + footerH + minPanelContent);
    }

    const max = Math.floor(window.innerHeight * 0.72);
    return Math.max(min, Math.min(max, px));
  }

  function applyStoredPanelHeight() {
    if (!els.sheet) return;
    const raw = localStorage.getItem(SPLIT_PX_KEY);
    let px = raw ? parseInt(raw, 10) : 240;
    if (Number.isNaN(px)) px = 240;
    els.sheet.style.height = clampPanelPx(px) + "px";
    if (map) requestAnimationFrame(() => map.invalidateSize());
  }

  function onWindowResizePanel() {
    if (!els.sheet) return;
    els.sheet.style.height = clampPanelPx(els.sheet.offsetHeight) + "px";
    if (map) map.invalidateSize();
  }

  function wireSplitter() {
    const sp = els.splitter;
    if (!sp || !els.sheet) return;
    let drag = null;
    sp.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      drag = { y0: e.clientY, h0: els.sheet.offsetHeight };
      sp.setPointerCapture(e.pointerId);
    });
    sp.addEventListener("pointermove", (e) => {
      if (!drag) return;
      // Dragging down (clientY increases) shrinks the bottom sheet → more map.
      const nh = drag.h0 - (e.clientY - drag.y0);
      els.sheet.style.height = clampPanelPx(nh) + "px";
      if (map) map.invalidateSize();
    });
    function finish(e) {
      if (drag && els.sheet) localStorage.setItem(SPLIT_PX_KEY, String(els.sheet.offsetHeight));
      drag = null;
      try {
        if (e && sp.hasPointerCapture(e.pointerId)) sp.releasePointerCapture(e.pointerId);
      } catch (_) {}
      if (map) map.invalidateSize();
    }
    sp.addEventListener("pointerup", finish);
    sp.addEventListener("pointercancel", finish);
    sp.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const cur = els.sheet.offsetHeight;
        const step = e.shiftKey ? 40 : 12;
        // ArrowDown = more map (smaller sheet), ArrowUp = more list (larger sheet)
        const next = clampPanelPx(cur + (e.key === "ArrowDown" ? -step : step));
        els.sheet.style.height = next + "px";
        localStorage.setItem(SPLIT_PX_KEY, String(next));
        if (map) map.invalidateSize();
        e.preventDefault();
      }
    });
  }

  function wireUi() {
    els.tabMeetups.addEventListener("click", () => setSheetTab("meetups"));
    els.tabVenue.addEventListener("click", () => setSheetTab("venue"));
    if (els.tabSchedule) els.tabSchedule.addEventListener("click", () => setSheetTab("schedule"));

    els.poiSearch.addEventListener("input", () => renderPoiList());
    if (els.scheduleSearch) els.scheduleSearch.addEventListener("input", () => renderScheduleTab());
    if (els.scheduleSelectedOnly) els.scheduleSelectedOnly.addEventListener("change", () => renderScheduleTab());
    if (els.scheduleDay) els.scheduleDay.addEventListener("change", () => renderScheduleTab());
    if (els.scheduleStage) els.scheduleStage.addEventListener("change", () => renderScheduleTab());
    if (els.scheduleGenre) els.scheduleGenre.addEventListener("change", () => renderScheduleTab());

    const doCenter = () => {
      if (userMarker) map.flyTo(userMarker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.5 });
      startGeolocation();
    };
    els.btnCenter.addEventListener("click", doCenter);
    if (els.btnCenterFloat) els.btnCenterFloat.addEventListener("click", doCenter);
    if (els.btnEdcFloat) {
      els.btnEdcFloat.addEventListener("click", () => {
        if (!map) return;
        map.flyToBounds(MAP_BOUNDS.pad(0.08), { duration: 0.55 });
      });
    }

    if (els.siteThemeToggle) {
      els.siteThemeToggle.addEventListener("change", (e) => {
        siteThemeIsDark = !!e.target.checked;
        saveSiteThemePreference(siteThemeIsDark);
        applySiteTheme();
      });
    }

    window.addEventListener("beforeinstallprompt", (e) => {
      // Chromium on Android: capture the event so we can prompt on user gesture.
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    if (els.installLink) {
      els.installLink.addEventListener("click", async (e) => {
        if (!deferredInstallPrompt) return; // Fall back to install.html via normal navigation
        e.preventDefault();
        try {
          await deferredInstallPrompt.prompt();
          await deferredInstallPrompt.userChoice;
        } catch (_) {}
        deferredInstallPrompt = null;
      });
    }

    const openPinNameDialog = (lat, lng, hint) => {
      els.inpName.value = "";
      els.dlgName.dataset.lat = String(lat);
      els.dlgName.dataset.lng = String(lng);
      els.pinHint.textContent = hint;
      els.dlgName.showModal();
      els.inpName.focus();
    };

    /** Close POI/pin popups when the user interacts with the map outside the popup. */
    map.on("click", () => {
      if (map) map.closePopup();
    });

    const mapContainer = map.getContainer();
    const MEETUP_HOLD_MS = 1000;
    const MEETUP_MOVE_CANCEL_PX = 14;
    /** @type {{ pointerId: number, x0: number, y0: number, ll: L.LatLng, timer: ReturnType<typeof setTimeout> } | null} */
    let meetupPress = null;

    function cancelMeetupPress() {
      if (meetupPress && meetupPress.timer) clearTimeout(meetupPress.timer);
      meetupPress = null;
    }

    function ignoreMeetupPointerTarget(t) {
      if (!t || typeof t.closest !== "function") return false;
      if (t.closest(".leaflet-popup")) return true;
      if (t.closest(".leaflet-control")) return true;
      if (t.closest(".leaflet-interactive")) return true;
      if (t.closest(".map-float")) return true;
      return false;
    }

    mapContainer.addEventListener(
      "touchstart",
      (ev) => {
        if (els.navOverlay && els.navOverlay.dataset.open === "true") return;
        const t = ev.target;
        if (ignoreMeetupPointerTarget(t)) return;
        map.closePopup();
      },
      { passive: true }
    );

    mapContainer.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      if (els.navOverlay && els.navOverlay.dataset.open === "true") return;
      if (ignoreMeetupPointerTarget(ev.target)) return;
      const raw = ev;
      if (raw && typeof raw.detail === "number" && raw.detail > 1) return;

      cancelMeetupPress();
      const r = mapContainer.getBoundingClientRect();
      const x = ev.clientX - r.left - (mapContainer.clientLeft || 0);
      const y = ev.clientY - r.top - (mapContainer.clientTop || 0);
      const ll = map.containerPointToLatLng(L.point(x, y));

      meetupPress = {
        pointerId: ev.pointerId,
        x0: ev.clientX,
        y0: ev.clientY,
        ll,
        timer: setTimeout(() => {
          if (!meetupPress || !meetupPress.ll) return;
          const held = meetupPress.ll;
          meetupPress.timer = null;
          meetupPress = null;
          if (els.navOverlay && els.navOverlay.dataset.open === "true") return;
          map.closePopup();
          openPinNameDialog(held.lat, held.lng, "Press and hold on the map to drop a pin at this spot.");
        }, MEETUP_HOLD_MS),
      };
    });

    mapContainer.addEventListener("pointermove", (ev) => {
      if (!meetupPress || meetupPress.pointerId !== ev.pointerId) return;
      const dx = ev.clientX - meetupPress.x0;
      const dy = ev.clientY - meetupPress.y0;
      if (dx * dx + dy * dy > MEETUP_MOVE_CANCEL_PX * MEETUP_MOVE_CANCEL_PX) cancelMeetupPress();
    });

    function endMeetupPointer(ev) {
      if (!meetupPress || meetupPress.pointerId !== ev.pointerId) return;
      if (meetupPress.timer) clearTimeout(meetupPress.timer);
      meetupPress = null;
    }
    mapContainer.addEventListener("pointerup", endMeetupPointer);
    mapContainer.addEventListener("pointercancel", endMeetupPointer);

    const doPinAtCenter = () => {
      if (!map) return;
      const ll = map.getCenter();
      openPinNameDialog(
        ll.lat,
        ll.lng,
        "Placed at map center — pan first if needed, or press and hold on the map to choose an exact spot."
      );
    };
    els.btnPin.addEventListener("click", doPinAtCenter);

    els.nameCancel.addEventListener("click", () => els.dlgName.close());

    els.formName.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = els.inpName.value.trim() || "Meetup";
      const lat = Number(els.dlgName.dataset.lat);
      const lng = Number(els.dlgName.dataset.lng);
      els.dlgName.close();
      addPinAt({ lat, lng }, name);
    });

    if (els.deletePinCancel && els.dlgDeletePin) {
      els.deletePinCancel.addEventListener("click", () => els.dlgDeletePin.close());
    }
    if (els.deletePinConfirm && els.dlgDeletePin) {
      els.deletePinConfirm.addEventListener("click", () => {
        const id = els.dlgDeletePin.dataset.pinId;
        els.dlgDeletePin.close();
        if (id) removePin(id);
      });
    }

    if (els.deleteScheduleSetCancel && els.dlgDeleteScheduleSet) {
      els.deleteScheduleSetCancel.addEventListener("click", () => els.dlgDeleteScheduleSet.close());
    }
    if (els.deleteScheduleSetConfirm && els.dlgDeleteScheduleSet) {
      els.deleteScheduleSetConfirm.addEventListener("click", () => {
        const id = els.dlgDeleteScheduleSet.dataset.setId;
        els.dlgDeleteScheduleSet.close();
        if (id) toggleScheduleSelection(id);
      });
    }

    els.btnShare.addEventListener("click", async () => {
      const pins = loadPins();
      if (!pins.length) {
        toast("Add at least one pin before sharing");
        return;
      }
      els.inpShareUrl.value = "…";
      els.dlgShare.showModal();
      try {
        els.inpShareUrl.value = await buildShareUrl();
      } catch {
        els.inpShareUrl.value = "";
        toast("Could not build share link");
      }
    });

    els.btnCopyLink.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(els.inpShareUrl.value);
        toast("Link copied");
      } catch {
        els.inpShareUrl.select();
        document.execCommand("copy");
        toast("Link copied");
      }
    });

    els.btnSystemShare.addEventListener("click", async () => {
      const url = els.inpShareUrl.value;
      if (navigator.share) {
        try {
          await navigator.share({ title: "EDC 2026 meetups", text: "Offline meetup pins for EDC Vegas 2026", url });
        } catch {
          /* user cancelled */
        }
      } else {
        toast("Use Copy link on this device");
      }
    });

    els.shareClose.addEventListener("click", () => els.dlgShare.close());

    els.btnImport.addEventListener("click", () => {
      els.inpImport.value = "";
      els.dlgImport.showModal();
    });

    els.importCancel.addEventListener("click", () => els.dlgImport.close());

    els.formImport.addEventListener("submit", async (e) => {
      e.preventDefault();
      const sub = e.submitter;
      const mode = sub && sub.value === "replace" ? "replace" : "merge";
      let pins;
      try {
        pins = await extractSharePayload(els.inpImport.value);
      } catch {
        pins = null;
      }
      if (pins) {
        if (mode === "replace") {
          importReplacePendingPins = pins;
          if (els.dlgImportReplace) els.dlgImportReplace.showModal();
          return;
        }
        importPinsFromPayload(pins, mode);
      } else toast("Could not read pins from that text");
      els.dlgImport.close();
    });

    if (els.importReplaceCancel && els.dlgImportReplace) {
      els.importReplaceCancel.addEventListener("click", () => {
        importReplacePendingPins = null;
        els.dlgImportReplace.close();
      });
    }
    if (els.importReplaceConfirm && els.dlgImportReplace) {
      els.importReplaceConfirm.addEventListener("click", () => {
        const pending = importReplacePendingPins;
        importReplacePendingPins = null;
        els.dlgImportReplace.close();
        if (pending && pending.length) importPinsFromPayload(pending, "replace");
        els.dlgImport.close();
      });
    }
    if (els.dlgImport) {
      els.dlgImport.addEventListener("close", () => {
        if (els.dlgImportReplace && els.dlgImportReplace.open) els.dlgImportReplace.close();
        importReplacePendingPins = null;
      });
    }

    if (els.btnScheduleShare) {
      els.btnScheduleShare.addEventListener("click", async () => {
        if (!selectedScheduleSetIds.size) {
          toast("Save at least one set before sharing");
          return;
        }
        if (els.inpShareScheduleUrl) els.inpShareScheduleUrl.value = "…";
        if (els.dlgShareSchedule) els.dlgShareSchedule.showModal();
        try {
          if (els.inpShareScheduleUrl) els.inpShareScheduleUrl.value = await buildScheduleShareUrl();
        } catch {
          if (els.inpShareScheduleUrl) els.inpShareScheduleUrl.value = "";
          toast("Could not build schedule link");
        }
      });
    }
    if (els.btnCopyScheduleLink && els.inpShareScheduleUrl) {
      els.btnCopyScheduleLink.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(els.inpShareScheduleUrl.value);
          toast("Link copied");
        } catch {
          els.inpShareScheduleUrl.select();
          document.execCommand("copy");
          toast("Link copied");
        }
      });
    }
    if (els.btnSystemShareSchedule && els.inpShareScheduleUrl) {
      els.btnSystemShareSchedule.addEventListener("click", async () => {
        const url = els.inpShareScheduleUrl.value;
        if (navigator.share) {
          try {
            await navigator.share({
              title: "EDC 2026 schedule",
              text: "Saved sets for EDC Las Vegas 2026",
              url,
            });
          } catch {
            /* user cancelled */
          }
        } else {
          toast("Use Copy link on this device");
        }
      });
    }
    if (els.scheduleShareClose && els.dlgShareSchedule) {
      els.scheduleShareClose.addEventListener("click", () => els.dlgShareSchedule.close());
    }

    if (els.btnScheduleImport) {
      els.btnScheduleImport.addEventListener("click", () => {
        if (els.inpImportSchedule) els.inpImportSchedule.value = "";
        if (els.dlgImportSchedule) els.dlgImportSchedule.showModal();
      });
    }
    if (els.importScheduleCancel && els.dlgImportSchedule) {
      els.importScheduleCancel.addEventListener("click", () => els.dlgImportSchedule.close());
    }
    if (els.formImportSchedule) {
      els.formImportSchedule.addEventListener("submit", async (e) => {
        e.preventDefault();
        const sub = e.submitter;
        const mode = sub && sub.value === "replace" ? "replace" : "merge";
        let ids;
        try {
          ids = await extractScheduleSharePayload(els.inpImportSchedule ? els.inpImportSchedule.value : "");
        } catch {
          ids = null;
        }
        if (ids && ids.length) {
          if (mode === "replace") {
            importReplacePendingScheduleIds = ids;
            if (els.dlgImportReplaceSchedule) els.dlgImportReplaceSchedule.showModal();
            return;
          }
          importScheduleFromPayload(ids, mode);
        } else toast("Could not read schedule from that text");
        if (els.dlgImportSchedule) els.dlgImportSchedule.close();
      });
    }
    if (els.importReplaceScheduleCancel && els.dlgImportReplaceSchedule) {
      els.importReplaceScheduleCancel.addEventListener("click", () => {
        importReplacePendingScheduleIds = null;
        els.dlgImportReplaceSchedule.close();
      });
    }
    if (els.importReplaceScheduleConfirm && els.dlgImportReplaceSchedule) {
      els.importReplaceScheduleConfirm.addEventListener("click", () => {
        const pending = importReplacePendingScheduleIds;
        importReplacePendingScheduleIds = null;
        els.dlgImportReplaceSchedule.close();
        if (pending && pending.length) importScheduleFromPayload(pending, "replace");
        if (els.dlgImportSchedule) els.dlgImportSchedule.close();
      });
    }
    if (els.dlgImportSchedule) {
      els.dlgImportSchedule.addEventListener("close", () => {
        if (els.dlgImportReplaceSchedule && els.dlgImportReplaceSchedule.open) els.dlgImportReplaceSchedule.close();
        importReplacePendingScheduleIds = null;
      });
    }

    if (els.compassToggleNav) {
      els.compassToggleNav.addEventListener("change", (e) => {
        if (e.target.checked) enableCompass();
        else disableCompass();
      });
    }

    els.navClose.addEventListener("click", () => closeNav());
    if (els.navDebugToggle) {
      setNavDebugEnabled(false);
      els.navDebugToggle.addEventListener("click", () => {
        setNavDebugEnabled(!navDebugEnabled);
        updateNavReadout();
      });
    }
    if (els.navRefreshLocation) els.navRefreshLocation.addEventListener("click", () => refreshNavLocationFromButton());
    els.navMap.addEventListener("click", () => {
      if (!activeNavTarget) return;
      const kind = activeNavTarget.kind;
      const id = activeNavTarget.id;
      closeNav();
      if (kind === "pin") {
        const mk = leafletMarkers.get(id);
        if (mk) flyToAndOpenPopup(mk, 17);
      } else {
        const mk = poiMarkers.get(id);
        if (mk) flyToAndOpenPopup(mk, 18);
      }
    });

    wireSplitter();
    window.addEventListener("resize", onWindowResizePanel);

    window.addEventListener("popstate", () => {
      if (els.navOverlay && els.navOverlay.dataset.open === "true") closeNav({ fromPopstate: true });
    });
  }

  async function boot() {
    applyStoredPanelHeight();
    initMap();
    registerSw();
    refreshFooterCacheVersion();
    loadScheduleSelection();
    wireUi();
    renderScheduleTab();
    setOnlineOfflineTitle();
    window.addEventListener("online", setOnlineOfflineTitle);
    window.addEventListener("offline", setOnlineOfflineTitle);

    L.Icon.Default.mergeOptions({
      iconRetinaUrl: asset("vendor/leaflet/images/marker-icon-2x.png"),
      iconUrl: asset("vendor/leaflet/images/marker-icon.png"),
      shadowUrl: asset("vendor/leaflet/images/marker-shadow.png"),
    });

    const pins = loadPins();
    syncMarkersFromPins(pins);
    renderPinList();
    startGeolocation();
    await tryConsumeHashImport();
    await loadFestivalPois();
    await loadFestivalSchedule();
    await tryConsumeScheduleHashImport();
    if (map) map.invalidateSize();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
