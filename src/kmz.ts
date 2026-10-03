import { unzipSync } from "fflate";

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const local =
    bytes[0] === ZIP_LOCAL[0] &&
    bytes[1] === ZIP_LOCAL[1] &&
    bytes[2] === ZIP_LOCAL[2] &&
    bytes[3] === ZIP_LOCAL[3];
  const empty =
    bytes[0] === ZIP_EMPTY[0] &&
    bytes[1] === ZIP_EMPTY[1] &&
    bytes[2] === ZIP_EMPTY[2] &&
    bytes[3] === ZIP_EMPTY[3];
  return local || empty;
}

function looksLikeKmzName(label?: string): boolean {
  return !!label && /\.kmz$/i.test(label.trim());
}

function looksLikeKmzMime(contentType?: string | null): boolean {
  if (!contentType) return false;
  const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    mime === "application/vnd.google-earth.kmz" ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  );
}

/** Detect KMZ from label, Content-Type, or ZIP magic bytes. */
export function isKmz(
  buffer: ArrayBuffer,
  label?: string,
  contentType?: string | null
): boolean {
  if (looksLikeKmzName(label) || looksLikeKmzMime(contentType)) return true;
  return hasZipSignature(new Uint8Array(buffer));
}

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function pickKmlEntry(names: string[]): string | null {
  const kmlNames = names.filter((n) => /\.kml$/i.test(n) && !n.endsWith("/"));
  if (kmlNames.length === 0) return null;

  const doc = kmlNames.find((n) => basename(n).toLowerCase() === "doc.kml");
  if (doc) return doc;

  const root = kmlNames.find((n) => !n.replace(/\\/g, "/").includes("/"));
  return root ?? kmlNames[0] ?? null;
}

/** Unzip a KMZ and return the main KML document as UTF-8 text. */
export function extractKmlFromKmz(buffer: ArrayBuffer): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("Invalid or corrupted KMZ archive");
  }

  const entry = pickKmlEntry(Object.keys(files));
  if (!entry) {
    throw new Error("No KML file found inside the KMZ");
  }

  const data = files[entry];
  if (!data) {
    throw new Error("No KML file found inside the KMZ");
  }

  return new TextDecoder("utf-8").decode(data);
}
