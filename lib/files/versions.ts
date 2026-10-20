/**
 * Pure file-version rules (client-safe, unit-tested).
 *
 * Every library file has a `FileObject` row that always points at the
 * current object, and `FileVersion` rows for its versions (including the
 * current one once a second version exists). Restoring an old version copies
 * it into a new version: history is never rewritten. The newest
 * `MAX_FILE_VERSIONS` versions are kept; older objects are pruned.
 */

export const MAX_FILE_VERSIONS = 20;

export type VersionLike = { version: number; storageKey: string; size: number; contentType: string; createdAt: Date; uploadedById: string | null; note?: string | null };
export type CurrentFile = { currentVersion: number; storageKey: string; size: number; contentType: string; createdAt: Date; uploadedById: string | null };

/**
 * Versions to list for a file, newest first. When the current version has no
 * `FileVersion` row (files uploaded once, or by another area), it is
 * synthesised from the file itself so the list is always complete.
 */
export function listVersions<V extends VersionLike>(file: CurrentFile, versions: V[]): Array<V | (VersionLike & { synthetic: true })> {
  const list: Array<V | (VersionLike & { synthetic: true })> = [...versions];
  if (!versions.some((version) => version.version === file.currentVersion)) {
    list.push({ version: file.currentVersion, storageKey: file.storageKey, size: file.size, contentType: file.contentType, createdAt: file.createdAt, uploadedById: file.uploadedById, note: null, synthetic: true });
  }
  return list.sort((a, b) => b.version - a.version);
}

/** The version a download asks for, or null when it does not exist. */
export function selectVersion<V extends { version: number }>(versions: V[], requested: number): V | null {
  if (!Number.isSafeInteger(requested) || requested < 1) return null;
  return versions.find((version) => version.version === requested) ?? null;
}

/** Next version number: one past the highest known, never reusing a number. */
export function nextVersionNumber(currentVersion: number, versions: { version: number }[]): number {
  return Math.max(currentVersion, ...versions.map((version) => version.version)) + 1;
}

/**
 * Versions to prune: everything outside the newest `keep` versions, never the
 * current one and never an object the current file still points at.
 */
export function versionsToPrune<V extends { version: number; storageKey: string }>(versions: V[], current: { currentVersion: number; storageKey: string }, keep = MAX_FILE_VERSIONS): V[] {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  return sorted.slice(Math.max(keep, 1)).filter((version) => version.version !== current.currentVersion && version.storageKey !== current.storageKey);
}

/** Human-readable size: "820 B", "14.2 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A relative time label inside a sentence: "2 min ago", "yesterday", "on 13 Oct 2026". */
export function relativeInSentence(label: string): string {
  return /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(label) ? `on ${label}` : label.charAt(0).toLowerCase() + label.slice(1);
}

export type FileKind = "image" | "pdf" | "text" | "document" | "spreadsheet" | "archive" | "other";

export function fileKind(contentType: string): FileKind {
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf") return "pdf";
  if (["text/plain", "text/csv", "text/markdown", "application/json"].includes(contentType)) return "text";
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType === "text/csv") return "spreadsheet";
  if (contentType.includes("zip")) return "archive";
  if (contentType.includes("word") || contentType.includes("opendocument.text") || contentType.includes("presentation") || contentType.includes("powerpoint")) return "document";
  return "other";
}

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  image: "Image",
  pdf: "PDF",
  text: "Text",
  document: "Document",
  spreadsheet: "Spreadsheet",
  archive: "Archive",
  other: "File",
};

/**
 * Folder helpers. Folders are the normalised `FileObject.folder` path
 * ("/", "/builds/bot"); a folder exists while any file lives in it or below.
 */
export function childFolders(allFolders: string[], current: string): string[] {
  const prefix = current === "/" ? "/" : `${current}/`;
  const names = new Set<string>();
  for (const folder of allFolders) {
    if (folder === current || !folder.startsWith(prefix)) continue;
    const name = folder.slice(prefix.length).split("/")[0];
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function joinFolder(parent: string, name: string): string {
  return parent === "/" ? `/${name}` : `${parent}/${name}`;
}

export function folderCrumbs(folder: string): Array<{ name: string; path: string }> {
  const parts = folder.split("/").filter(Boolean);
  return parts.map((name, index) => ({ name, path: `/${parts.slice(0, index + 1).join("/")}` }));
}

/** Chat uploads live under this folder; the library never shows or accepts it. */
export const CHAT_FOLDER = "/chat";

export function isReservedFolder(folder: string): boolean {
  if (folder.startsWith("/documents")) return true;
  if (folder.startsWith("/org-people")) return true;
  if (folder === "/safeguarding" || folder.startsWith("/safeguarding/") || folder === "/governance" || folder.startsWith("/governance/")) return true;
  if (folder === "/funding" || folder.startsWith("/funding/")) return true;
  if (folder.startsWith("/finance-tools") || folder.startsWith("/money-controls")) return true;
  return folder === "/people-service" || folder.startsWith("/people-service/") || folder === "/calendar" || folder.startsWith("/calendar/") || folder === CHAT_FOLDER || folder.startsWith(`${CHAT_FOLDER}/`);
}

/** Is `folder` the same as or inside `parent`? */
export function isWithinFolder(folder: string, parent: string): boolean {
  return parent === "/" || folder === parent || folder.startsWith(`${parent}/`);
}
