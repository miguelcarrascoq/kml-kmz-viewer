(function () {
  "use strict";

  const SAMPLE_KML = "./data/VID_20251121_030905_00_005.kml";

  const els = {
    routeName: document.getElementById("route-name"),
    file: document.getElementById("kml-file"),
    btnSample: document.getElementById("btn-sample"),
    btnAddress: document.getElementById("btn-address"),
    slider: document.getElementById("route-slider"),
    sliderLabel: document.getElementById("slider-label"),
    distanceLabel: document.getElementById("distance-label"),
    pointBadge: document.getElementById("point-badge"),
    infoLat: document.getElementById("info-lat"),
    infoLon: document.getElementById("info-lon"),
    infoElev: document.getElementById("info-elev"),
    infoDist: document.getElementById("info-dist"),
    infoAddress: document.getElementById("info-address"),
    status: document.getElementById("status-msg"),
    elevSource: document.getElementById("elev-source"),
    chartCanvas: document.getElementById("elev-chart"),
  };

  let state = {
    points: [],
    name: "",
    index: 0,
    chart: null,
    polyline: null,
    marker: null,
    vertices: null,
    addressCache: new Map(),
    lastGeocodeAt: 0,
  };

  const road = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });

  const esriImageryUrl =
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  const esriImageryOpts = {
    maxZoom: 19,
    attribution: "Tiles &copy; Esri",
  };

  const satellite = L.tileLayer(esriImageryUrl, esriImageryOpts);

  const hybridImagery = L.tileLayer(esriImageryUrl, esriImageryOpts);
  const hybridLabels = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution: "Labels &copy; Esri",
    }
  );

  const hybrid = L.layerGroup([hybridImagery, hybridLabels]);

  const map = L.map("map", {
    layers: [hybrid],
    zoomControl: true,
  }).setView([-37.9, -72.3], 11);

  L.control
    .layers(
      {
        Road: road,
        Satellite: satellite,
        Hybrid: hybrid,
      },
      {},
      { position: "topright" }
    )
    .addTo(map);

  const routeLayer = L.layerGroup().addTo(map);

  function setStatus(msg, kind) {
    els.status.textContent = msg || "";
    els.status.className = "status" + (kind ? ` ${kind}` : "");
  }

  function formatKm(m) {
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${m.toFixed(0)} m`;
  }

  function formatElev(e) {
    if (e == null || !Number.isFinite(e)) return "—";
    return `${e.toFixed(1)} m`;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pointPopupHtml(p, opts = {}) {
    const cached = state.addressCache.get(p.index);
    let addressBlock;
    if (opts.loading) {
      addressBlock = `<div class="popup-address popup-address--pending">Looking up address…</div>`;
    } else if (cached) {
      addressBlock = `<div class="popup-address">${escapeHtml(cached)}</div>`;
    } else if (opts.error) {
      addressBlock = `
        <div class="popup-address popup-address--error">${escapeHtml(opts.error)}</div>
        <button type="button" class="btn-popup-address" data-point-index="${p.index}">
          Retry address
        </button>`;
    } else {
      addressBlock = `
        <button type="button" class="btn-popup-address" data-point-index="${p.index}">
          Infer address
        </button>`;
    }
    return `
      <strong>Point ${p.index + 1}</strong><br/>
      Lat: ${p.lat.toFixed(6)}<br/>
      Lon: ${p.lon.toFixed(6)}<br/>
      Elev: ${formatElev(p.elev)}<br/>
      Dist: ${formatKm(p.distanceM)}
      ${addressBlock}
    `;
  }

  function setPopupContentForIndex(idx, opts = {}) {
    const p = state.points[idx];
    if (!p) return;
    const html = pointPopupHtml(p, opts);
    if (state.marker && state.index === idx) {
      state.marker.setPopupContent(html);
    }
    if (state.vertices) {
      state.vertices.eachLayer((layer) => {
        const ll = layer.getLatLng();
        if (nearestIndex(ll.lat, ll.lng) === idx) {
          layer.setPopupContent(html);
        }
      });
    }
  }

  function updateInfo(index) {
    const points = state.points;
    if (!points.length) return;
    const i = Math.max(0, Math.min(index, points.length - 1));
    state.index = i;
    const p = points[i];

    els.slider.value = String(i);
    els.sliderLabel.textContent = `${i + 1} / ${points.length}`;
    els.distanceLabel.textContent = formatKm(p.distanceM);
    els.pointBadge.textContent = `#${i + 1}`;
    els.infoLat.textContent = p.lat.toFixed(6);
    els.infoLon.textContent = p.lon.toFixed(6);
    els.infoElev.textContent = formatElev(p.elev);
    els.infoDist.textContent = formatKm(p.distanceM);
    els.btnAddress.disabled = false;

    const cached = state.addressCache.get(i);
    els.infoAddress.textContent = cached || 'Press "Infer address" for this point';

    if (state.marker) {
      state.marker.setLatLng([p.lat, p.lon]);
      state.marker.setPopupContent(pointPopupHtml(p));
    }

    if (state.chart) {
      state.chart.setActiveIndex(i);
    }
  }

  function uniqueJoin(parts) {
    return parts.filter((v, i, arr) => v && arr.indexOf(v) === i).join(", ") || null;
  }

  function formatStreetLine(street, houseNumber) {
    if (!street && !houseNumber) return null;
    if (street && houseNumber) return `${street} ${houseNumber}`;
    return street || houseNumber;
  }

  function formatNominatimAddress(data) {
    const a = data && data.address;
    if (a) {
      const street =
        a.road || a.pedestrian || a.footway || a.path || a.residential || a.cycleway;
      const streetLine = formatStreetLine(street, a.house_number);
      const text = uniqueJoin([
        streetLine,
        a.suburb || a.neighbourhood || a.quarter || a.city_district,
        a.city || a.town || a.village || a.municipality || a.hamlet,
        a.postcode,
        a.state || a.region,
        a.country,
      ]);
      if (text) return text;
    }
    return (data && data.display_name) || null;
  }

  function formatPhotonAddress(feature) {
    const p = feature && feature.properties;
    if (!p) return null;
    const streetLine = formatStreetLine(p.street || p.name, p.housenumber);
    return uniqueJoin([
      streetLine,
      p.district || p.neighbourhood || p.suburb,
      p.city || p.town || p.village || p.municipality || p.locality,
      p.postcode,
      p.state || p.county,
      p.country,
    ]);
  }

  function formatBigDataCloudAddress(data) {
    const parts = [
      data.locality,
      data.city,
      data.principalSubdivision,
      data.countryName,
    ];
    const text = uniqueJoin(parts);
    if (text) return text;
    if (data.plusCode) return String(data.plusCode);
    return null;
  }

  async function reverseGeocodeNominatim(lat, lon) {
    // Nominatim (OSM): free, max ~1 req/s
    const wait = Math.max(0, 1100 - (Date.now() - state.lastGeocodeAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const nomUrl =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
      `&accept-language=en&zoom=18&addressdetails=1`;
    state.lastGeocodeAt = Date.now();
    const res = await fetch(nomUrl, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = await res.json();
    const text = formatNominatimAddress(data);
    if (!text) throw new Error("No address result");
    return { text, source: "Nominatim OSM" };
  }

  async function reverseGeocodePhoton(lat, lon) {
    const url =
      `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}&lang=en`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
    const data = await res.json();
    const feature = data && data.features && data.features[0];
    const text = formatPhotonAddress(feature);
    if (!text) throw new Error("No address result");
    return { text, source: "Photon" };
  }

  async function reverseGeocodeBigDataCloud(lat, lon) {
    const bdcUrl =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
      `&localityLanguage=en`;
    const res = await fetch(bdcUrl);
    if (!res.ok) throw new Error(`BigDataCloud HTTP ${res.status}`);
    const data = await res.json();
    const text = formatBigDataCloudAddress(data);
    if (!text) throw new Error("No address result");
    return { text, source: "BigDataCloud" };
  }

  async function reverseGeocode(lat, lon) {
    // Prefer street-level OSM sources; BigDataCloud is locality-only fallback
    try {
      return await reverseGeocodeNominatim(lat, lon);
    } catch (_) {
      /* fall through */
    }
    try {
      return await reverseGeocodePhoton(lat, lon);
    } catch (_) {
      /* fall through */
    }
    return reverseGeocodeBigDataCloud(lat, lon);
  }

  async function inferAddress(optIndex) {
    const forIndex =
      optIndex != null && Number.isFinite(optIndex) ? optIndex : state.index;
    const p = state.points[forIndex];
    if (!p) return;

    if (forIndex !== state.index) {
      updateInfo(forIndex);
    }

    if (state.addressCache.has(forIndex)) {
      const text = state.addressCache.get(forIndex);
      els.infoAddress.textContent = text;
      setPopupContentForIndex(forIndex);
      return;
    }

    els.btnAddress.disabled = true;
    els.infoAddress.textContent = "Looking up address…";
    setPopupContentForIndex(forIndex, { loading: true });
    try {
      const { text, source } = await reverseGeocode(p.lat, p.lon);
      state.addressCache.set(forIndex, text);
      if (state.index === forIndex) {
        els.infoAddress.textContent = text;
        setStatus(`Address via ${source}`, "ok");
      }
      setPopupContentForIndex(forIndex);
    } catch (err) {
      const msg = "Could not get address";
      if (state.index === forIndex) {
        els.infoAddress.textContent = msg;
        setStatus(err.message || "Geocoding error", "error");
      }
      setPopupContentForIndex(forIndex, { error: msg });
    } finally {
      els.btnAddress.disabled = !state.points.length;
    }
  }

  function clearRoute() {
    routeLayer.clearLayers();
    state.polyline = null;
    state.marker = null;
    state.vertices = null;
    state.addressCache.clear();
    els.infoAddress.textContent = "—";
    els.btnAddress.disabled = true;
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
  }

  function drawRoute(track) {
    clearRoute();
    const points = track.points;
    state.points = points;
    state.name = track.name;
    els.routeName.textContent = track.name;

    if (!points.length) {
      els.slider.disabled = true;
      setStatus("Route has no points", "error");
      return;
    }

    const latlngs = points.map((p) => [p.lat, p.lon]);
    state.polyline = L.polyline(latlngs, {
      color: "#2dd4a8",
      weight: 4,
      opacity: 0.9,
    }).addTo(routeLayer);

    state.polyline.on("click", (e) => {
      const nearest = nearestIndex(e.latlng.lat, e.latlng.lng);
      updateInfo(nearest);
      if (state.marker) state.marker.openPopup();
    });

    // Clickable vertex markers (sparse for performance on long tracks)
    const step = Math.max(1, Math.floor(points.length / 80));
    state.vertices = L.layerGroup();
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      const circle = L.circleMarker([p.lat, p.lon], {
        radius: 4,
        color: "#0f1419",
        weight: 1,
        fillColor: "#4de0b8",
        fillOpacity: 0.9,
      });
      circle.bindPopup(pointPopupHtml(p));
      circle.on("click", () => updateInfo(p.index));
      circle.addTo(state.vertices);
    }
    // Always include last point
    const last = points[points.length - 1];
    if ((points.length - 1) % step !== 0) {
      const circle = L.circleMarker([last.lat, last.lon], {
        radius: 4,
        color: "#0f1419",
        weight: 1,
        fillColor: "#4de0b8",
        fillOpacity: 0.9,
      });
      circle.bindPopup(pointPopupHtml(last));
      circle.on("click", () => updateInfo(last.index));
      circle.addTo(state.vertices);
    }
    state.vertices.addTo(routeLayer);

    state.marker = L.marker(latlngs[0], {
      draggable: false,
      title: "Current position",
      zIndexOffset: 1000,
    })
      .bindPopup(pointPopupHtml(points[0]))
      .addTo(routeLayer);

    map.fitBounds(state.polyline.getBounds(), { padding: [28, 28] });

    els.slider.disabled = false;
    els.slider.min = "0";
    els.slider.max = String(points.length - 1);
    els.slider.value = "0";

    state.chart = KmlViewer.createElevationChart(els.chartCanvas, points);
    state.chart.onSelectIndex((idx) => {
      updateInfo(idx);
      if (state.marker) {
        map.panTo(state.marker.getLatLng());
        state.marker.openPopup();
      }
    });

    updateInfo(0);
  }

  function nearestIndex(lat, lon) {
    let best = 0;
    let bestD = Infinity;
    const pts = state.points;
    for (let i = 0; i < pts.length; i++) {
      const d = KmlViewer.haversine(lat, lon, pts[i].lat, pts[i].lon);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  async function loadFromText(text, label) {
    setStatus(`Processing ${label || "KML"}…`);
    els.slider.disabled = true;
    let track;
    try {
      track = KmlViewer.parseKml(text);
    } catch (err) {
      setStatus(err.message || "Error reading KML", "error");
      return;
    }

    drawRoute(track);

    let elevMeta = { source: track.hasRealElevation ? "KML" : "KML (no altitude)", enriched: false };
    try {
      if (KmlViewer.needsElevationEnrichment(track.points)) {
        elevMeta = await KmlViewer.ensureElevations(track.points, (msg) => setStatus(msg));
        // redraw chart with new elevations
        if (state.chart) {
          state.chart.destroy();
          state.chart = KmlViewer.createElevationChart(els.chartCanvas, track.points);
          state.chart.onSelectIndex((idx) => {
            updateInfo(idx);
            if (state.marker) {
              map.panTo(state.marker.getLatLng());
              state.marker.openPopup();
            }
          });
          updateInfo(state.index);
        }
        // refresh popups on vertices
        if (state.vertices) {
          state.vertices.eachLayer((layer) => {
            const ll = layer.getLatLng();
            const idx = nearestIndex(ll.lat, ll.lng);
            layer.setPopupContent(pointPopupHtml(track.points[idx]));
          });
        }
        setStatus(
          elevMeta.enriched
            ? `Elevation enriched (${elevMeta.source}). ${track.points.length} points.`
            : `Route ready · ${track.points.length} points`,
          "ok"
        );
      } else {
        setStatus(`Route ready · ${track.points.length} points · elevation from KML`, "ok");
      }
    } catch (err) {
      setStatus(
        `Route loaded, but elevation profile failed: ${err.message}`,
        "error"
      );
      elevMeta = { source: "Unavailable", enriched: false };
    }

    els.elevSource.textContent = elevMeta.source;
  }

  /** Convert public Google Drive share links to a direct-download URL. */
  function normalizeGoogleDriveUrl(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return href;
    }
    if (!/(^|\.)drive\.google\.com$/i.test(u.hostname)) return href;

    let fileId = null;
    const pathMatch = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (pathMatch) fileId = pathMatch[1];
    if (!fileId) fileId = u.searchParams.get("id");

    if (!fileId) return href;
    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
  }

  /**
   * Resolve ?url= from the query string.
   * Returns { url, label }, false if present but invalid, or null if absent.
   */
  function resolveUrlParam() {
    const raw = new URLSearchParams(window.location.search).get("url");
    if (!raw || !raw.trim()) return null;

    let parsed;
    try {
      parsed = new URL(raw.trim());
    } catch {
      setStatus("Invalid url parameter (not a URL)", "error");
      return false;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setStatus("Invalid url parameter (http/https only)", "error");
      return false;
    }

    const resolved = normalizeGoogleDriveUrl(parsed.href);
    const label = parsed.pathname.split("/").filter(Boolean).pop() || resolved;
    return { url: resolved, label };
  }

  async function loadUrl(url, label) {
    setStatus(`Downloading ${label || url}…`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await loadFromText(text, label || url);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const isNetwork =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed/i.test(msg);
      if (isNetwork) {
        setStatus(
          "Could not load KML (network or CORS). The server must allow fetch from this origin; Google Drive often blocks it.",
          "error"
        );
      } else {
        setStatus(`Could not load KML: ${msg}`, "error");
      }
    }
  }

  els.slider.addEventListener("input", () => {
    const i = Number(els.slider.value);
    updateInfo(i);
  });

  els.slider.addEventListener("change", () => {
    if (state.marker) {
      map.panTo(state.marker.getLatLng());
    }
  });

  els.file.addEventListener("change", async () => {
    const file = els.file.files && els.file.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await loadFromText(text, file.name);
    } catch (err) {
      setStatus(err.message || "Error reading file", "error");
    }
    els.file.value = "";
  });

  els.btnSample.addEventListener("click", () => {
    loadUrl(SAMPLE_KML, "demo data");
  });

  els.btnAddress.addEventListener("click", () => {
    inferAddress();
  });

  map.getContainer().addEventListener("click", (e) => {
    const btn = e.target.closest(".btn-popup-address");
    if (!btn) return;
    e.preventDefault();
    const idx = Number(btn.dataset.pointIndex);
    if (!Number.isFinite(idx)) return;
    inferAddress(idx);
  });

  // Invalidate size after layout settles (mobile/desktop)
  window.addEventListener("resize", () => {
    map.invalidateSize();
  });

  const fromQuery = resolveUrlParam();
  if (fromQuery) {
    loadUrl(fromQuery.url, fromQuery.label);
  } else if (fromQuery !== false) {
    loadUrl(SAMPLE_KML, "demo data");
  }
})();
