import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import {
  createElevationChart,
  ensureElevations,
  needsElevationEnrichment,
  type ElevationChart,
} from "./elevation";
import { reverseGeocode } from "./geocode";
import { haversine, parseKml } from "./kml";
import { isKmz, openKmz, type KmzArchive } from "./kmz";
import type {
  ElevationMeta,
  HrefResolver,
  KmlTreeNode,
  PopupOpts,
  StatusKind,
  Track,
  TrackPoint,
} from "./types";

// Vite rewrites asset URLs; Leaflet's default icon paths break without this.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const SAMPLE_KML = `${import.meta.env.BASE_URL}data/VID_20251121_030905_00_005.kml`;

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const els = {
  routeName: requireEl<HTMLParagraphElement>("route-name"),
  file: requireEl<HTMLInputElement>("kml-file"),
  btnOpenUrl: requireEl<HTMLButtonElement>("btn-open-url"),
  btnSample: requireEl<HTMLButtonElement>("btn-sample"),
  btnLineStyle: requireEl<HTMLButtonElement>("btn-line-style"),
  btnAddress: requireEl<HTMLButtonElement>("btn-address"),
  urlModal: requireEl<HTMLDivElement>("url-modal"),
  urlInput: requireEl<HTMLInputElement>("url-input"),
  urlError: requireEl<HTMLParagraphElement>("url-error"),
  btnUrlCancel: requireEl<HTMLButtonElement>("btn-url-cancel"),
  btnUrlLoad: requireEl<HTMLButtonElement>("btn-url-load"),
  styleModal: requireEl<HTMLDivElement>("style-modal"),
  btnStyleDone: requireEl<HTMLButtonElement>("btn-style-done"),
  slider: requireEl<HTMLInputElement>("route-slider"),
  sliderLabel: requireEl<HTMLSpanElement>("slider-label"),
  distanceLabel: requireEl<HTMLSpanElement>("distance-label"),
  pointBadge: requireEl<HTMLSpanElement>("point-badge"),
  infoLat: requireEl<HTMLElement>("info-lat"),
  infoLon: requireEl<HTMLElement>("info-lon"),
  infoElev: requireEl<HTMLElement>("info-elev"),
  infoDist: requireEl<HTMLElement>("info-dist"),
  infoAddress: requireEl<HTMLParagraphElement>("info-address"),
  status: requireEl<HTMLParagraphElement>("status-msg"),
  elevSource: requireEl<HTMLSpanElement>("elev-source"),
  chartCanvas: requireEl<HTMLCanvasElement>("elev-chart"),
  lineColor: requireEl<HTMLInputElement>("line-color"),
  lineWidth: requireEl<HTMLInputElement>("line-width"),
  lineWidthValue: requireEl<HTMLElement>("line-width-value"),
  lineOpacity: requireEl<HTMLInputElement>("line-opacity"),
  lineOpacityValue: requireEl<HTMLElement>("line-opacity-value"),
  pointColor: requireEl<HTMLInputElement>("point-color"),
  pointRadius: requireEl<HTMLInputElement>("point-radius"),
  pointRadiusValue: requireEl<HTMLElement>("point-radius-value"),
  pointOpacity: requireEl<HTMLInputElement>("point-opacity"),
  pointOpacityValue: requireEl<HTMLElement>("point-opacity-value"),
  treeCard: requireEl<HTMLElement>("kml-tree-card"),
  treeRoot: requireEl<HTMLDivElement>("kml-tree"),
  treeCount: requireEl<HTMLSpanElement>("kml-tree-count"),
};

interface LineStyle {
  color: string;
  weight: number;
  opacity: number;
}

interface PointStyle {
  color: string;
  radius: number;
  opacity: number;
}

const DEFAULT_LINE_STYLE: LineStyle = {
  color: "#5b9cff",
  weight: 4,
  opacity: 0.9,
};

const DEFAULT_POINT_STYLE: PointStyle = {
  color: "#4de0b8",
  radius: 4,
  opacity: 0.9,
};

function suggestedLineStyle(pathCount: number): LineStyle {
  if (pathCount > 80) {
    return { ...DEFAULT_LINE_STYLE, weight: 1, opacity: 0.7 };
  }
  if (pathCount > 12) {
    return { ...DEFAULT_LINE_STYLE, weight: 1.5, opacity: 0.75 };
  }
  if (pathCount > 1) {
    return { ...DEFAULT_LINE_STYLE, weight: 2.5, opacity: 0.85 };
  }
  return { ...DEFAULT_LINE_STYLE };
}

interface AppState {
  points: TrackPoint[];
  name: string;
  index: number;
  chart: ElevationChart | null;
  polyline: L.Polyline | null;
  pathLayers: L.Polyline[];
  pathHasKmlStyle: boolean[];
  pointLayers: L.Marker[];
  overlayLayers: L.ImageOverlay[];
  marker: L.Marker | null;
  vertices: L.LayerGroup | null;
  addressCache: Map<number, string>;
  lineStyle: LineStyle;
  pointStyle: PointStyle;
  track: Track | null;
  archive: KmzArchive | null;
}

const state: AppState = {
  points: [],
  name: "",
  index: 0,
  chart: null,
  polyline: null,
  pathLayers: [],
  pathHasKmlStyle: [],
  pointLayers: [],
  overlayLayers: [],
  marker: null,
  vertices: null,
  addressCache: new Map(),
  lineStyle: { ...DEFAULT_LINE_STYLE },
  pointStyle: { ...DEFAULT_POINT_STYLE },
  track: null,
  archive: null,
};

const road = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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

function setStatus(msg: string, kind: StatusKind = ""): void {
  els.status.replaceChildren();
  els.status.textContent = msg || "";
  els.status.className = "status" + (kind ? ` ${kind}` : "");
}

function setAddressText(text: string | null): void {
  const value = text?.trim() ?? "";
  els.infoAddress.textContent = value;
  els.infoAddress.hidden = !value;
}

function setCorsFailureStatus(url: string): void {
  els.status.replaceChildren();
  els.status.className = "status error";

  els.status.append("Could not load KML/KMZ (network or CORS). ");

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Open / download file";
  els.status.append(link);

  els.status.append(", then load it with Open KML / KMZ.");
}

function formatKm(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function formatElev(e: number | null | undefined): string {
  if (e == null || !Number.isFinite(e)) return "—";
  return `${e.toFixed(1)} m`;
}

function syncLineStyleInputs(): void {
  const { color, weight, opacity } = state.lineStyle;
  els.lineColor.value = color;
  els.lineWidth.value = String(weight);
  els.lineWidthValue.textContent = `${weight} px`;
  els.lineOpacity.value = String(opacity);
  els.lineOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
}

function syncPointStyleInputs(): void {
  const { color, radius, opacity } = state.pointStyle;
  els.pointColor.value = color;
  els.pointRadius.value = String(radius);
  els.pointRadiusValue.textContent = `${radius} px`;
  els.pointOpacity.value = String(opacity);
  els.pointOpacityValue.textContent = `${Math.round(opacity * 100)}%`;
}

function syncMapStyleInputs(): void {
  syncLineStyleInputs();
  syncPointStyleInputs();
}

function readLineStyleFromInputs(): LineStyle {
  return {
    color: els.lineColor.value || DEFAULT_LINE_STYLE.color,
    weight: Number(els.lineWidth.value) || DEFAULT_LINE_STYLE.weight,
    opacity: Number(els.lineOpacity.value) || DEFAULT_LINE_STYLE.opacity,
  };
}

function readPointStyleFromInputs(): PointStyle {
  return {
    color: els.pointColor.value || DEFAULT_POINT_STYLE.color,
    radius: Number(els.pointRadius.value) || DEFAULT_POINT_STYLE.radius,
    opacity: Number(els.pointOpacity.value) || DEFAULT_POINT_STYLE.opacity,
  };
}

function pointMarkerOptions(style: PointStyle = state.pointStyle): L.CircleMarkerOptions {
  return {
    radius: style.radius,
    color: "#0f1419",
    weight: 1,
    fillColor: style.color,
    fillOpacity: style.opacity,
    opacity: Math.min(1, style.opacity + 0.1),
  };
}

function applyLineStyle(style: LineStyle = state.lineStyle): void {
  state.lineStyle = style;
  syncLineStyleInputs();
  for (let i = 0; i < state.pathLayers.length; i++) {
    if (state.pathHasKmlStyle[i]) continue;
    state.pathLayers[i]!.setStyle({
      color: style.color,
      weight: style.weight,
      opacity: style.opacity,
    });
  }
}

function applyPointStyle(style: PointStyle = state.pointStyle): void {
  state.pointStyle = style;
  syncPointStyleInputs();
  if (!state.vertices) return;
  const opts = pointMarkerOptions(style);
  state.vertices.eachLayer((layer) => {
    (layer as L.CircleMarker).setStyle(opts);
    (layer as L.CircleMarker).setRadius(style.radius);
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pointPopupHtml(p: TrackPoint, opts: PopupOpts = {}): string {
  const cached = state.addressCache.get(p.index);
  let addressBlock: string;
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

function setPopupContentForIndex(idx: number, opts: PopupOpts = {}): void {
  const p = state.points[idx];
  if (!p) return;
  const html = pointPopupHtml(p, opts);
  if (state.marker && state.index === idx) {
    state.marker.setPopupContent(html);
  }
  if (state.vertices) {
    state.vertices.eachLayer((layer) => {
      const marker = layer as L.CircleMarker;
      const ll = marker.getLatLng();
      if (nearestIndex(ll.lat, ll.lng) === idx) {
        marker.setPopupContent(html);
      }
    });
  }
}

function wireChartSelect(chart: ElevationChart): void {
  chart.onSelectIndex((idx) => {
    updateInfo(idx);
    if (state.marker) {
      map.panTo(state.marker.getLatLng());
      state.marker.openPopup();
    }
  });
}

function updateInfo(index: number): void {
  const points = state.points;
  if (!points.length) return;
  const i = Math.max(0, Math.min(index, points.length - 1));
  state.index = i;
  const p = points[i]!;

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
  setAddressText(cached ?? null);

  if (state.marker) {
    state.marker.setLatLng([p.lat, p.lon]);
    state.marker.setPopupContent(pointPopupHtml(p));
  }

  if (state.chart) {
    state.chart.setActiveIndex(i);
  }
}

async function inferAddress(optIndex?: number): Promise<void> {
  const forIndex =
    optIndex != null && Number.isFinite(optIndex) ? optIndex : state.index;
  const p = state.points[forIndex];
  if (!p) return;

  if (forIndex !== state.index) {
    updateInfo(forIndex);
  }

  if (state.addressCache.has(forIndex)) {
    const text = state.addressCache.get(forIndex)!;
    setAddressText(text);
    setPopupContentForIndex(forIndex);
    return;
  }

  els.btnAddress.disabled = true;
  setAddressText("Looking up address…");
  setPopupContentForIndex(forIndex, { loading: true });
  try {
    const { text, source } = await reverseGeocode(p.lat, p.lon);
    state.addressCache.set(forIndex, text);
    if (state.index === forIndex) {
      setAddressText(text);
      setStatus(`Address via ${source}`, "ok");
    }
    setPopupContentForIndex(forIndex);
  } catch (err) {
    const msg = "Could not get address";
    if (state.index === forIndex) {
      setAddressText(msg);
      const message = err instanceof Error ? err.message : "Geocoding error";
      setStatus(message, "error");
    }
    setPopupContentForIndex(forIndex, { error: msg });
  } finally {
    els.btnAddress.disabled = !state.points.length;
  }
}

function clearRoute(): void {
  routeLayer.clearLayers();
  state.polyline = null;
  state.pathLayers = [];
  state.pathHasKmlStyle = [];
  state.pointLayers = [];
  state.overlayLayers = [];
  state.marker = null;
  state.vertices = null;
  state.track = null;
  state.addressCache.clear();
  setAddressText(null);
  els.btnAddress.disabled = true;
  els.treeCard.hidden = true;
  els.treeRoot.replaceChildren();
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }
}

function revokeArchive(): void {
  if (state.archive) {
    state.archive.revoke();
    state.archive = null;
  }
}

function lineStyleForPath(
  track: Track,
  pathIndex: number,
  fallback: LineStyle
): LineStyle {
  const kml = track.pathStyles?.[pathIndex];
  if (!kml) return fallback;
  return {
    color: kml.color,
    weight: kml.weight ?? fallback.weight,
    opacity: kml.opacity,
  };
}

function makeKmlIcon(href: string, scale = 1): L.Icon {
  const size = Math.max(12, Math.round(32 * scale));
  return L.icon({
    iconUrl: href,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size + 4],
  });
}

function setPathVisible(index: number, visible: boolean): void {
  const layer = state.pathLayers[index];
  if (!layer) return;
  if (visible) {
    if (!routeLayer.hasLayer(layer)) layer.addTo(routeLayer);
  } else if (routeLayer.hasLayer(layer)) {
    routeLayer.removeLayer(layer);
  }
}

function setPointVisible(index: number, visible: boolean): void {
  const layer = state.pointLayers[index];
  if (!layer) return;
  if (visible) {
    if (!routeLayer.hasLayer(layer)) layer.addTo(routeLayer);
  } else if (routeLayer.hasLayer(layer)) {
    routeLayer.removeLayer(layer);
  }
}

function setOverlayVisible(index: number, visible: boolean): void {
  const layer = state.overlayLayers[index];
  if (!layer) return;
  if (visible) {
    if (!routeLayer.hasLayer(layer)) layer.addTo(routeLayer);
  } else if (routeLayer.hasLayer(layer)) {
    routeLayer.removeLayer(layer);
  }
}

function setNodeVisible(node: KmlTreeNode, visible: boolean): void {
  for (const i of node.pathIndices ?? []) setPathVisible(i, visible);
  for (const i of node.pointIndices ?? []) setPointVisible(i, visible);
  for (const i of node.overlayIndices ?? []) setOverlayVisible(i, visible);
  for (const child of node.children ?? []) setNodeVisible(child, visible);
}

function fitNode(node: KmlTreeNode): void {
  const bounds = L.latLngBounds([]);
  const collect = (n: KmlTreeNode): void => {
    for (const i of n.pathIndices ?? []) {
      const layer = state.pathLayers[i];
      if (layer) bounds.extend(layer.getBounds());
    }
    for (const i of n.pointIndices ?? []) {
      const layer = state.pointLayers[i];
      if (layer) bounds.extend(layer.getLatLng());
    }
    for (const i of n.overlayIndices ?? []) {
      const layer = state.overlayLayers[i];
      if (layer) bounds.extend(layer.getBounds());
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(node);
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
  }
}

function featureCount(node: KmlTreeNode): number {
  let n =
    (node.pathIndices?.length ?? 0) +
    (node.pointIndices?.length ?? 0) +
    (node.overlayIndices?.length ?? 0);
  for (const child of node.children ?? []) n += featureCount(child);
  return n;
}

function renderTree(tree: KmlTreeNode): void {
  els.treeRoot.replaceChildren();
  const count = featureCount(tree);
  els.treeCount.textContent = String(count);
  els.treeCard.hidden = false;

  const ul = document.createElement("ul");
  for (const child of tree.children ?? [tree]) {
    ul.appendChild(buildTreeItem(child, true));
  }
  els.treeRoot.appendChild(ul);
}

function buildTreeItem(node: KmlTreeNode, expanded: boolean): HTMLLIElement {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "kml-tree-row";

  const hasChildren = (node.children?.length ?? 0) > 0;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "kml-tree-toggle";
  toggle.textContent = hasChildren ? (expanded ? "▼" : "▶") : "";
  toggle.disabled = !hasChildren;
  toggle.setAttribute("aria-label", expanded ? "Collapse" : "Expand");

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "kml-tree-check";
  check.checked = true;
  check.title = "Show / hide";
  check.addEventListener("change", () => {
    setNodeVisible(node, check.checked);
  });

  const swatch = document.createElement("span");
  swatch.className = "kml-tree-swatch";
  if (node.style?.color) {
    swatch.style.background = node.style.color;
    swatch.style.opacity = String(node.style.opacity ?? 1);
  } else if (node.kind === "overlay") {
    swatch.style.background = "#c4a35a";
  } else if (node.kind === "folder") {
    swatch.style.background = "transparent";
    swatch.style.borderColor = "transparent";
  } else {
    swatch.style.background = state.lineStyle.color;
  }

  row.append(toggle, check, swatch);

  if (node.iconHref) {
    const img = document.createElement("img");
    img.className = "kml-tree-icon";
    img.src = node.iconHref;
    img.alt = "";
    row.appendChild(img);
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = "kml-tree-label";
  label.textContent = node.name;
  label.title = node.name;
  label.addEventListener("click", () => fitNode(node));
  row.appendChild(label);

  if (node.kind === "folder") {
    const meta = document.createElement("span");
    meta.className = "kml-tree-meta";
    meta.textContent = String(featureCount(node));
    row.appendChild(meta);
  }

  li.appendChild(row);

  if (hasChildren) {
    const childUl = document.createElement("ul");
    childUl.className = "kml-tree-children";
    childUl.hidden = !expanded;
    for (const child of node.children!) {
      childUl.appendChild(buildTreeItem(child, false));
    }
    li.appendChild(childUl);
    toggle.addEventListener("click", () => {
      const open = childUl.hidden;
      childUl.hidden = !open;
      toggle.textContent = open ? "▼" : "▶";
      toggle.setAttribute("aria-label", open ? "Collapse" : "Expand");
    });
  }

  return li;
}

const MAX_VERTEX_MARKERS_POINTS = 2500;
const MAX_ELEVATION_CHART_POINTS = 2500;
const MAX_ELEVATION_ENRICH_POINTS = 1500;

function drawRoute(track: Track): void {
  clearRoute();
  const points = track.points;
  state.points = points;
  state.name = track.name;
  state.track = track;
  els.routeName.textContent = track.name;

  const fallback = suggestedLineStyle(track.paths.length);
  applyLineStyle(fallback);

  const bounds = L.latLngBounds([]);

  for (let i = 0; i < track.paths.length; i++) {
    const path = track.paths[i]!;
    if (path.length < 2) continue;
    const latlngs = path.map((p) => [p.lat, p.lon] as L.LatLngExpression);
    const hasKml = !!track.pathStyles?.[i];
    const style = lineStyleForPath(track, i, fallback);
    const poly = L.polyline(latlngs, {
      color: style.color,
      weight: style.weight,
      opacity: style.opacity,
    }).addTo(routeLayer);
    poly.on("click", (e: L.LeafletMouseEvent) => {
      if (!state.points.length) return;
      const nearest = nearestIndex(e.latlng.lat, e.latlng.lng);
      updateInfo(nearest);
      if (state.marker) state.marker.openPopup();
    });
    state.pathLayers.push(poly);
    state.pathHasKmlStyle.push(hasKml);
    bounds.extend(poly.getBounds());
  }

  if (state.pathLayers.length === 1) {
    state.polyline = state.pathLayers[0]!;
  }

  for (const mp of track.mapPoints ?? []) {
    const markerOpts: L.MarkerOptions = {
      title: mp.name,
      zIndexOffset: 400,
    };
    if (mp.style?.href) {
      markerOpts.icon = makeKmlIcon(mp.style.href, mp.style.scale ?? 1);
    }
    const marker = L.marker([mp.lat, mp.lon], markerOpts)
      .bindPopup(`<strong>${escapeHtml(mp.name)}</strong><br/>Lat: ${mp.lat.toFixed(6)}<br/>Lon: ${mp.lon.toFixed(6)}`)
      .addTo(routeLayer);
    state.pointLayers.push(marker);
    bounds.extend(marker.getLatLng());
  }

  for (const ov of track.overlays ?? []) {
    const image = L.imageOverlay(
      ov.href,
      [
        [ov.south, ov.west],
        [ov.north, ov.east],
      ],
      { opacity: ov.opacity, interactive: true }
    ).addTo(routeLayer);
    image.bindPopup(`<strong>${escapeHtml(ov.name)}</strong>`);
    state.overlayLayers.push(image);
    bounds.extend(image.getBounds());
  }

  const showVertices =
    track.paths.length === 1 &&
    points.length > 0 &&
    points.length <= MAX_VERTEX_MARKERS_POINTS;
  if (showVertices) {
    const step = Math.max(1, Math.floor(points.length / 80));
    const pointOpts = pointMarkerOptions();
    state.vertices = L.layerGroup();
    for (let i = 0; i < points.length; i += step) {
      const p = points[i]!;
      const circle = L.circleMarker([p.lat, p.lon], pointOpts);
      circle.bindPopup(pointPopupHtml(p));
      circle.on("click", () => updateInfo(p.index));
      circle.addTo(state.vertices);
    }

    const last = points[points.length - 1]!;
    if ((points.length - 1) % step !== 0) {
      const circle = L.circleMarker([last.lat, last.lon], pointOpts);
      circle.bindPopup(pointPopupHtml(last));
      circle.on("click", () => updateInfo(last.index));
      circle.addTo(state.vertices);
    }
    state.vertices.addTo(routeLayer);
  }

  if (points.length) {
    const first = points[0]!;
    state.marker = L.marker([first.lat, first.lon], {
      draggable: false,
      title: "Current position",
      zIndexOffset: 1000,
    })
      .bindPopup(pointPopupHtml(first))
      .addTo(routeLayer);

    els.slider.disabled = false;
    els.slider.min = "0";
    els.slider.max = String(points.length - 1);
    els.slider.value = "0";

    if (points.length <= MAX_ELEVATION_CHART_POINTS) {
      state.chart = createElevationChart(els.chartCanvas, points);
      wireChartSelect(state.chart);
    } else {
      state.chart = null;
    }
    updateInfo(0);
  } else {
    els.slider.disabled = true;
    els.slider.value = "0";
    els.sliderLabel.textContent = "0 / 0";
    els.distanceLabel.textContent = "0 km";
    els.pointBadge.textContent = "—";
    els.infoLat.textContent = "—";
    els.infoLon.textContent = "—";
    els.infoElev.textContent = "—";
    els.infoDist.textContent = "—";
    els.btnAddress.disabled = true;
  }

  if (track.tree) {
    renderTree(track.tree);
  }

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [28, 28] });
  }
}

function nearestIndex(lat: number, lon: number): number {
  let best = 0;
  let bestD = Infinity;
  const pts = state.points;
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]!;
    const d = haversine(lat, lon, pt.lat, pt.lon);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

async function loadFromBytes(
  buffer: ArrayBuffer,
  label?: string,
  contentType?: string | null
): Promise<void> {
  revokeArchive();
  let text: string;
  let resolveHref: HrefResolver | undefined;
  try {
    if (isKmz(buffer, label, contentType)) {
      setStatus(`Extracting ${label || "KMZ"}…`);
      const archive = openKmz(buffer);
      state.archive = archive;
      text = archive.kmlText;
      resolveHref = (href) => archive.resolveHref(href);
    } else {
      text = new TextDecoder("utf-8").decode(buffer);
    }
  } catch (err) {
    revokeArchive();
    const message = err instanceof Error ? err.message : "Error reading file";
    setStatus(message, "error");
    return;
  }
  await loadFromText(text, label, resolveHref);
}

async function loadFromText(
  text: string,
  label?: string,
  resolveHref?: HrefResolver
): Promise<void> {
  setStatus(`Processing ${label || "KML"}…`);
  els.slider.disabled = true;
  let track: Track;
  try {
    track = parseKml(text, resolveHref);
  } catch (err) {
    revokeArchive();
    const message = err instanceof Error ? err.message : "Error reading KML";
    setStatus(message, "error");
    return;
  }

  drawRoute(track);

  const pathCount = track.paths.length;
  const pointCount = track.points.length;
  const mapPointCount = track.mapPoints?.length ?? 0;
  const overlayCount = track.overlays?.length ?? 0;
  const extras: string[] = [];
  if (mapPointCount) extras.push(`${mapPointCount.toLocaleString()} markers`);
  if (overlayCount) extras.push(`${overlayCount.toLocaleString()} overlays`);
  const geometryLabel =
    pathCount > 1
      ? `${pathCount.toLocaleString()} outlines · ${pointCount.toLocaleString()} vertices`
      : pointCount
        ? `${pointCount.toLocaleString()} points`
        : "no route line";
  const fullLabel = extras.length
    ? `${geometryLabel} · ${extras.join(" · ")}`
    : geometryLabel;

  let elevMeta: ElevationMeta = {
    source: track.hasRealElevation
      ? "KML"
      : pointCount
        ? "KML (no altitude)"
        : "—",
    enriched: false,
  };
  try {
    if (!pointCount) {
      setStatus(`Ready · ${fullLabel}`, "ok");
    } else {
      const tooLargeToEnrich =
        pointCount > MAX_ELEVATION_ENRICH_POINTS || pathCount > 8;
      if (tooLargeToEnrich && needsElevationEnrichment(track.points)) {
        elevMeta = { source: "Skipped (large KML)", enriched: false };
        setStatus(`Ready · ${fullLabel}`, "ok");
      } else if (needsElevationEnrichment(track.points)) {
        elevMeta = await ensureElevations(track.points, (msg) => setStatus(msg));
        if (state.chart) {
          state.chart.destroy();
          state.chart = createElevationChart(els.chartCanvas, track.points);
          wireChartSelect(state.chart);
          updateInfo(state.index);
        }
        if (state.vertices) {
          state.vertices.eachLayer((layer) => {
            const marker = layer as L.CircleMarker;
            const ll = marker.getLatLng();
            const idx = nearestIndex(ll.lat, ll.lng);
            const point = track.points[idx];
            if (point) marker.setPopupContent(pointPopupHtml(point));
          });
        }
        setStatus(
          elevMeta.enriched
            ? `Elevation enriched (${elevMeta.source}). ${fullLabel}.`
            : `Ready · ${fullLabel}`,
          "ok"
        );
      } else {
        setStatus(`Ready · ${fullLabel} · elevation from KML`, "ok");
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Route loaded, but elevation profile failed: ${message}`, "error");
    elevMeta = { source: "Unavailable", enriched: false };
  }

  els.elevSource.textContent = elevMeta.source;
}

/** Convert public Google Drive share links to a direct-download URL. */
function normalizeGoogleDriveUrl(href: string): string {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return href;
  }
  if (!/(^|\.)drive\.google\.com$/i.test(u.hostname)) return href;

  let fileId: string | null = null;
  const pathMatch = u.pathname.match(/\/file\/d\/([^/]+)/);
  if (pathMatch) fileId = pathMatch[1] ?? null;
  if (!fileId) fileId = u.searchParams.get("id");

  if (!fileId) return href;
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

type UrlValidation =
  | { ok: true; url: string; label: string }
  | { ok: false; error: string };

function validateKmlUrl(raw: string | null | undefined): UrlValidation {
  const trimmed = (raw || "").trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a URL" };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are supported" };
  }

  const resolved = normalizeGoogleDriveUrl(parsed.href);
  const label = parsed.pathname.split("/").filter(Boolean).pop() || resolved;
  return { ok: true, url: resolved, label };
}

/**
 * Resolve ?url= from the query string.
 * Returns { url, label }, false if present but invalid, or null if absent.
 */
function resolveUrlParam(): { url: string; label: string } | false | null {
  const raw = new URLSearchParams(window.location.search).get("url");
  if (!raw || !raw.trim()) return null;

  const result = validateKmlUrl(raw);
  if (!result.ok) {
    setStatus(`Invalid url parameter: ${result.error}`, "error");
    return false;
  }
  return { url: result.url, label: result.label };
}

function openUrlModal(): void {
  els.urlError.textContent = "";
  els.urlInput.value = "";
  els.urlModal.hidden = false;
  els.urlInput.focus();
}

function closeUrlModal(): void {
  els.urlModal.hidden = true;
  els.urlError.textContent = "";
}

function openStyleModal(): void {
  syncMapStyleInputs();
  els.styleModal.hidden = false;
  els.lineColor.focus();
}

function closeStyleModal(): void {
  els.styleModal.hidden = true;
}

function submitUrlModal(): void {
  const result = validateKmlUrl(els.urlInput.value);
  if (!result.ok) {
    els.urlError.textContent = result.error;
    els.urlInput.focus();
    return;
  }
  els.urlError.textContent = "";
  closeUrlModal();
  void loadUrl(result.url, result.label);
}

async function loadUrl(url: string, label?: string): Promise<void> {
  setStatus(`Downloading ${label || url}…`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    await loadFromBytes(buffer, label || url, res.headers.get("content-type"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isNetwork =
      err instanceof TypeError ||
      /failed to fetch|networkerror|load failed/i.test(msg);
    if (isNetwork) {
      setCorsFailureStatus(url);
    } else {
      setStatus(`Could not load KML/KMZ: ${msg}`, "error");
    }
  }
}

els.lineColor.addEventListener("input", () => {
  applyLineStyle(readLineStyleFromInputs());
});

els.lineWidth.addEventListener("input", () => {
  applyLineStyle(readLineStyleFromInputs());
});

els.lineOpacity.addEventListener("input", () => {
  applyLineStyle(readLineStyleFromInputs());
});

els.pointColor.addEventListener("input", () => {
  applyPointStyle(readPointStyleFromInputs());
});

els.pointRadius.addEventListener("input", () => {
  applyPointStyle(readPointStyleFromInputs());
});

els.pointOpacity.addEventListener("input", () => {
  applyPointStyle(readPointStyleFromInputs());
});

els.slider.addEventListener("input", () => {
  updateInfo(Number(els.slider.value));
});

els.slider.addEventListener("change", () => {
  if (state.marker) {
    map.panTo(state.marker.getLatLng());
  }
});

els.file.addEventListener("change", async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  try {
    const buffer = await file.arrayBuffer();
    await loadFromBytes(buffer, file.name, file.type || null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error reading file";
    setStatus(message, "error");
  }
  els.file.value = "";
});

els.btnSample.addEventListener("click", () => {
  void loadUrl(SAMPLE_KML, "Demo data");
});

els.btnOpenUrl.addEventListener("click", () => {
  openUrlModal();
});

els.btnLineStyle.addEventListener("click", () => {
  openStyleModal();
});

els.btnStyleDone.addEventListener("click", () => {
  closeStyleModal();
});

els.btnUrlCancel.addEventListener("click", () => {
  closeUrlModal();
});

els.btnUrlLoad.addEventListener("click", () => {
  submitUrlModal();
});

els.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitUrlModal();
  }
});

els.urlModal.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-close-modal]")) {
    closeUrlModal();
  }
});

els.styleModal.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("[data-close-style-modal]")) {
    closeStyleModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.urlModal.hidden) {
    closeUrlModal();
    return;
  }
  if (!els.styleModal.hidden) {
    closeStyleModal();
  }
});

els.btnAddress.addEventListener("click", () => {
  void inferAddress();
});

map.getContainer().addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest(".btn-popup-address") as HTMLElement | null;
  if (!btn) return;
  e.preventDefault();
  const idx = Number(btn.dataset.pointIndex);
  if (!Number.isFinite(idx)) return;
  void inferAddress(idx);
});

window.addEventListener("resize", () => {
  map.invalidateSize();
});

syncMapStyleInputs();

const fromQuery = resolveUrlParam();
if (fromQuery) {
  void loadUrl(fromQuery.url, fromQuery.label);
} else if (fromQuery !== false) {
  void loadUrl(SAMPLE_KML, "Demo data");
}
