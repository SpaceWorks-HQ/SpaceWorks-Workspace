/**
 * Pure upload policy (no I/O), shared by the server storage module and tests.
 */

export const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Types members may upload. Anything else is rejected before storage. */
export const ALLOWED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  // CAD / maker formats arrive with generic types.
  "application/octet-stream",
  "model/stl",
  "application/sla",
]);

export const RASTER_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Types the download route may render inline; everything else is an attachment. */
export const INLINE_SAFE_TYPES: ReadonlySet<string> = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);

export function maxUploadBytes(): number {
  const configured = Number(process.env.UPLOAD_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_UPLOAD_BYTES;
}

/** Strip paths, control characters and risky punctuation; keep the extension. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 180);
}

export function normalizeContentType(type: string | undefined | null): string {
  return (type ?? "").split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
}

export type UploadCheck = { ok: true; contentType: string } | { ok: false; error: string };

export function checkUpload(input: { size: number; type: string | null | undefined }, maxBytes = maxUploadBytes()): UploadCheck {
  if (input.size <= 0) return { ok: false, error: "That file is empty. Choose another file." };
  if (input.size > maxBytes) {
    return { ok: false, error: `That file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB. Choose a smaller file.` };
  }
  const contentType = normalizeContentType(input.type);
  if (!ALLOWED_UPLOAD_TYPES.has(contentType)) return { ok: false, error: "That file type isn't supported. Upload an image, PDF, document or archive." };
  return { ok: true, contentType };
}

/** workspaces/<workspaceId>/files/<uuid>/<filename>: tenant-prefixed, unguessable, never user-chosen. */
export function buildStorageKey(workspaceId: string, filename: string, id: string = crypto.randomUUID()): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workspaceId)) throw new Error("Invalid workspace id for storage key.");
  const safe = sanitizeFilename(filename).replace(/[^A-Za-z0-9._ -]/g, "_").replace(/ /g, "-");
  return `workspaces/${workspaceId}/files/${id}/${safe}`;
}

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(filename: string, inline: boolean): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
