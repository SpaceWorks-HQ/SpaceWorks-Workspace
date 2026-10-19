/**
 * Browser upload helper for the docs and files areas: one file per request
 * to the upload route, with progress. Sends the client header the route
 * requires (lib/files/request.ts).
 */

export type UploadResponse =
  | { ok: true; file: { id: string; filename?: string; contentType?: string; url?: string; version?: number } }
  | { ok: false; error: string };

export type UploadFields = { folder?: string; docId?: string; taskId?: string; replaceFileId?: string; note?: string };

export function uploadFile(slug: string, file: File, fields: UploadFields, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<UploadResponse> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("file", file);
    for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/w/${encodeURIComponent(slug)}/files/upload`);
    xhr.setRequestHeader("x-sw-client", "1");
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response as UploadResponse | null;
      if (body && typeof body === "object" && "ok" in body) resolve(body);
      else if (xhr.status === 413) resolve({ ok: false, error: "That file is too large. Choose a smaller file." });
      else resolve({ ok: false, error: "Couldn't upload. Try again." });
    };
    xhr.onerror = () => resolve({ ok: false, error: "Couldn't reach Space Works. Check your connection and try again." });
    xhr.onabort = () => resolve({ ok: false, error: "Upload cancelled." });
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}
