(function () {
  "use strict";

  const DEFAULT_KML = "./data/ruta-completa-30-09-2026.kml";
  const SAMPLE_KML = "./data/VID_20251121_030905_00_005.kml";

  const els = {
    routeName: document.getElementById("route-name"),
    file: document.getElementById("kml-file"),
    btnSample: document.getElementById("btn-sample"),
    btnDefault: document.getElementById("btn-default"),
    slider: document.getElementById("route-slider"),
    sliderLabel: document.getElementById("slider-label"),
    distanceLabel: document.getElementById("distance-label"),
    pointBadge: document.getElementById("point-badge"),
    infoLat: document.getElementById("info-lat"),
    infoLon: document.getElementById("info-lon"),
    infoElev: document.getElementById("info-elev"),
    infoDist: document.getElementById("info-dist"),
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
    layers: [road],
    zoomControl: true,
  }).setView([-37.9, -72.3], 11);

  L.control
    .layers(
      {
        Carretera: road,
        Satélite: satellite,
        Híbrida: hybrid,
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

  function pointPopupHtml(p) {
    return `
      <strong>Punto ${p.index + 1}</strong><br/>
      Lat: ${p.lat.toFixed(6)}<br/>
      Lon: ${p.lon.toFixed(6)}<br/>
      Elev: ${formatElev(p.elev)}<br/>
      Dist: ${formatKm(p.distanceM)}
    `;
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

    if (state.marker) {
      state.marker.setLatLng([p.lat, p.lon]);
      state.marker.setPopupContent(pointPopupHtml(p));
    }

    if (state.chart) {
      state.chart.setActiveIndex(i);
    }
  }

  function clearRoute() {
    routeLayer.clearLayers();
    state.polyline = null;
    state.marker = null;
    state.vertices = null;
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
      setStatus("La ruta no tiene puntos", "error");
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
      title: "Posición actual",
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
    setStatus(`Procesando ${label || "KML"}…`);
    els.slider.disabled = true;
    let track;
    try {
      track = KmlViewer.parseKml(text);
    } catch (err) {
      setStatus(err.message || "Error al leer KML", "error");
      return;
    }

    drawRoute(track);

    let elevMeta = { source: track.hasRealElevation ? "KML" : "KML (sin altura)", enriched: false };
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
            ? `Elevación enriquecida (${elevMeta.source}). ${track.points.length} puntos.`
            : `Ruta lista · ${track.points.length} puntos`,
          "ok"
        );
      } else {
        setStatus(`Ruta lista · ${track.points.length} puntos · elevación desde KML`, "ok");
      }
    } catch (err) {
      setStatus(
        `Ruta cargada, pero falló el perfil de elevación: ${err.message}`,
        "error"
      );
      elevMeta = { source: "No disponible", enriched: false };
    }

    els.elevSource.textContent = elevMeta.source;
  }

  async function loadUrl(url, label) {
    setStatus(`Descargando ${label || url}…`);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await loadFromText(text, label || url);
    } catch (err) {
      setStatus(`No se pudo cargar el KML: ${err.message}`, "error");
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
      setStatus(err.message || "Error al leer archivo", "error");
    }
    els.file.value = "";
  });

  els.btnSample.addEventListener("click", () => {
    loadUrl(SAMPLE_KML, "muestra Insta360");
  });

  els.btnDefault.addEventListener("click", () => {
    loadUrl(DEFAULT_KML, "ruta demo");
  });

  // Invalidate size after layout settles (mobile/desktop)
  window.addEventListener("resize", () => {
    map.invalidateSize();
  });

  loadUrl(DEFAULT_KML, "ruta demo");
})();
