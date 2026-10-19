import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import {
  archiveDoc,
  createDoc,
  DOC_CONFLICT,
  DOC_NOT_FOUND,
  duplicateDoc,
  listTreeDocs,
  moveDoc,
  restoreDoc,
  restoreRevision,
  saveDoc,
  searchDocs,
  setDocVisibility,
  verifyDoc,
  type DocsActor,
} from "@/lib/docs/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@docs-${suffix}.test`;
const slug = `docs-${suffix}`;
const otherSlug = `docs-other-${suffix}`;

let ws: { id: string; slug: string; name: string; timezone: string };
let other: { id: string; slug: string; name: string; timezone: string };
const actors: Record<string, DocsActor> = {};

function actorFor(workspace: typeof ws, user: { id: string; name: string | null }, role: WorkspaceRole): DocsActor {
  return { workspace, user, membership: { role } };
}

async function version(docId: string) {
  return (await prisma.doc.findUniqueOrThrow({ where: { id: docId } })).updatedAt.toISOString();
}

async function create(actor: DocsActor, input: Parameters<typeof createDoc>[1] = {}) {
  const result = await createDoc(actor, input);
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

describe.sequential("docs", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    const admin = await createUser(`admin${domain}`, "Asha Admin");
    const member = await createUser(`member${domain}`, "Meera");
    const member2 = await createUser(`member2${domain}`, "Arun");
    const guest = await createUser(`guest${domain}`, "Guest");
    const outsider = await createUser(`outsider${domain}`, "Outsider");
    ws = await createWorkspace(slug, owner.id);
    other = await createWorkspace(otherSlug, outsider.id);
    await addMember(ws.id, admin.id, "ADMIN");
    await addMember(ws.id, member.id, "MEMBER");
    await addMember(ws.id, member2.id, "MEMBER");
    await addMember(ws.id, guest.id, "GUEST");
    actors.owner = actorFor(ws, owner, "OWNER");
    actors.admin = actorFor(ws, admin, "ADMIN");
    actors.member = actorFor(ws, member, "MEMBER");
    actors.member2 = actorFor(ws, member2, "MEMBER");
    actors.guest = actorFor(ws, guest, "GUEST");
    actors.outsider = actorFor(other, outsider, "OWNER");
    // An outsider who somehow targets workspace ws with their own membership role must still fail.
    actors.outsiderInWs = actorFor(ws, outsider, "MEMBER");
  });

  afterAll(async () => {
    await cleanup([slug, otherSlug], domain);
    await prisma.$disconnect();
  });

  it("lets members create pages (from templates too) and refuses guests", async () => {
    const id = await create(actors.member!, { title: "Laser cutter guide" });
    const doc = await prisma.doc.findUniqueOrThrow({ where: { id } });
    expect(doc).toMatchObject({ workspaceId: ws.id, title: "Laser cutter guide", visibility: "WORKSPACE", createdById: actors.member!.user.id });
    expect(await prisma.searchDocument.findFirst({ where: { entityType: "doc", entityId: id } })).toMatchObject({ workspaceId: ws.id, title: "Laser cutter guide" });

    const fromTemplate = await create(actors.member!, { templateId: "builtin:meeting-notes" });
    const templated = await prisma.doc.findUniqueOrThrow({ where: { id: fromTemplate } });
    expect(templated.title).toMatch(/^Meeting notes /);
    expect(templated.contentHtml).toContain("<strong>Notes by:</strong> Meera");
    expect(await prisma.docRevision.count({ where: { docId: fromTemplate } })).toBe(1);

    expect(await createDoc(actors.guest!, { title: "Nope" })).toMatchObject({ ok: false });
  });

  it("hides admin-only pages from members everywhere and keeps their branch admin-only", async () => {
    const secret = await create(actors.admin!, { title: "Keyholder codes policy" });
    expect((await setDocVisibility(actors.admin!, { docId: secret, visibility: "ADMINS" })).ok).toBe(true);
    const child = await create(actors.admin!, { parentId: secret, title: "Alarm runbook" });
    expect((await prisma.doc.findUniqueOrThrow({ where: { id: child } })).visibility).toBe("ADMINS");

    const memberTree = await listTreeDocs(ws.id, "MEMBER");
    expect(memberTree.map((doc) => doc.id)).not.toContain(secret);
    expect(memberTree.map((doc) => doc.id)).not.toContain(child);
    expect((await listTreeDocs(ws.id, "ADMIN")).map((doc) => doc.id)).toEqual(expect.arrayContaining([secret, child]));

    expect(await searchDocs(ws.id, "MEMBER", "Keyholder")).toEqual([]);
    expect((await searchDocs(ws.id, "ADMIN", "Keyholder")).map((doc) => doc.id)).toEqual([secret]);
    expect(await prisma.searchDocument.count({ where: { entityId: { in: [secret, child] } } })).toBe(0);

    const base = await version(secret);
    expect(await saveDoc(actors.member!, { docId: secret, title: "x", html: "<p>x</p>", baseVersion: base })).toEqual({ ok: false, error: DOC_NOT_FOUND });
    expect(await createDoc(actors.member!, { parentId: secret })).toEqual({ ok: false, error: DOC_NOT_FOUND });
    expect((await setDocVisibility(actors.member!, { docId: secret, visibility: "WORKSPACE" })).ok).toBe(false);
    // A page inside an admin-only page cannot be shared on its own.
    expect((await setDocVisibility(actors.admin!, { docId: child, visibility: "WORKSPACE" })).ok).toBe(false);

    // Files attached to an admin-only page follow it through the download route check.
    const file = await prisma.fileObject.create({ data: { workspaceId: ws.id, storageKey: `test/${suffix}/secret.pdf`, filename: "secret.pdf", contentType: "application/pdf", size: 4, docId: secret } });
    expect(await findDownloadableFile(file.id, actors.member!.user.id)).toBeNull();
    expect(await findDownloadableFile(file.id, actors.admin!.user.id)).not.toBeNull();

    // Moving a shared page under an admin-only page makes its branch admin-only.
    const shared = await create(actors.admin!, { title: "Door procedure" });
    expect((await moveDoc(actors.admin!, { docId: shared, parentId: secret, index: 0 })).ok).toBe(true);
    expect((await prisma.doc.findUniqueOrThrow({ where: { id: shared } })).visibility).toBe("ADMINS");
  });

  it("isolates workspaces", async () => {
    const id = await create(actors.member!, { title: "Build night checklist" });
    const base = await version(id);
    expect(await saveDoc(actors.outsider!, { docId: id, title: "pwned", html: "", baseVersion: base })).toEqual({ ok: false, error: DOC_NOT_FOUND });
    expect((await archiveDoc(actors.outsider!, { docId: id })).ok).toBe(false);
    expect((await duplicateDoc(actors.outsider!, { docId: id })).ok).toBe(false);
    expect((await moveDoc(actors.outsider!, { docId: id, parentId: null, index: 0 })).ok).toBe(false);
    expect(await listTreeDocs(other.id, "OWNER")).toEqual([]);
    expect(await searchDocs(other.id, "OWNER", "Build night")).toEqual([]);

    const file = await prisma.fileObject.create({ data: { workspaceId: ws.id, storageKey: `test/${suffix}/plan.pdf`, filename: "plan.pdf", contentType: "application/pdf", size: 4 } });
    expect(await findDownloadableFile(file.id, actors.outsider!.user.id)).toBeNull();
    expect(await findDownloadableFile(file.id, actors.guest!.user.id)).not.toBeNull();
  });

  it("refuses stale saves so nobody overwrites someone else's edit", async () => {
    const id = await create(actors.member!, { title: "Shared notes" });
    const base = await version(id);
    const first = await saveDoc(actors.member!, { docId: id, title: "Shared notes", html: "<p>Meera's line</p>", baseVersion: base });
    expect(first.ok).toBe(true);
    const second = await saveDoc(actors.member2!, { docId: id, title: "Shared notes", html: "<p>Arun's line</p>", baseVersion: base });
    expect(second).toEqual({ ok: false, error: DOC_CONFLICT, conflict: true });
    expect((await prisma.doc.findUniqueOrThrow({ where: { id } })).contentHtml).toBe("<p>Meera's line</p>");
    if (!first.ok) return;
    const third = await saveDoc(actors.member2!, { docId: id, title: "Shared notes", html: "<p>Meera's line</p><p>Arun's line</p>", baseVersion: first.data.version });
    expect(third.ok).toBe(true);
  });

  it("sanitises saved HTML server-side", async () => {
    const id = await create(actors.member!, { title: "Unsafe" });
    const result = await saveDoc(actors.member!, { docId: id, title: "  Unsafe\u0000 page ", html: '<p onclick="x()">Hi<script>alert(1)</script><img src="https://evil.test/x.png"></p>', baseVersion: await version(id) });
    expect(result.ok).toBe(true);
    const doc = await prisma.doc.findUniqueOrThrow({ where: { id } });
    expect(doc.contentHtml).toBe("<p>Hi</p>");
    expect(doc.title).toBe("Unsafe page");
    expect(doc.contentText).toBe("Hi");
  });

  it("records revisions per editing session and restores without rewriting history", async () => {
    const id = await create(actors.member!, { title: "Soldering how-to" });
    const t0 = new Date();
    let result = await saveDoc(actors.member!, { docId: id, title: "Soldering how-to", html: "<p>v1</p>", baseVersion: await version(id) }, t0);
    expect(result.ok).toBe(true);
    result = await saveDoc(actors.member!, { docId: id, title: "Soldering how-to", html: "<p>v1 more</p>", baseVersion: await version(id) }, new Date(t0.getTime() + 60_000));
    expect(await prisma.docRevision.count({ where: { docId: id } })).toBe(1);
    result = await saveDoc(actors.member2!, { docId: id, title: "Soldering how-to", html: "<p>v2 by Arun</p>", baseVersion: await version(id) });
    const revisions = await prisma.docRevision.findMany({ where: { docId: id }, orderBy: { createdAt: "asc" } });
    expect(revisions.map((revision) => revision.contentHtml)).toEqual(["<p>v1 more</p>", "<p>v2 by Arun</p>"]);

    const before = await version(id);
    const restored = await restoreRevision(actors.member!, { docId: id, revisionId: revisions[0]!.id });
    expect(restored.ok).toBe(true);
    const doc = await prisma.doc.findUniqueOrThrow({ where: { id } });
    expect(doc.contentHtml).toBe("<p>v1 more</p>");
    expect(doc.updatedAt.toISOString()).not.toBe(before);
    expect(await prisma.docRevision.count({ where: { docId: id } })).toBe(3);
    expect((await restoreRevision(actors.guest!, { docId: id, revisionId: revisions[1]!.id })).ok).toBe(false);
  });

  it("moves pages without cycles or false edit conflicts, and archives whole branches", async () => {
    const parent = await create(actors.member!, { title: "Workshop" });
    const child = await create(actors.member!, { parentId: parent, title: "Tools" });
    const grandchild = await create(actors.member!, { parentId: child, title: "Drill press" });
    expect(await moveDoc(actors.member!, { docId: parent, parentId: grandchild, index: 0 })).toMatchObject({ ok: false });

    const base = await version(child);
    expect((await moveDoc(actors.member!, { docId: child, parentId: null, index: 0 })).ok).toBe(true);
    expect(await version(child)).toBe(base);
    expect((await saveDoc(actors.member!, { docId: child, title: "Tools", html: "<p>still my version</p>", baseVersion: base })).ok).toBe(true);
    expect((await listTreeDocs(ws.id, "MEMBER")).filter((doc) => doc.parentId === null)[0]!.id).toBe(child);

    expect(await archiveDoc(actors.member2!, { docId: child })).toMatchObject({ ok: false });
    expect(await archiveDoc(actors.member!, { docId: child })).toEqual({ ok: true, data: { archived: 2 } });
    const tree = (await listTreeDocs(ws.id, "MEMBER")).map((doc) => doc.id);
    expect(tree).not.toContain(child);
    expect(tree).not.toContain(grandchild);
    expect(await prisma.searchDocument.count({ where: { entityId: { in: [child, grandchild] } } })).toBe(0);
    expect((await restoreDoc(actors.member!, { docId: child })).ok).toBe(true);
    expect((await listTreeDocs(ws.id, "MEMBER")).map((doc) => doc.id)).toEqual(expect.arrayContaining([child, grandchild]));
  });

  it("duplicates and verifies pages", async () => {
    const id = await create(actors.member!, { title: "Opening checklist", templateId: "builtin:runbook" });
    const copy = await duplicateDoc(actors.member2!, { docId: id });
    expect(copy.ok).toBe(true);
    if (!copy.ok) return;
    const doc = await prisma.doc.findUniqueOrThrow({ where: { id: copy.data.id } });
    expect(doc.title).toBe("Opening checklist (copy)");
    expect(doc.createdById).toBe(actors.member2!.user.id);

    const base = await version(id);
    const verified = await verifyDoc(actors.member!, { docId: id, days: 90 });
    expect(verified.ok).toBe(true);
    const after = await prisma.doc.findUniqueOrThrow({ where: { id } });
    expect(after.verifiedById).toBe(actors.member!.user.id);
    expect(after.verifiedUntil!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect(after.updatedAt.toISOString()).toBe(base);
    expect((await verifyDoc(actors.guest!, { docId: id, days: 30 })).ok).toBe(false);
  });

  it("notifies newly mentioned members who can see the page", async () => {
    const id = await create(actors.member!, { title: "Hackathon plan" });
    const mention = (user: DocsActor) => `<span data-type="mention" data-id="${user.user.id}" data-label="${user.user.name}">@${user.user.name}</span>`;
    const html = `<p>${mention(actors.member2!)} and ${mention(actors.outsiderInWs!)} please review</p>`;
    expect((await saveDoc(actors.member!, { docId: id, title: "Hackathon plan", html, baseVersion: await version(id) })).ok).toBe(true);
    const notes = await prisma.notification.findMany({ where: { workspaceId: ws.id, url: `/w/${slug}/docs/${id}` } });
    expect(notes.map((note) => note.userId)).toEqual([actors.member2!.user.id]);
    expect(notes[0]!.title).toBe("Meera mentioned you in Hackathon plan");

    // Saving again does not notify the same person twice.
    expect((await saveDoc(actors.member!, { docId: id, title: "Hackathon plan", html: `${html}<p>more</p>`, baseVersion: await version(id) })).ok).toBe(true);
    expect(await prisma.notification.count({ where: { workspaceId: ws.id, url: `/w/${slug}/docs/${id}` } })).toBe(1);
  });
});
