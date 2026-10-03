import type { GeocodeResult } from "./types";

let lastGeocodeAt = 0;

function uniqueJoin(parts: Array<string | null | undefined>): string | null {
  return parts.filter((v, i, arr) => v && arr.indexOf(v) === i).join(", ") || null;
}

function formatStreetLine(
  street: string | undefined,
  houseNumber: string | undefined
): string | null {
  if (!street && !houseNumber) return null;
  if (street && houseNumber) return `${street} ${houseNumber}`;
  return street || houseNumber || null;
}

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  residential?: string;
  cycleway?: string;
  house_number?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  hamlet?: string;
  postcode?: string;
  state?: string;
  region?: string;
  country?: string;
}

interface NominatimResponse {
  display_name?: string;
  address?: NominatimAddress;
}

interface PhotonProperties {
  street?: string;
  name?: string;
  housenumber?: string;
  district?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  locality?: string;
  postcode?: string;
  state?: string;
  county?: string;
  country?: string;
}

interface PhotonFeature {
  properties?: PhotonProperties;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface BigDataCloudResponse {
  locality?: string;
  city?: string;
  principalSubdivision?: string;
  countryName?: string;
  plusCode?: string;
}

function formatNominatimAddress(data: NominatimResponse): string | null {
  const a = data.address;
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
  return data.display_name || null;
}

function formatPhotonAddress(feature: PhotonFeature | undefined): string | null {
  const p = feature?.properties;
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

function formatBigDataCloudAddress(data: BigDataCloudResponse): string | null {
  const text = uniqueJoin([
    data.locality,
    data.city,
    data.principalSubdivision,
    data.countryName,
  ]);
  if (text) return text;
  if (data.plusCode) return String(data.plusCode);
  return null;
}

async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<GeocodeResult> {
  // Nominatim (OSM): free, max ~1 req/s
  const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeAt));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const nomUrl =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}` +
    `&accept-language=en&zoom=18&addressdetails=1`;
  lastGeocodeAt = Date.now();
  const res = await fetch(nomUrl, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = (await res.json()) as NominatimResponse;
  const text = formatNominatimAddress(data);
  if (!text) throw new Error("No address result");
  return { text, source: "Nominatim OSM" };
}

async function reverseGeocodePhoton(
  lat: number,
  lon: number
): Promise<GeocodeResult> {
  const url =
    `https://photon.komoot.io/reverse?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}&lang=en`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = (await res.json()) as PhotonResponse;
  const feature = data.features?.[0];
  const text = formatPhotonAddress(feature);
  if (!text) throw new Error("No address result");
  return { text, source: "Photon" };
}

async function reverseGeocodeBigDataCloud(
  lat: number,
  lon: number
): Promise<GeocodeResult> {
  const bdcUrl =
    `https://api.bigdatacloud.net/data/reverse-geocode-client` +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&localityLanguage=en`;
  const res = await fetch(bdcUrl);
  if (!res.ok) throw new Error(`BigDataCloud HTTP ${res.status}`);
  const data = (await res.json()) as BigDataCloudResponse;
  const text = formatBigDataCloudAddress(data);
  if (!text) throw new Error("No address result");
  return { text, source: "BigDataCloud" };
}

/** Prefer street-level OSM sources; BigDataCloud is locality-only fallback. */
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<GeocodeResult> {
  try {
    return await reverseGeocodeNominatim(lat, lon);
  } catch {
    /* fall through */
  }
  try {
    return await reverseGeocodePhoton(lat, lon);
  } catch {
    /* fall through */
  }
  return reverseGeocodeBigDataCloud(lat, lon);
}
