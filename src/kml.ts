import type {
  GroundOverlayItem,
  HrefResolver,
  KmlIconStyle,
  KmlLineStyle,
  KmlTreeNode,
  MapPoint,
  RawCoordinate,
  Track,
  TrackPoint,
} from "./types";

const KML_NS = "http://www.opengis.net/kml/2.2";

function localName(el: Node): string {
  const element = el as Element;
  return (element.localName || element.nodeName || "")
    .replace(/^.*:/, "")
    .toLowerCase();
}

function findAll(root: Node, name: string): Element[] {
  const out: Element[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === 1 && localName(node) === name) {
      out.push(node as Element);
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return out;
}

function findFirst(root: Node, name: string): Element | null {
  return findAll(root, name)[0] ?? null;
}

function textOf(el: Element | null): string {
  return el ? (el.textContent || "").trim() : "";
}

function attrId(el: Element): string {
  return el.getAttribute("id") || "";
}

/** Haversine distance in meters */
export function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function parseCoordinates(text: string): RawCoordinate[] {
  const points: RawCoordinate[] = [];
  const tokens = text.trim().split(/\s+/);
  for (const token of tokens) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lon = parseFloat(parts[0]!);
    const lat = parseFloat(parts[1]!);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let elev: number | null =
      parts.length > 2 && parts[2] !== "" ? parseFloat(parts[2]!) : null;
    if (!Number.isFinite(elev)) elev = null;
    points.push({ lat, lon, elev });
  }
  return points;
}

function dedupeConsecutive(points: RawCoordinate[]): RawCoordinate[] {
  if (points.length === 0) return points;
  const out: RawCoordinate[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    if (prev.lat === cur.lat && prev.lon === cur.lon && prev.elev === cur.elev) {
      continue;
    }
    out.push(cur);
  }
  return out;
}

function coordinatesOf(el: Element): RawCoordinate[] {
  const coordEl = findFirst(el, "coordinates");
  return coordEl ? parseCoordinates(textOf(coordEl)) : [];
}

function flattenPaths(paths: RawCoordinate[][]): TrackPoint[] {
  const out: TrackPoint[] = [];
  let cum = 0;
  for (const path of paths) {
    const pts = dedupeConsecutive(path);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      if (i > 0) {
        const prev = pts[i - 1]!;
        cum += haversine(prev.lat, prev.lon, p.lat, p.lon);
      }
      out.push({
        lat: p.lat,
        lon: p.lon,
        elev: p.elev,
        index: out.length,
        distanceM: cum,
      });
    }
  }
  return out;
}

/** KML LineStyle color is aabbggrr → #rrggbb + opacity 0–1 */
export function parseKmlColor(abgr: string): { color: string; opacity: number } | null {
  const hex = abgr.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex) && !/^[0-9a-fA-F]{8}$/.test(hex)) {
    return null;
  }
  const full = hex.length === 6 ? `ff${hex}` : hex;
  const aa = parseInt(full.slice(0, 2), 16);
  const bb = full.slice(2, 4);
  const gg = full.slice(4, 6);
  const rr = full.slice(6, 8);
  return {
    color: `#${rr}${gg}${bb}`.toLowerCase(),
    opacity: Math.round((aa / 255) * 1000) / 1000,
  };
}

interface ResolvedStyle {
  line?: KmlLineStyle;
  icon?: KmlIconStyle;
}

function parseLineStyle(styleEl: Element | null): KmlLineStyle | undefined {
  if (!styleEl) return undefined;
  const lineEl = findFirst(styleEl, "linestyle");
  if (!lineEl) return undefined;
  const colorText = textOf(findFirst(lineEl, "color"));
  const widthText = textOf(findFirst(lineEl, "width"));
  const parsed = colorText ? parseKmlColor(colorText) : null;
  const weight = widthText ? parseFloat(widthText) : undefined;
  if (!parsed && !(weight != null && Number.isFinite(weight))) return undefined;
  return {
    color: parsed?.color ?? "#5b9cff",
    opacity: parsed?.opacity ?? 0.9,
    weight: weight != null && Number.isFinite(weight) ? weight : undefined,
  };
}

function parseIconStyle(
  styleEl: Element | null,
  resolveHref?: HrefResolver
): KmlIconStyle | undefined {
  if (!styleEl) return undefined;
  const iconStyleEl = findFirst(styleEl, "iconstyle");
  if (!iconStyleEl) return undefined;
  const iconEl = findFirst(iconStyleEl, "icon");
  const hrefRaw = textOf(iconEl ? findFirst(iconEl, "href") : null);
  const scaleText = textOf(findFirst(iconStyleEl, "scale"));
  const scale = scaleText ? parseFloat(scaleText) : undefined;
  let href: string | undefined;
  if (hrefRaw) {
    if (/^(https?:|data:|blob:)/i.test(hrefRaw)) {
      href = hrefRaw;
    } else if (resolveHref) {
      href = resolveHref(hrefRaw) ?? undefined;
    } else {
      href = hrefRaw;
    }
  }
  if (!href && !(scale != null && Number.isFinite(scale))) return undefined;
  return {
    href,
    scale: scale != null && Number.isFinite(scale) ? scale : undefined,
  };
}

function parseStyleElement(
  styleEl: Element,
  resolveHref?: HrefResolver
): ResolvedStyle {
  return {
    line: parseLineStyle(styleEl),
    icon: parseIconStyle(styleEl, resolveHref),
  };
}

function collectStyleIndex(
  root: Document,
  resolveHref?: HrefResolver
): Map<string, ResolvedStyle> {
  const map = new Map<string, ResolvedStyle>();

  for (const styleEl of findAll(root, "style")) {
    const id = attrId(styleEl);
    if (!id) continue;
    map.set(id, parseStyleElement(styleEl, resolveHref));
  }

  for (const styleMapEl of findAll(root, "stylemap")) {
    const id = attrId(styleMapEl);
    if (!id) continue;
    const pairs = findAll(styleMapEl, "pair");
    let normalRef: string | null = null;
    let inline: ResolvedStyle | null = null;
    for (const pair of pairs) {
      const key = textOf(findFirst(pair, "key")).toLowerCase();
      if (key && key !== "normal") continue;
      const styleUrl = textOf(findFirst(pair, "styleurl"));
      if (styleUrl.startsWith("#")) {
        normalRef = styleUrl.slice(1);
      }
      const nested = findFirst(pair, "style");
      if (nested) inline = parseStyleElement(nested, resolveHref);
    }
    if (inline) {
      map.set(id, inline);
    } else if (normalRef && map.has(normalRef)) {
      map.set(id, map.get(normalRef)!);
    }
  }

  return map;
}

function resolvePlacemarkStyle(
  pm: Element,
  styleIndex: Map<string, ResolvedStyle>,
  resolveHref?: HrefResolver
): ResolvedStyle {
  const inline = findFirst(pm, "style");
  // Prefer direct Style child of Placemark, not nested under geometry
  let directStyle: Element | null = null;
  for (let c = pm.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && localName(c) === "style") {
      directStyle = c as Element;
      break;
    }
  }
  const styleEl = directStyle || inline;
  const fromInline = styleEl ? parseStyleElement(styleEl, resolveHref) : {};

  let fromUrl: ResolvedStyle = {};
  const styleUrl = textOf(findFirst(pm, "styleurl"));
  if (styleUrl.startsWith("#")) {
    fromUrl = styleIndex.get(styleUrl.slice(1)) ?? {};
  }

  return {
    line: fromInline.line ?? fromUrl.line,
    icon: fromInline.icon ?? fromUrl.icon,
  };
}

function collectLineGeometries(root: Element): Element[] {
  const out: Element[] = [];
  const walk = (node: Node, insidePoint: boolean): void => {
    if (node.nodeType !== 1) {
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, insidePoint);
      return;
    }
    const name = localName(node);
    if (name === "point") {
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c, true);
      return;
    }
    if (!insidePoint && (name === "linestring" || name === "linearring")) {
      out.push(node as Element);
    }
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, insidePoint);
  };
  walk(root, false);
  return out;
}

function collectPoints(root: Element): Element[] {
  return findAll(root, "point");
}

function childContainers(el: Element): Element[] {
  const out: Element[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1) continue;
    const name = localName(c);
    if (
      name === "folder" ||
      name === "document" ||
      name === "placemark" ||
      name === "groundoverlay"
    ) {
      out.push(c as Element);
    }
  }
  return out;
}

function featureName(el: Element, fallback: string): string {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && localName(c) === "name") {
      const t = textOf(c as Element);
      if (t) return t;
    }
  }
  return fallback;
}

function parseLatLonBox(el: Element): {
  north: number;
  south: number;
  east: number;
  west: number;
} | null {
  const box = findFirst(el, "latlonbox");
  if (!box) return null;
  const north = parseFloat(textOf(findFirst(box, "north")));
  const south = parseFloat(textOf(findFirst(box, "south")));
  const east = parseFloat(textOf(findFirst(box, "east")));
  const west = parseFloat(textOf(findFirst(box, "west")));
  if (
    ![north, south, east, west].every((n) => Number.isFinite(n)) ||
    north === south ||
    east === west
  ) {
    return null;
  }
  return { north, south, east, west };
}

function resolveOverlayHref(
  el: Element,
  resolveHref?: HrefResolver
): string | null {
  const iconEl = findFirst(el, "icon");
  const hrefRaw = textOf(iconEl ? findFirst(iconEl, "href") : null);
  if (!hrefRaw) return null;
  if (/^(https?:|data:|blob:)/i.test(hrefRaw)) return hrefRaw;
  if (resolveHref) return resolveHref(hrefRaw);
  return hrefRaw;
}

interface ParseCtx {
  paths: RawCoordinate[][];
  pathStyles: (KmlLineStyle | undefined)[];
  mapPoints: MapPoint[];
  overlays: GroundOverlayItem[];
  styleIndex: Map<string, ResolvedStyle>;
  resolveHref?: HrefResolver;
  idSeq: number;
  folderCount: number;
  placemarkCount: number;
}

function nextId(ctx: ParseCtx, prefix: string): string {
  ctx.idSeq += 1;
  return `${prefix}-${ctx.idSeq}`;
}

function walkContainer(el: Element, ctx: ParseCtx): KmlTreeNode[] {
  const nodes: KmlTreeNode[] = [];
  for (const child of childContainers(el)) {
    const kind = localName(child);
    if (kind === "folder" || kind === "document") {
      ctx.folderCount += kind === "folder" ? 1 : 0;
      const children = walkContainer(child, ctx);
      nodes.push({
        id: nextId(ctx, "folder"),
        kind: "folder",
        name: featureName(child, kind === "document" ? "Document" : "Folder"),
        children,
      });
    } else if (kind === "placemark") {
      const node = walkPlacemark(child, ctx);
      if (node) nodes.push(node);
    } else if (kind === "groundoverlay") {
      const node = walkGroundOverlay(child, ctx);
      if (node) nodes.push(node);
    }
  }
  return nodes;
}

function walkPlacemark(pm: Element, ctx: ParseCtx): KmlTreeNode | null {
  ctx.placemarkCount += 1;
  const name = featureName(pm, "Placemark");
  const style = resolvePlacemarkStyle(pm, ctx.styleIndex, ctx.resolveHref);
  const pathIndices: number[] = [];
  const pointIndices: number[] = [];

  for (const geom of collectLineGeometries(pm)) {
    const pts = coordinatesOf(geom);
    if (pts.length < 2) continue;
    pathIndices.push(ctx.paths.length);
    ctx.paths.push(pts);
    ctx.pathStyles.push(style.line);
  }

  for (const pointEl of collectPoints(pm)) {
    const coords = coordinatesOf(pointEl);
    const p = coords[0];
    if (!p) continue;
    pointIndices.push(ctx.mapPoints.length);
    ctx.mapPoints.push({
      lat: p.lat,
      lon: p.lon,
      name,
      style: style.icon,
    });
  }

  if (pathIndices.length === 0 && pointIndices.length === 0) return null;

  return {
    id: nextId(ctx, "pm"),
    kind: "placemark",
    name,
    pathIndices: pathIndices.length ? pathIndices : undefined,
    pointIndices: pointIndices.length ? pointIndices : undefined,
    style: style.line,
    iconHref: style.icon?.href,
  };
}

function walkGroundOverlay(el: Element, ctx: ParseCtx): KmlTreeNode | null {
  const box = parseLatLonBox(el);
  const href = resolveOverlayHref(el, ctx.resolveHref);
  if (!box || !href) return null;

  const colorText = textOf(findFirst(el, "color"));
  const parsed = colorText ? parseKmlColor(colorText) : null;
  const name = featureName(el, "Overlay");
  const index = ctx.overlays.length;
  ctx.overlays.push({
    name,
    href,
    north: box.north,
    south: box.south,
    east: box.east,
    west: box.west,
    opacity: parsed?.opacity ?? 1,
  });

  return {
    id: nextId(ctx, "ov"),
    kind: "overlay",
    name,
    overlayIndices: [index],
    iconHref: href,
  };
}

function countTreeFeatures(node: KmlTreeNode): number {
  let n = 0;
  if (node.pathIndices?.length) n += node.pathIndices.length;
  if (node.pointIndices?.length) n += node.pointIndices.length;
  if (node.overlayIndices?.length) n += node.overlayIndices.length;
  for (const child of node.children ?? []) n += countTreeFeatures(child);
  return n;
}

function shouldAttachTree(ctx: ParseCtx, rootChildren: KmlTreeNode[]): boolean {
  if (ctx.folderCount > 0) return true;
  if (ctx.mapPoints.length > 0 || ctx.overlays.length > 0) return true;
  if (ctx.placemarkCount >= 2) return true;
  if (rootChildren.length >= 2) return true;
  return false;
}

function flatFallback(doc: Document): {
  paths: RawCoordinate[][];
  pathStyles: (KmlLineStyle | undefined)[];
} {
  const geomEls = [
    ...findAll(doc, "linestring"),
    ...findAll(doc, "linearring"),
  ];
  const paths: RawCoordinate[][] = [];
  for (const el of geomEls) {
    const pts = coordinatesOf(el);
    if (pts.length >= 2) paths.push(pts);
  }
  if (paths.length === 0) {
    const coordEls = findAll(doc, "coordinates");
    let raw: RawCoordinate[] = [];
    for (const el of coordEls) {
      raw = raw.concat(parseCoordinates(textOf(el)));
    }
    if (raw.length >= 2) paths.push(raw);
  }
  return {
    paths,
    pathStyles: paths.map(() => undefined),
  };
}

/**
 * Parse KML into paths, optional layer tree, map points, and ground overlays.
 * Coordinate order in KML: lon,lat[,altitude]
 */
export function parseKml(text: string, resolveHref?: HrefResolver): Track {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid or malformed KML");
  }

  const styleIndex = collectStyleIndex(doc, resolveHref);
  const ctx: ParseCtx = {
    paths: [],
    pathStyles: [],
    mapPoints: [],
    overlays: [],
    styleIndex,
    resolveHref,
    idSeq: 0,
    folderCount: 0,
    placemarkCount: 0,
  };

  const kmlRoot =
    findFirst(doc, "kml") ||
    (doc.documentElement ? doc.documentElement : null);
  let rootChildren: KmlTreeNode[] = [];
  if (kmlRoot) {
    rootChildren = walkContainer(kmlRoot, ctx);
  }

  if (ctx.paths.length === 0 && ctx.mapPoints.length === 0 && ctx.overlays.length === 0) {
    const fallback = flatFallback(doc);
    ctx.paths = fallback.paths;
    ctx.pathStyles = fallback.pathStyles;
  }

  if (ctx.paths.length === 0 && ctx.mapPoints.length === 0 && ctx.overlays.length === 0) {
    throw new Error("No coordinates found in the KML");
  }

  const nameEl =
    findFirst(doc, "name") || doc.getElementsByTagNameNS(KML_NS, "name")[0];
  const name = textOf(nameEl ?? null) || "Unnamed route";

  const points = flattenPaths(ctx.paths);
  const hasRealElevation = points.some(
    (p) => p.elev != null && Math.abs(p.elev) > 0.01
  );

  let tree: KmlTreeNode | undefined;
  if (shouldAttachTree(ctx, rootChildren) && rootChildren.length > 0) {
    tree = {
      id: "root",
      kind: "folder",
      name,
      children: rootChildren,
    };
    if (countTreeFeatures(tree) === 0) tree = undefined;
  }

  const track: Track = {
    name,
    points,
    paths: ctx.paths,
    hasRealElevation,
    totalDistanceM: points.length ? points[points.length - 1]!.distanceM : 0,
  };

  if (tree) track.tree = tree;
  if (ctx.pathStyles.some(Boolean)) track.pathStyles = ctx.pathStyles;
  if (ctx.mapPoints.length) track.mapPoints = ctx.mapPoints;
  if (ctx.overlays.length) track.overlays = ctx.overlays;

  return track;
}
