export interface TrackPoint {
  lat: number;
  lon: number;
  elev: number | null;
  index: number;
  distanceM: number;
}

export interface RawCoordinate {
  lat: number;
  lon: number;
  elev: number | null;
}

export interface KmlLineStyle {
  color: string;
  opacity: number;
  weight?: number;
}

export interface KmlIconStyle {
  href?: string;
  scale?: number;
}

export interface MapPoint {
  lat: number;
  lon: number;
  name: string;
  style?: KmlIconStyle;
}

export interface GroundOverlayItem {
  name: string;
  href: string;
  north: number;
  south: number;
  east: number;
  west: number;
  opacity: number;
}

export type KmlTreeKind = "folder" | "placemark" | "overlay";

export interface KmlTreeNode {
  id: string;
  kind: KmlTreeKind;
  name: string;
  children?: KmlTreeNode[];
  pathIndices?: number[];
  pointIndices?: number[];
  overlayIndices?: number[];
  style?: KmlLineStyle;
  iconHref?: string;
}

export interface Track {
  name: string;
  points: TrackPoint[];
  /** Separate LineString / LinearRing geometries (not joined into one path). */
  paths: RawCoordinate[][];
  hasRealElevation: boolean;
  totalDistanceM: number;
  tree?: KmlTreeNode;
  pathStyles?: (KmlLineStyle | undefined)[];
  mapPoints?: MapPoint[];
  overlays?: GroundOverlayItem[];
}

export interface ElevationMeta {
  source: string;
  enriched: boolean;
}

export interface GeocodeResult {
  text: string;
  source: string;
}

export type StatusKind = "ok" | "error" | "";

export interface PopupOpts {
  loading?: boolean;
  error?: string;
}

/** Resolve a KML href (absolute URL or archive-relative path) to a usable URL. */
export type HrefResolver = (href: string) => string | null;
