(function () {
  "use strict";

  const STORAGE_KEY = "edc2026_pins_v1";
  const SHARE_PREFIX = "share=";

  /** Approximate LVMS infield bounds for georeferenced schematic map (not survey-grade). */
  const MAP_BOUNDS = L.latLngBounds(L.latLng(36.268, -115.0178), L.latLng(36.2778, -115.0042));

  const PIN_COLORS = ["#ff2dbe", "#00f5ff", "#39ff14", "#ffd400", "#c86bff", "#ff6b35", "#ffffff"];

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
  };

  let map;
  let userMarker;
  let pinsLayer;
  const leafletMarkers = new Map();
  let lastPosition = null;
  let lastHeadingFromMotion = null;
  let compassHeading = null;
  let activeNavPin = null;
  let geoWatchId = null;
  let navInterval = null;
  let orientationHooked = false;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : "p-" + Date.now() + "-" + Math.random().toString(16).slice(2);
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
      maxBounds: MAP_BOUNDS.pad(0.25),
      zoomControl: true,
      attributionControl: false,
      minZoom: 13,
      maxZoom: 19,
    });

    L.imageOverlay("/assets/edc-map.svg", MAP_BOUNDS).addTo(map);
    map.fitBounds(MAP_BOUNDS);

    userMarker = L.marker(MAP_BOUNDS.getCenter(), { icon: userIcon() }).addTo(map);
    pinsLayer = L.layerGroup().addTo(map);
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
      li.dataset.active = activeNavPin && activeNavPin.id === p.id ? "true" : "false";
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
    if (activeNavPin && activeNavPin.id === id) closeNav();
    syncMarkersFromPins(next);
    renderPinList();
  }

  function openNavForPin(id) {
    const p = loadPins().find((x) => x.id === id);
    if (!p) return;
    activeNavPin = p;
    els.navOverlay.dataset.open = "true";
    els.navOverlay.setAttribute("aria-hidden", "false");
    els.navTitle.textContent = p.name;
    els.navSub.textContent = "Arrow points toward your meetup";
    renderPinList();
    updateNavReadout();
    if (navInterval) clearInterval(navInterval);
    navInterval = setInterval(updateNavReadout, 450);
  }

  function closeNav() {
    activeNavPin = null;
    els.navOverlay.dataset.open = "false";
    els.navOverlay.setAttribute("aria-hidden", "true");
    if (navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }
    renderPinList();
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
    if (!activeNavPin || !lastPosition) {
      els.navDistance.textContent = "—";
      els.navBearing.textContent = "Waiting for GPS…";
      els.arrowWrap.style.transform = "rotate(0deg)";
      els.navHint.textContent = "Enable location and walk into an open area for a faster lock.";
      return;
    }
    const here = { lat: lastPosition.coords.latitude, lng: lastPosition.coords.longitude };
    const there = { lat: activeNavPin.lat, lng: activeNavPin.lng };
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

  function wireUi() {
    els.btnCenter.addEventListener("click", () => {
      if (userMarker) map.flyTo(userMarker.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.5 });
      startGeolocation();
    });

    els.btnPin.addEventListener("click", () => {
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
    });

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
      if (!activeNavPin) return;
      const mk = leafletMarkers.get(activeNavPin.id);
      if (mk) map.flyTo(mk.getLatLng(), 17, { duration: 0.5 });
      closeNav();
    });
  }

  function boot() {
    initMap();
    registerSw();
    wireUi();

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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
