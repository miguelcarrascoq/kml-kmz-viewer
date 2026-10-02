/**
 * Parse KML text into named track points from LineString coordinates.
 * Coordinate order in KML: lon,lat[,altitude]
 */
(function (global) {
  "use strict";

  const KML_NS = "http://www.opengis.net/kml/2.2";

  function localName(el) {
    return (el.localName || el.nodeName || "").replace(/^.*:/, "").toLowerCase();
  }

  function findAll(root, name) {
    const out = [];
    const walk = (node) => {
      if (node.nodeType === 1 && localName(node) === name) out.push(node);
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(root);
    return out;
  }

  function findFirst(root, name) {
    return findAll(root, name)[0] || null;
  }

  function textOf(el) {
    return el ? (el.textContent || "").trim() : "";
  }

  /** Haversine distance in meters */
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function parseCoordinates(text) {
    const points = [];
    const tokens = text.trim().split(/\s+/);
    for (const token of tokens) {
      if (!token) continue;
      const parts = token.split(",");
      if (parts.length < 2) continue;
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      let elev = parts.length > 2 && parts[2] !== "" ? parseFloat(parts[2]) : null;
      if (!Number.isFinite(elev)) elev = null;
      points.push({ lat, lon, elev });
    }
    return points;
  }

  function dedupeConsecutive(points) {
    if (points.length === 0) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const prev = out[out.length - 1];
      const cur = points[i];
      if (prev.lat === cur.lat && prev.lon === cur.lon && prev.elev === cur.elev) continue;
      out.push(cur);
    }
    return out;
  }

  function withDistances(points) {
    let cum = 0;
    return points.map((p, i) => {
      if (i > 0) {
        cum += haversine(points[i - 1].lat, points[i - 1].lon, p.lat, p.lon);
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

  function parseKml(text) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      throw new Error("KML inválido o mal formado");
    }

    const nameEl =
      findFirst(doc, "name") ||
      doc.getElementsByTagNameNS(KML_NS, "name")[0];
    const name = textOf(nameEl) || "Ruta sin nombre";

    const coordEls = findAll(doc, "coordinates");
    let raw = [];
    for (const el of coordEls) {
      raw = raw.concat(parseCoordinates(textOf(el)));
    }

    if (raw.length === 0) {
      throw new Error("No se encontraron coordenadas en el KML");
    }

    const points = withDistances(dedupeConsecutive(raw));
    const hasRealElevation = points.some(
      (p) => p.elev != null && Math.abs(p.elev) > 0.01
    );

    return {
      name,
      points,
      hasRealElevation,
      totalDistanceM: points.length ? points[points.length - 1].distanceM : 0,
    };
  }

  global.KmlViewer = global.KmlViewer || {};
  global.KmlViewer.parseKml = parseKml;
  global.KmlViewer.haversine = haversine;
})(typeof window !== "undefined" ? window : globalThis);
