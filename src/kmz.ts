import { unzipSync } from "fflate";

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];

export interface KmzArchive {
  kmlText: string;
  resolveHref: (href: string) => string | null;
  revoke: () => void;
}

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

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function pickKmlEntry(names: string[]): string | null {
  const kmlNames = names.filter((n) => /\.kml$/i.test(n) && !n.endsWith("/"));
  if (kmlNames.length === 0) return null;

  const doc = kmlNames.find((n) => basename(n).toLowerCase() === "doc.kml");
  if (doc) return doc;

  const root = kmlNames.find((n) => !n.replace(/\\/g, "/").includes("/"));
  return root ?? kmlNames[0] ?? null;
}

function mimeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  return "application/octet-stream";
}

function dirname(path: string): string {
  const norm = normalizeZipPath(path);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}

function joinZipPath(baseDir: string, rel: string): string {
  const parts = [...(baseDir ? baseDir.split("/") : []), ...rel.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/** Unzip a KMZ and expose the main KML plus href resolution into blob URLs. */
export function openKmz(buffer: ArrayBuffer): KmzArchive {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("Invalid or corrupted KMZ archive");
  }

  const entryNames = Object.keys(files).filter((n) => !n.endsWith("/"));
  const kmlEntry = pickKmlEntry(entryNames);
  if (!kmlEntry) {
    throw new Error("No KML file found inside the KMZ");
  }

  const kmlData = files[kmlEntry];
  if (!kmlData) {
    throw new Error("No KML file found inside the KMZ");
  }

  const kmlText = new TextDecoder("utf-8").decode(kmlData);
  const kmlDir = dirname(kmlEntry);
  const blobUrls: string[] = [];

  const byLower = new Map<string, string>();
  for (const name of entryNames) {
    byLower.set(normalizeZipPath(name).toLowerCase(), name);
  }

  function findFile(path: string): Uint8Array | null {
    const norm = normalizeZipPath(path);
    const exact = files[norm] ?? files[byLower.get(norm.toLowerCase()) ?? ""];
    if (exact) return exact;
    const base = basename(norm).toLowerCase();
    for (const name of entryNames) {
      if (basename(name).toLowerCase() === base) return files[name] ?? null;
    }
    return null;
  }

  function resolveHref(href: string): string | null {
    const trimmed = href.trim();
    if (!trimmed) return null;
    if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;

    const cleaned = trimmed.replace(/^file:\/*/i, "");
    const candidates = [
      joinZipPath(kmlDir, cleaned),
      normalizeZipPath(cleaned),
      joinZipPath(kmlDir, basename(cleaned)),
    ];

    for (const candidate of candidates) {
      const data = findFile(candidate);
      if (!data) continue;
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      const blob = new Blob([copy], { type: mimeForPath(candidate) });
      const url = URL.createObjectURL(blob);
      blobUrls.push(url);
      return url;
    }
    return null;
  }

  return {
    kmlText,
    resolveHref,
    revoke() {
      for (const url of blobUrls) URL.revokeObjectURL(url);
      blobUrls.length = 0;
    },
  };
}

/** @deprecated Prefer openKmz for asset resolution. */
export function extractKmlFromKmz(buffer: ArrayBuffer): string {
  const archive = openKmz(buffer);
  const text = archive.kmlText;
  archive.revoke();
  return text;
}
