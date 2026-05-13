(function () {
  "use strict";

  const STORAGE_KEY = "edc2026_pins_v1";
  const SHARE_PREFIX = "share=";
  const POI_DATA_URL = "/data/festival-pois.json";
  const OSM_TILE_URL = "/tiles/{z}/{x}/{y}.png";

  /** LVMS infield center; north–south span chosen so 1080×1350 map matches tri-oval infield scale (approximate). */
  const MAP_CENTER = { lat: 36.27225, lng: -115.01145 };
  const MAP_NS_METERS = 1220;
  const MAP_IMG_ASPECT = 1080 / 1350;

  function buildMapBounds() {
    const R = 111320;
    const dLat = MAP_NS_METERS / R;
    const cos = Math.cos((MAP_CENTER.lat * Math.PI) / 180);
    const dLng = (MAP_NS_METERS * MAP_IMG_ASPECT) / (R * cos);
    return L.latLngBounds(
      [MAP_CENTER.lat - dLat / 2, MAP_CENTER.lng - dLng / 2],
      [MAP_CENTER.lat + dLat / 2, MAP_CENTER.lng + dLng / 2]
    );
  }

  const MAP_BOUNDS = buildMapBounds();

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

  const els = {
    map: document.getElementById("map"),
    offlineBadge: document.getElementById("offline-badge"),
    coordStrip: document.getElementById("coord-strip"),
    pinList: document.getElementById("pin-list"),
    btnCenter: document.getElementById("btn-center"),
    btnPin: document.getElementById("btn-pin"),
    btnShare: document.getElementById("btn-share"),
    btnImport: document.getElementById("btn-import"),
    btnCompass: document.getElementById("btn-compass"),
    btnCenterFloat: document.getElementById("btn-center-float"),
    btnPinFloat: document.getElementById("btn-pin-float"),
    sheet: document.getElementById("main-sheet"),
    sheetHandle: document.getElementById("sheet-handle"),
    navOverlay: document.getElementById("nav-overlay"),
    navClose: document.getElementById("nav-close"),
    navMap: document.getElementById("nav-map"),
    navTitle: document.getElementById("nav-title"),
    navSub: document.getElementById("nav-sub"),
    navDistance: document.getElementById("nav-distance"),
    navBearing: document.getElementById("nav-bearing"),
    navHint: document.getElementById("nav-hint"),
    arrowWrap: document.getElementById("arrow-wrap"),
    dlgName: document.getElementById("dlg-name"),
    inpName: document.getElementById("inp-name"),
    pinHint: document.getElementById("pin-hint"),
    nameCancel: document.getElementById("name-cancel"),
    formName: document.getElementById("form-name"),
    dlgShare: document.getElementById("dlg-share"),
    inpShareUrl: document.getElementById("inp-share-url"),
    btnCopyLink: document.getElementById("btn-copy-link"),
    btnSystemShare: document.getElementById("btn-system-share"),
    shareClose: document.getElementById("share-close"),
    dlgImport: document.getElementById("dlg-import"),
    inpImport: document.getElementById("inp-import"),
    importCancel: document.getElementById("import-cancel"),
    formImport: document.getElementById("form-import"),
    toast: document.getElementById("toast"),
    tabMeetups: document.getElementById("tab-meetups"),
    tabVenue: document.getElementById("tab-venue"),
    panelMeetups: document.getElementById("panel-meetups"),
    panelVenue: document.getElementById("panel-venue"),
    poiSearch: document.getElementById("poi-search"),
    poiCat: document.getElementById("poi-cat"),
    poiList: document.getElementById("poi-list"),
  };

  let map;
  let userMarker;
  let pinsLayer;
  let poiLayer;
  const leafletMarkers = new Map();
  const poiMarkers = new Map();
  let allPois = [];
  let lastPosition = null;
  let lastHeadingFromMotion = null;
  let compassHeading = null;
  /** @type {{ kind: 'pin'|'poi', id: string, name: string, lat: number, lng: number, category?: string } | null} */
  let activeNavTarget = null;
  let geoWatchId = null;
  let navInterval = null;
  let orientationHooked = false;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "p-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  function uvToLatLng(bounds, u, v) {
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    const west = bounds.getWest();
    const east = bounds.getEast();
    const lat = north - v * (north - south);
    const lng = west + u * (east - west);
    return L.latLng(lat, lng);
  }

  function onDeviceOrientation(e) {
    if (typeof e.webkitCompassHeading === "number") {
      compassHeading = e.webkitCompassHeading;
    } else if (e.absolute === true && typeof e.alpha === "number") {
      compassHeading = e.alpha;
    }
    if (els.navOverlay.dataset.open === "true") updateNavReadout();
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

  function formatDist(m) {
    if (m < 1000) return Math.round(m) + " m";
    return (m / 1000).toFixed(2) + " km";
  }

  function cardinal(deg) {
    const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW", "N"];
    return dirs[Math.round(deg / 45) % 8];
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

  function registerSw() {
    if (!("serviceWorker" in navigator)) {
      setOfflineBadge("basic");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
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

  function initMap() {
    map = L.map(els.map, {
      maxBounds: MAP_BOUNDS.pad(0.55),
      zoomControl: true,
      attributionControl: true,
      minZoom: 14,
      maxZoom: 19,
    });

    L.tileLayer(OSM_TILE_URL, {
      minZoom: 14,
      maxZoom: 19,
      maxNativeZoom: 16,
      tileSize: 256,
      bounds: MAP_BOUNDS.pad(0.85),
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> contributors · bundled tiles',
    }).addTo(map);

    map.fitBounds(MAP_BOUNDS.pad(0.08));

    userMarker = L.marker(MAP_BOUNDS.getCenter(), { icon: userIcon() }).addTo(map);
    pinsLayer = L.layerGroup().addTo(map);
    poiLayer = L.layerGroup().addTo(map);
  }

  function populatePoiCategoryFilter() {
    const cats = [...new Set(allPois.map((p) => p.category))].sort();
    els.poiCat.innerHTML = '<option value="">All categories</option>';
    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = CATEGORY_LABELS[c] || c;
      els.poiCat.appendChild(opt);
    });
  }

  function filteredPois() {
    const q = (els.poiSearch.value || "").trim().toLowerCase();
    const cat = els.poiCat.value;
    return allPois.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (CATEGORY_LABELS[p.category] || "").toLowerCase().includes(q);
    });
  }

  function renderPoiList() {
    const list = filteredPois();
    els.poiList.innerHTML = "";
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
        if (mk) map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.45 });
      });
      li.addEventListener("click", () => {
        const mk = poiMarkers.get(p.id);
        if (mk) map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.4 });
      });
      els.poiList.appendChild(li);
    });
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
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        openNavForPoi(p.id);
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
      populatePoiCategoryFilter();
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
      m.on("click", () => openNavForPin(p.id));
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
        removePin(p.id);
      });
      li.addEventListener("click", () => {
        const mk = leafletMarkers.get(p.id);
        if (mk) map.flyTo(mk.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.45 });
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

  function openNavTo(target) {
    activeNavTarget = target;
    els.navOverlay.dataset.open = "true";
    els.navOverlay.setAttribute("aria-hidden", "false");
    els.navTitle.textContent = target.name;
    if (target.kind === "pin") {
      els.navSub.textContent = "Your saved meetup pin";
    } else {
      els.navSub.textContent = (CATEGORY_LABELS[target.category] || target.category || "Venue") + " · festival map";
    }
    renderPinList();
    renderPoiList();
    updateNavReadout();
    if (navInterval) clearInterval(navInterval);
    navInterval = setInterval(updateNavReadout, 450);
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

  function closeNav() {
    activeNavTarget = null;
    els.navOverlay.dataset.open = "false";
    els.navOverlay.setAttribute("aria-hidden", "true");
    if (navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }
    renderPinList();
    renderPoiList();
  }

  function headingForArrow() {
    if (typeof compassHeading === "number" && !Number.isNaN(compassHeading)) return compassHeading;
    if (lastPosition && typeof lastPosition.coords.heading === "number" && !Number.isNaN(lastPosition.coords.heading)) {
      const sp = lastPosition.coords.speed;
      if (sp != null && sp > 0.4) return lastPosition.coords.heading;
    }
    if (typeof lastHeadingFromMotion === "number") return lastHeadingFromMotion;
    return null;
  }

  function updateNavReadout() {
    if (!activeNavTarget || !lastPosition) {
      els.navDistance.textContent = "—";
      els.navBearing.textContent = "Waiting for GPS…";
      els.arrowWrap.style.transform = "rotate(0deg)";
      els.navHint.textContent = "Enable location and walk into an open area for a faster lock.";
      return;
    }
    const here = { lat: lastPosition.coords.latitude, lng: lastPosition.coords.longitude };
    const there = { lat: activeNavTarget.lat, lng: activeNavTarget.lng };
    const dist = haversineM(here, there);
    const brg = bearingDeg(here, there);
    els.navDistance.textContent = formatDist(dist);
    els.navBearing.textContent = Math.round(brg) + "° · " + cardinal(brg) + " to target";

    const deviceH = headingForArrow();
    if (deviceH == null) {
      els.arrowWrap.style.transform = "rotate(0deg)";
      els.navHint.textContent =
        "No compass yet — tap “Enable compass”, or walk a few steps so GPS can detect your direction of travel.";
      return;
    }
    const rel = (brg - deviceH + 360) % 360;
    els.arrowWrap.style.transform = "rotate(" + rel + "deg)";
    els.navHint.textContent =
      "Hold your phone flat like a compass. Arrow follows your body as you turn — works without mobile data.";
  }

  function onGeoSuccess(pos) {
    const prev = lastPosition;
    lastPosition = pos;
    const ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
    userMarker.setLatLng(ll);
    els.coordStrip.textContent =
      "GPS: " +
      pos.coords.latitude.toFixed(6) +
      ", " +
      pos.coords.longitude.toFixed(6) +
      (pos.coords.accuracy ? " · ±" + Math.round(pos.coords.accuracy) + " m" : "");

    if (prev && Number.isFinite(prev.coords.latitude) && Number.isFinite(prev.coords.longitude)) {
      const a = { lat: prev.coords.latitude, lng: prev.coords.longitude };
      const b = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (haversineM(a, b) > 1.5) lastHeadingFromMotion = bearingDeg(a, b);
    }

    if (els.navOverlay.dataset.open === "true") updateNavReadout();
  }

  function onGeoErr(err) {
    els.coordStrip.textContent = "GPS error: " + (err && err.message ? err.message : "unknown");
  }

  function startGeolocation() {
    if (!navigator.geolocation) {
      toast("Geolocation is not available in this browser.");
      return;
    }
    if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = navigator.geolocation.watchPosition(onGeoSuccess, onGeoErr, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000,
    });
  }

  function requestCompass() {
    const ori = window.DeviceOrientationEvent;
    if (!ori) {
      toast("Compass API not available — use GPS movement (walk a few steps) for direction.");
      return;
    }
    const attach = () => {
      if (!orientationHooked) {
        window.addEventListener("deviceorientation", onDeviceOrientation, true);
        orientationHooked = true;
      }
      toast("Compass enabled");
      els.btnCompass.textContent = "Compass on";
      updateNavReadout();
    };

    const maybePromise = ori.requestPermission && ori.requestPermission();
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.then((st) => (st === "granted" ? attach() : toast("Compass permission denied"))).catch(() => toast("Could not enable compass"));
    } else {
      attach();
    }
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

  function extractSharePayload(str) {
    if (!str) return null;
    const trimmed = str.trim();
    let b64 = null;
    const hashIdx = trimmed.indexOf("#");
    if (hashIdx >= 0) {
      const frag = trimmed.slice(hashIdx + 1);
      if (frag.startsWith(SHARE_PREFIX)) b64 = frag.slice(SHARE_PREFIX.length);
    }
    if (!b64 && trimmed.startsWith(SHARE_PREFIX)) b64 = trimmed.slice(SHARE_PREFIX.length);
    if (!b64) {
      const m = trimmed.match(/share=([^&]+)/);
      if (m) b64 = decodeURIComponent(m[1]);
    }
    if (!b64) return null;
    try {
      let norm = b64.replace(/-/g, "+").replace(/_/g, "/");
      while (norm.length % 4) norm += "=";
      const json = decodeURIComponent(escape(atob(norm)));
      const data = JSON.parse(json);
      if (data && data.v === 1 && Array.isArray(data.pins)) return data.pins;
    } catch {
      return null;
    }
    return null;
  }

  function encodeSharePayload(pins) {
    const body = JSON.stringify({ v: 1, pins: pins.map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, color: p.color })) });
    const b64 = btoa(unescape(encodeURIComponent(body)));
    return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function buildShareUrl() {
    const base =
      location.origin && location.origin !== "null"
        ? location.origin + location.pathname
        : location.pathname.split("/").pop() === "index.html"
          ? location.pathname
          : location.pathname.replace(/\/?$/, "/index.html");
    return base + "#" + SHARE_PREFIX + encodeSharePayload(loadPins());
  }

  function importPinsFromPayload(payload, mode) {
    if (!payload || !payload.length) {
      toast("No pins found in that link");
      return;
    }
    const cleaned = payload.map((x, i) => ({
      id: x.id && String(x.id).length < 200 ? x.id : uid(),
      name: String(x.name || "Meetup").slice(0, 80),
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
    if (mode === "replace") next = cleaned;
    else {
      const existingIds = new Set(loadPins().map((p) => p.id));
      cleaned.forEach((p) => {
        while (existingIds.has(p.id)) {
          p.id = uid();
        }
        existingIds.add(p.id);
      });
      next = loadPins().concat(cleaned);
    }
    savePins(next);
    syncMarkersFromPins(next);
    renderPinList();
    toast(mode === "replace" ? "Replaced with imported pins" : "Merged imported pins");
    history.replaceState(null, "", location.pathname + location.search);
  }

  function tryConsumeHashImport() {
    const h = location.hash;
    if (!h || !h.includes(SHARE_PREFIX)) return;
    const pins = extractSharePayload(h);
    if (!pins || !pins.length) return;
    const ok = window.confirm("This link includes " + pins.length + " meetup pin(s). Merge into your saved pins?");
    if (ok) importPinsFromPayload(pins, "merge");
    else history.replaceState(null, "", location.pathname + location.search);
  }

  function setSheetTab(which) {
    const isMeet = which === "meetups";
    els.tabMeetups.setAttribute("aria-selected", isMeet ? "true" : "false");
    els.tabVenue.setAttribute("aria-selected", !isMeet ? "true" : "false");
    els.panelMeetups.hidden = !isMeet;
    els.panelVenue.hidden = isMeet;
  }

  function syncSheetLayout() {
    if (!els.sheet) return;
    const full = els.sheet.dataset.expanded === "true";
    document.documentElement.dataset.sheetSize = full ? "full" : "compact";
  }

  function wireUi() {
    els.tabMeetups.addEventListener("click", () => setSheetTab("meetups"));
    els.tabVenue.addEventListener("click", () => setSheetTab("venue"));

    if (els.sheetHandle && els.sheet) {
      els.sheetHandle.addEventListener("click", () => {
        els.sheet.dataset.expanded = els.sheet.dataset.expanded === "true" ? "false" : "true";
        syncSheetLayout();
      });
    }

    els.poiSearch.addEventListener("input", () => renderPoiList());
    els.poiCat.addEventListener("change", () => renderPoiList());

    const doCenter = () => {
      if (userMarker) map.flyTo(userMarker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.5 });
      startGeolocation();
    };
    els.btnCenter.addEventListener("click", doCenter);
    if (els.btnCenterFloat) els.btnCenterFloat.addEventListener("click", doCenter);

    const doPin = () => {
      if (!map) return;
      const ll =
        lastPosition && Number.isFinite(lastPosition.coords.latitude)
          ? { lat: lastPosition.coords.latitude, lng: lastPosition.coords.longitude }
          : map.getCenter();
      els.inpName.value = "";
      els.dlgName.dataset.lat = String(ll.lat);
      els.dlgName.dataset.lng = String(ll.lng);
      els.pinHint.textContent =
        lastPosition && Number.isFinite(lastPosition.coords.latitude)
          ? "Saved at your current GPS fix (works without mobile data once the OS has a lock)."
          : "GPS not locked yet — this pin uses the map center. Pan/zoom first, or tap Center on me and wait.";
      els.dlgName.showModal();
      els.inpName.focus();
    };
    els.btnPin.addEventListener("click", doPin);
    if (els.btnPinFloat) els.btnPinFloat.addEventListener("click", doPin);

    els.nameCancel.addEventListener("click", () => els.dlgName.close());

    els.formName.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = els.inpName.value.trim() || "Meetup";
      const lat = Number(els.dlgName.dataset.lat);
      const lng = Number(els.dlgName.dataset.lng);
      els.dlgName.close();
      addPinAt({ lat, lng }, name);
    });

    els.btnShare.addEventListener("click", () => {
      const pins = loadPins();
      if (!pins.length) {
        toast("Add at least one pin before sharing");
        return;
      }
      els.inpShareUrl.value = buildShareUrl();
      els.dlgShare.showModal();
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

    els.formImport.addEventListener("submit", (e) => {
      e.preventDefault();
      const sub = e.submitter;
      const mode = sub && sub.value === "replace" ? "replace" : "merge";
      const pins = extractSharePayload(els.inpImport.value);
      if (pins) importPinsFromPayload(pins, mode);
      else toast("Could not read pins from that text");
      els.dlgImport.close();
    });

    els.btnCompass.addEventListener("click", () => requestCompass());

    els.navClose.addEventListener("click", () => closeNav());
    els.navMap.addEventListener("click", () => {
      if (!activeNavTarget) return;
      if (activeNavTarget.kind === "pin") {
        const mk = leafletMarkers.get(activeNavTarget.id);
        if (mk) map.flyTo(mk.getLatLng(), 17, { duration: 0.5 });
      } else {
        map.flyTo([activeNavTarget.lat, activeNavTarget.lng], 18, { duration: 0.5 });
      }
      closeNav();
    });
  }

  async function boot() {
    initMap();
    registerSw();
    wireUi();
    syncSheetLayout();

    L.Icon.Default.mergeOptions({
      iconRetinaUrl: "/vendor/leaflet/images/marker-icon-2x.png",
      iconUrl: "/vendor/leaflet/images/marker-icon.png",
      shadowUrl: "/vendor/leaflet/images/marker-shadow.png",
    });

    const pins = loadPins();
    syncMarkersFromPins(pins);
    renderPinList();
    startGeolocation();
    tryConsumeHashImport();
    await loadFestivalPois();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
