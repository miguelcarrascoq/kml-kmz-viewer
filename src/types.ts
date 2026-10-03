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

export interface Track {
  name: string;
  points: TrackPoint[];
  /** Separate LineString / LinearRing geometries (not joined into one path). */
  paths: RawCoordinate[][];
  hasRealElevation: boolean;
  totalDistanceM: number;
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
