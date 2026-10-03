import type { RawCoordinate, Track, TrackPoint } from "./types";

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

function withDistances(points: RawCoordinate[]): TrackPoint[] {
  let cum = 0;
  return points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1]!;
      cum += haversine(prev.lat, prev.lon, p.lat, p.lon);
    }
    return {
      lat: p.lat,
      lon: p.lon,
      elev: p.elev,
      index: i,
      distanceM: cum,
    };
  });
}

/**
 * Parse KML text into named track points from LineString coordinates.
 * Coordinate order in KML: lon,lat[,altitude]
 */
export function parseKml(text: string): Track {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid or malformed KML");
  }

  const nameEl =
    findFirst(doc, "name") || doc.getElementsByTagNameNS(KML_NS, "name")[0];
  const name = textOf(nameEl ?? null) || "Unnamed route";

  const coordEls = findAll(doc, "coordinates");
  let raw: RawCoordinate[] = [];
  for (const el of coordEls) {
    raw = raw.concat(parseCoordinates(textOf(el)));
  }

  if (raw.length === 0) {
    throw new Error("No coordinates found in the KML");
  }

  const points = withDistances(dedupeConsecutive(raw));
  const hasRealElevation = points.some(
    (p) => p.elev != null && Math.abs(p.elev) > 0.01
  );

  return {
    name,
    points,
    hasRealElevation,
    totalDistanceM: points.length ? points[points.length - 1]!.distanceM : 0,
  };
}
