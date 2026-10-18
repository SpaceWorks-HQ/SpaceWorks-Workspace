import { describe, expect, it } from "vitest";
import { buildStorageKey, checkUpload, contentDisposition, normalizeContentType, sanitizeFilename } from "@/lib/storage/policy";

describe("upload policy", () => {
  it("rejects empty, oversized and unsupported uploads", () => {
    expect(checkUpload({ size: 0, type: "image/png" }).ok).toBe(false);
    expect(checkUpload({ size: 11, type: "image/png" }, 10).ok).toBe(false);
    expect(checkUpload({ size: 10, type: "text/html" }).ok).toBe(false);
    expect(checkUpload({ size: 10, type: "image/svg+xml" }).ok).toBe(false);
    expect(checkUpload({ size: 10, type: "image/PNG; charset=binary" })).toEqual({ ok: true, contentType: "image/png" });
    expect(normalizeContentType(undefined)).toBe("application/octet-stream");
  });

  it("sanitises filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename('bad"<name>.txt')).toBe("badname.txt");
    expect(sanitizeFilename("...")).toBe("file");
    expect(sanitizeFilename("a".repeat(500))).toHaveLength(180);
  });

  it("builds tenant-prefixed, unguessable keys", () => {
    const key = buildStorageKey("ws_123", "Motor driver v2.pdf", "00000000-0000-4000-8000-000000000000");
    expect(key).toBe("workspaces/ws_123/files/00000000-0000-4000-8000-000000000000/Motor-driver-v2.pdf");
    expect(() => buildStorageKey("../other", "x")).toThrow();
  });

  it("writes safe Content-Disposition headers", () => {
    expect(contentDisposition("photo.png", true)).toMatch(/^inline; filename="photo.png"/);
    const header = contentDisposition("ബോട്ട്.pdf", false);
    expect(header.startsWith("attachment;")).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).not.toMatch(/[^\x20-\x7e]/);
  });
});
