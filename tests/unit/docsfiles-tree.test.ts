import { describe, expect, it } from "vitest";
import { ancestorIds, buildDocTree, checkDocMove, descendantIds, flattenTree, placeAmongSiblings } from "@/lib/docs/tree";
import { canArchiveDoc, canEditDoc, canManageDocVisibility, canSeeDoc, contentChanged, REVISION_COALESCE_MS, startsNewRevision, verificationState } from "@/lib/docs/rules";

const docs = [
  { id: "a", parentId: null, title: "Alpha", position: 2 },
  { id: "b", parentId: null, title: "Beta", position: 1 },
  { id: "a1", parentId: "a", title: "A one", position: 1 },
  { id: "a1x", parentId: "a1", title: "Deep", position: 1 },
  { id: "a2", parentId: "a", title: "A two", position: 2 },
  { id: "orphan", parentId: "missing", title: "Orphan", position: 1 },
];

describe("doc tree", () => {
  it("builds a sorted forest and promotes orphans to roots", () => {
    const tree = buildDocTree(docs);
    expect(tree.map((node) => node.id)).toEqual(["b", "orphan", "a"]);
    expect(tree[2]!.children.map((node) => node.id)).toEqual(["a1", "a2"]);
    expect(flattenTree(tree).map(({ node, depth }) => `${node.id}:${depth}`)).toEqual(["b:0", "orphan:0", "a:0", "a1:1", "a1x:2", "a2:1"]);
  });

  it("finds descendants and ancestors", () => {
    expect([...descendantIds(docs, "a")].sort()).toEqual(["a1", "a1x", "a2"]);
    expect(ancestorIds(docs, "a1x")).toEqual(["a", "a1"]);
  });

  it("prevents moves that would create a cycle", () => {
    expect(checkDocMove(docs, "a", "a")).toEqual({ ok: false, error: "A page can't be moved inside itself." });
    expect(checkDocMove(docs, "a", "a1x").ok).toBe(false);
    expect(checkDocMove(docs, "a", "a1").ok).toBe(false);
    expect(checkDocMove(docs, "a1", "b")).toEqual({ ok: true });
    expect(checkDocMove(docs, "a1x", null)).toEqual({ ok: true });
    expect(checkDocMove(docs, "a1", "nope").ok).toBe(false);
    expect(checkDocMove(docs, "nope", null).ok).toBe(false);
  });

  it("survives cyclic data without looping", () => {
    const cyclic = [{ id: "x", parentId: "y" }, { id: "y", parentId: "x" }];
    expect([...descendantIds(cyclic, "x")]).toEqual(["y"]);
    expect(ancestorIds(cyclic, "x")).toEqual(["y"]);
  });

  it("places a page among siblings at a clamped index", () => {
    expect(placeAmongSiblings(["a", "b", "c"], "x", 1)).toEqual(["a", "x", "b", "c"]);
    expect(placeAmongSiblings(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(placeAmongSiblings(["a", "b"], "x", 99)).toEqual(["a", "b", "x"]);
    expect(placeAmongSiblings(["a", "b"], "x", -5)).toEqual(["x", "a", "b"]);
  });
});

describe("doc rules", () => {
  const ws = { visibility: "WORKSPACE" as const, createdById: "u1" };
  const admins = { visibility: "ADMINS" as const, createdById: "u1" };

  it("lets guests read, members edit, admins manage admin-only pages", () => {
    expect(canSeeDoc({ role: "GUEST" }, ws)).toBe(true);
    expect(canEditDoc({ role: "GUEST" }, ws)).toBe(false);
    expect(canEditDoc({ role: "MEMBER" }, ws)).toBe(true);
    expect(canSeeDoc({ role: "MEMBER" }, admins)).toBe(false);
    expect(canEditDoc({ role: "ADMIN" }, admins)).toBe(true);
    expect(canManageDocVisibility({ role: "MEMBER" })).toBe(false);
    expect(canManageDocVisibility({ role: "OWNER" })).toBe(true);
  });

  it("limits archiving to the creator or an admin", () => {
    expect(canArchiveDoc({ role: "MEMBER" }, ws, "u1")).toBe(true);
    expect(canArchiveDoc({ role: "MEMBER" }, ws, "u2")).toBe(false);
    expect(canArchiveDoc({ role: "ADMIN" }, ws, "u2")).toBe(true);
  });

  it("starts a new revision for a new author, after a pause, or the first save", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    expect(startsNewRevision(null, "u1", now)).toBe(true);
    expect(startsNewRevision({ authorId: "u2", createdAt: now }, "u1", now)).toBe(true);
    expect(startsNewRevision({ authorId: "u1", createdAt: new Date(now.getTime() - 60_000) }, "u1", now)).toBe(false);
    expect(startsNewRevision({ authorId: "u1", createdAt: new Date(now.getTime() - REVISION_COALESCE_MS) }, "u1", now)).toBe(true);
    expect(contentChanged({ title: "a", contentHtml: "<p>x</p>" }, { title: "a", contentHtml: "<p>x</p>" })).toBe(false);
  });

  it("reports verification state", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    expect(verificationState(null, now)).toBe("none");
    expect(verificationState(new Date("2026-12-01"), now)).toBe("verified");
    expect(verificationState(new Date("2026-10-22"), now)).toBe("due_soon");
    expect(verificationState(new Date("2026-10-01"), now)).toBe("expired");
  });
});
