import { describe, expect, it } from "vitest";
import { childFolders, fileKind, folderCrumbs, formatBytes, isWithinFolder, listVersions, nextVersionNumber, selectVersion, versionsToPrune } from "@/lib/files/versions";

const t = (day: number) => new Date(Date.UTC(2026, 9, day));
const version = (n: number) => ({ version: n, storageKey: `k${n}`, size: n * 10, contentType: "text/plain", createdAt: t(n), uploadedById: "u1", note: null });

describe("file versions", () => {
  it("synthesises the current version when it has no row", () => {
    const file = { currentVersion: 1, storageKey: "k1", size: 10, contentType: "text/plain", createdAt: t(1), uploadedById: "u1" };
    const list = listVersions(file, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ version: 1, storageKey: "k1", synthetic: true });
  });

  it("lists recorded versions newest first without duplicating the current one", () => {
    const file = { currentVersion: 3, storageKey: "k3", size: 30, contentType: "text/plain", createdAt: t(1), uploadedById: "u1" };
    expect(listVersions(file, [version(1), version(3), version(2)]).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("selects a requested version and rejects nonsense", () => {
    const versions = [version(1), version(2)];
    expect(selectVersion(versions, 2)?.storageKey).toBe("k2");
    expect(selectVersion(versions, 5)).toBeNull();
    expect(selectVersion(versions, 0)).toBeNull();
    expect(selectVersion(versions, Number("abc"))).toBeNull();
    expect(selectVersion(versions, 1.5)).toBeNull();
  });

  it("never reuses a version number", () => {
    expect(nextVersionNumber(1, [])).toBe(2);
    expect(nextVersionNumber(3, [version(1), version(7)])).toBe(8);
  });

  it("prunes beyond the newest N but never the current object", () => {
    const versions = Array.from({ length: 23 }, (_, i) => version(i + 1));
    const pruned = versionsToPrune(versions, { currentVersion: 23, storageKey: "k23" }, 20);
    expect(pruned.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versionsToPrune(versions.slice(0, 5), { currentVersion: 5, storageKey: "k5" }, 20)).toEqual([]);
    // A restored file can point at an old key; that key is kept.
    expect(versionsToPrune([version(1), version(2), version(3)], { currentVersion: 3, storageKey: "k1" }, 1).map((v) => v.version)).toEqual([2]);
  });
});

describe("file helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(820)).toBe("820 B");
    expect(formatBytes(14_540)).toBe("14.2 KB");
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
  });

  it("groups content types into kinds", () => {
    expect(fileKind("image/png")).toBe("image");
    expect(fileKind("application/pdf")).toBe("pdf");
    expect(fileKind("text/markdown")).toBe("text");
    expect(fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheet");
    expect(fileKind("application/zip")).toBe("archive");
    expect(fileKind("model/stl")).toBe("other");
  });

  it("derives sub-folders and breadcrumbs from folder paths", () => {
    const folders = ["/", "/builds", "/builds/bot", "/builds/bot/v2", "/photos", "/buildsx"];
    expect(childFolders(folders, "/")).toEqual(["builds", "buildsx", "photos"]);
    expect(childFolders(folders, "/builds")).toEqual(["bot"]);
    expect(folderCrumbs("/builds/bot")).toEqual([{ name: "builds", path: "/builds" }, { name: "bot", path: "/builds/bot" }]);
    expect(isWithinFolder("/builds/bot", "/builds")).toBe(true);
    expect(isWithinFolder("/buildsx", "/builds")).toBe(false);
  });
});
