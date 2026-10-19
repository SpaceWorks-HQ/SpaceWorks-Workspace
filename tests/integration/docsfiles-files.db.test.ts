import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import {
  deleteFile,
  FILE_NOT_FOUND,
  libraryWhere,
  linkFile,
  moveFiles,
  purgeDeletedFiles,
  renameFile,
  restoreFile,
  restoreFileVersion,
  uploadLibraryFile,
  uploadNewVersion,
  usageSummary,
  type FilesActor,
} from "@/lib/files/service";
import { listVersions, selectVersion } from "@/lib/files/versions";
import { deleteObjects, getObject } from "@/lib/storage";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

/**
 * Runs against the local Silo bucket by default (override with TEST_S3_*).
 * The S3 client is created on first use, so the environment is set before
 * any storage call.
 */
vi.stubEnv("S3_BUCKET", process.env.TEST_S3_BUCKET ?? "sww-docsfiles");
vi.stubEnv("S3_REGION", process.env.TEST_S3_REGION ?? "us-east-1");
vi.stubEnv("S3_ENDPOINT", process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9010");
vi.stubEnv("S3_ACCESS_KEY_ID", process.env.TEST_S3_ACCESS_KEY_ID ?? "swwdev");
vi.stubEnv("S3_SECRET_ACCESS_KEY", process.env.TEST_S3_SECRET_ACCESS_KEY ?? "sww_dev_storage_pw");
vi.stubEnv("S3_FORCE_PATH_STYLE", "1");

const suffix = uniqueSuffix();
const domain = `@files-${suffix}.test`;
const slug = `files-${suffix}`;
const otherSlug = `files-other-${suffix}`;
const actors: Record<string, FilesActor> = {};
const keys = new Set<string>();
let wsId: string;

const text = (name: string, body: string) => new File([body], name, { type: "text/plain" });
const read = async (key: string) => Buffer.from((await getObject(key))!.body).toString("utf8");

async function trackKeys(fileId: string) {
  const file = await prisma.fileObject.findUnique({ where: { id: fileId }, include: { versions: true } });
  if (!file) return;
  keys.add(file.storageKey);
  for (const version of file.versions) keys.add(version.storageKey);
}

describe.sequential("files library", () => {
  beforeAll(async () => {
    const make = async (key: string, role: WorkspaceRole, workspace: { id: string; slug: string }, userName: string) => {
      const user = await createUser(`${key}${domain}`, userName);
      if (role !== "OWNER") await addMember(workspace.id, user.id, role);
      actors[key] = { workspace, user, membership: { role } };
      return user;
    };
    const owner = await createUser(`owner${domain}`, "Owner");
    const ws = await createWorkspace(slug, owner.id);
    wsId = ws.id;
    actors.owner = { workspace: ws, user: owner, membership: { role: "OWNER" } };
    await make("admin", "ADMIN", ws, "Asha");
    await make("member", "MEMBER", ws, "Meera");
    await make("member2", "MEMBER", ws, "Arun");
    await make("guest", "GUEST", ws, "Guest");
    const outsider = await createUser(`outsider${domain}`, "Outsider");
    const other = await createWorkspace(otherSlug, outsider.id);
    actors.outsider = { workspace: other, user: outsider, membership: { role: "OWNER" } };
  });

  afterAll(async () => {
    const files = await prisma.fileObject.findMany({ where: { workspaceId: wsId }, include: { versions: true } });
    for (const file of files) {
      keys.add(file.storageKey);
      for (const version of file.versions) keys.add(version.storageKey);
    }
    await deleteObjects([...keys]).catch(() => undefined);
    await cleanup([slug, otherSlug], domain);
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("uploads into folders for members and refuses guests", async () => {
    const result = await uploadLibraryFile(actors.member!, { file: text("bom.txt", "resistors"), folder: "/builds/bot" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await trackKeys(result.data.id);
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: result.data.id } });
    expect(file).toMatchObject({ workspaceId: wsId, folder: "/builds/bot", filename: "bom.txt", currentVersion: 1, uploadedById: actors.member!.user.id });
    expect(file.storageKey.startsWith(`workspaces/${wsId}/files/`)).toBe(true);
    expect(await read(file.storageKey)).toBe("resistors");
    expect(await prisma.searchDocument.findFirst({ where: { entityType: "file", entityId: file.id } })).toMatchObject({ title: "bom.txt" });

    expect(await uploadLibraryFile(actors.guest!, { file: text("x.txt", "x") })).toMatchObject({ ok: false });
    expect(await uploadLibraryFile(actors.member!, { file: new File(["<script>"], "x.html", { type: "text/html" }) })).toMatchObject({ ok: false });
  });

  it("adds versions, restores an old one as a new version and downloads any version", async () => {
    const uploaded = await uploadLibraryFile(actors.member!, { file: text("laser-settings.txt", "v1 power 40") });
    if (!uploaded.ok) throw new Error(uploaded.error);
    const id = uploaded.data.id;
    const v2 = await uploadNewVersion(actors.member2!, { fileId: id, file: text("whatever.txt", "v2 power 55"), note: "Tuned for plywood" });
    expect(v2).toEqual({ ok: true, data: { version: 2 } });
    let file = await prisma.fileObject.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "asc" } } } });
    await trackKeys(id);
    expect(file.currentVersion).toBe(2);
    expect(file.filename).toBe("laser-settings.txt");
    expect(file.uploadedById).toBe(actors.member!.user.id);
    expect(file.versions.map((v) => [v.version, v.note])).toEqual([[1, null], [2, "Tuned for plywood"]]);
    expect(await read(file.storageKey)).toBe("v2 power 55");
    expect(await read(file.versions[0]!.storageKey)).toBe("v1 power 40");

    const restored = await restoreFileVersion(actors.member!, { fileId: id, version: 1 });
    expect(restored).toEqual({ ok: true, data: { version: 3 } });
    file = await prisma.fileObject.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { version: "asc" } } } });
    await trackKeys(id);
    expect(file.currentVersion).toBe(3);
    expect(await read(file.storageKey)).toBe("v1 power 40");
    expect(file.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(file.versions[2]!.note).toBe("Restored from version 1");
    // History is intact: version 2 is still there and readable.
    const listed = listVersions(file, file.versions);
    expect(await read(selectVersion(listed, 2)!.storageKey)).toBe("v2 power 55");

    expect(await restoreFileVersion(actors.member!, { fileId: id, version: 3 })).toMatchObject({ ok: false });
    expect(await restoreFileVersion(actors.guest!, { fileId: id, version: 1 })).toMatchObject({ ok: false });
    expect(await uploadNewVersion(actors.outsider!, { fileId: id, file: text("x.txt", "x") })).toEqual({ ok: false, error: FILE_NOT_FOUND });
  });

  it("renames, moves and links files, with workspace isolation", async () => {
    const uploaded = await uploadLibraryFile(actors.member!, { file: text("draft.txt", "hello") });
    if (!uploaded.ok) throw new Error(uploaded.error);
    const id = uploaded.data.id;
    await trackKeys(id);
    expect((await renameFile(actors.member2!, { fileId: id, filename: "../final plan.txt" })).ok).toBe(true);
    expect((await moveFiles(actors.member2!, { fileIds: [id], folder: "/plans//2026/" })).ok).toBe(true);
    const file = await prisma.fileObject.findUniqueOrThrow({ where: { id } });
    expect(file).toMatchObject({ filename: "final plan.txt", folder: "/plans/2026" });

    expect(await renameFile(actors.outsider!, { fileId: id, filename: "pwned.txt" })).toEqual({ ok: false, error: FILE_NOT_FOUND });
    expect(await moveFiles(actors.outsider!, { fileIds: [id], folder: "/" })).toEqual({ ok: false, error: FILE_NOT_FOUND });
    expect(await deleteFile(actors.outsider!, { fileId: id })).toEqual({ ok: false, error: FILE_NOT_FOUND });
    expect(await findDownloadableFile(id, actors.outsider!.user.id)).toBeNull();
    expect(await findDownloadableFile(id, actors.guest!.user.id)).not.toBeNull();

    const doc = await prisma.doc.create({ data: { workspaceId: wsId, title: "Plans" } });
    const otherDoc = await prisma.doc.create({ data: { workspaceId: actors.outsider!.workspace.id, title: "Other" } });
    expect((await linkFile(actors.member!, { fileId: id, docId: doc.id, taskId: null })).ok).toBe(true);
    expect((await prisma.fileObject.findUniqueOrThrow({ where: { id } })).docId).toBe(doc.id);
    expect(await linkFile(actors.member!, { fileId: id, docId: otherDoc.id, taskId: null })).toMatchObject({ ok: false });
  });

  it("hides files of admin-only pages and other areas from the library", async () => {
    const secretDoc = await prisma.doc.create({ data: { workspaceId: wsId, title: "Keyholders", visibility: "ADMINS" } });
    const secret = await uploadLibraryFile(actors.admin!, { file: text("codes.txt", "1234"), docId: secretDoc.id });
    if (!secret.ok) throw new Error(secret.error);
    await trackKeys(secret.data.id);
    expect(await uploadLibraryFile(actors.member!, { file: text("x.txt", "x"), docId: secretDoc.id })).toMatchObject({ ok: false });

    const visibleTo = async (actor: FilesActor) => (await prisma.fileObject.findMany({ where: await libraryWhere(actor), select: { id: true } })).map((file) => file.id);
    expect(await visibleTo(actors.member!)).not.toContain(secret.data.id);
    expect(await visibleTo(actors.admin!)).toContain(secret.data.id);
    expect(await prisma.searchDocument.count({ where: { entityType: "file", entityId: secret.data.id } })).toBe(0);
    expect(await renameFile(actors.member!, { fileId: secret.data.id, filename: "x.txt" })).toEqual({ ok: false, error: FILE_NOT_FOUND });

    const channel = await prisma.channel.findFirstOrThrow({ where: { workspaceId: wsId } });
    const message = await prisma.message.create({ data: { workspaceId: wsId, channelId: channel.id, authorId: actors.member!.user.id, body: "photo" } });
    const attachment = await prisma.fileObject.create({ data: { workspaceId: wsId, storageKey: `test/${suffix}/chat.png`, filename: "chat.png", contentType: "image/png", size: 4 } });
    await prisma.messageAttachment.create({ data: { messageId: message.id, fileId: attachment.id } });
    expect(await visibleTo(actors.admin!)).not.toContain(attachment.id);
  });

  it("soft-deletes for the uploader or an admin, restores, and purges after 30 days", async () => {
    const uploaded = await uploadLibraryFile(actors.member!, { file: text("old.txt", "bye") });
    if (!uploaded.ok) throw new Error(uploaded.error);
    const id = uploaded.data.id;
    expect((await uploadNewVersion(actors.member!, { fileId: id, file: text("old.txt", "bye v2") })).ok).toBe(true);
    const stored = await prisma.fileObject.findUniqueOrThrow({ where: { id }, include: { versions: true } });
    const allKeys = [stored.storageKey, ...stored.versions.map((v) => v.storageKey)];

    expect(await deleteFile(actors.member2!, { fileId: id })).toMatchObject({ ok: false });
    expect((await deleteFile(actors.admin!, { fileId: id })).ok).toBe(true);
    expect(await findDownloadableFile(id, actors.member!.user.id)).toBeNull();
    expect((await restoreFile(actors.member!, { fileId: id })).ok).toBe(true);
    expect(await findDownloadableFile(id, actors.member!.user.id)).not.toBeNull();

    const deletedAt = new Date();
    expect((await deleteFile(actors.member!, { fileId: id }, deletedAt)).ok).toBe(true);
    await purgeDeletedFiles(new Date(deletedAt.getTime() + 29 * 86_400_000));
    expect(await prisma.fileObject.findUnique({ where: { id } })).not.toBeNull();
    await purgeDeletedFiles(new Date(deletedAt.getTime() + 31 * 86_400_000));
    expect(await prisma.fileObject.findUnique({ where: { id } })).toBeNull();
    for (const key of allKeys) expect(await getObject(key)).toBeNull();
  });

  it("summarises storage per workspace", async () => {
    const usage = await usageSummary(wsId);
    expect(usage.files).toBeGreaterThan(0);
    expect(usage.bytes).toBeGreaterThan(0);
    expect(usage.versionBytes).toBeGreaterThan(0);
    expect(usage.byKind.find((kind) => kind.kind === "text")?.files).toBeGreaterThan(0);
    expect((await usageSummary(actors.outsider!.workspace.id)).files).toBe(0);
  });
});
