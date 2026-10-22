import { beforeAll, afterAll, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
import { processExport, processImport } from "@/lib/scheduled/shell";
import { getObject, uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
const suffix = uniqueSuffix(),
  slug = `jobs-${suffix}`,
  emailSuffix = `jobs-${suffix}.test`;
let workspaceId: string, userId: string;
const keys: string[] = [];
beforeAll(async () => {
  userId = (await createUser(`owner@${emailSuffix}`)).id;
  workspaceId = (await createWorkspace(slug, userId)).id;
});
afterAll(async () => {
  await deleteObjects(keys);
  await cleanup([slug], emailSuffix);
  await prisma.$disconnect();
});
it("completes an export once and stores an expiring private ZIP", async () => {
  await prisma.linkItem.create({
    data: {
      workspaceId,
      title: "Maker job export",
      url: "https://example.org",
    },
  });
  const job = await prisma.exportJob.create({
    data: {
      workspaceId,
      requestedById: userId,
      scope: { includeMessages: false },
    },
  });
  await processExport(new Date());
  const result = await prisma.exportJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  expect(result.status).toBe("SUCCEEDED");
  expect(result.error).toBeNull();
  expect(result.expiresAt).toBeInstanceOf(Date);
  expect(result.storageKey).toBeTruthy();
  keys.push(result.storageKey!);
  const object = await getObject(result.storageKey!);
  expect(Buffer.from(object!.body).readUInt32LE(0)).toBe(0x04034b50);
  expect(Buffer.from(object!.body).toString()).toContain("Maker job export");
  expect(await processExport(new Date())).toBe(false);
  expect(
    await prisma.notification.count({
      where: { workspaceId, userId, kind: "export.ready" },
    }),
  ).toBe(1);
});
it("previews CSV without writing, then imports once with duplicate URL handling", async () => {
  const stored = await uploadWorkspaceFile({
    workspaceId,
    uploadedById: userId,
    file: new File(
      [
        "title,url,tags\nImported maker,https://example.org/imported,build;night",
      ],
      "links.csv",
      { type: "text/csv" },
    ),
  });
  expect(stored.ok).toBe(true);
  if (!stored.ok) return;
  keys.push(stored.file.storageKey);
  const data = {
    workspaceId,
    requestedById: userId,
    entityType: "link",
    sourceFileId: stored.file.id,
    mapping: { title: "title", url: "url", tags: "tags" },
  };
  const preview = await prisma.importJob.create({ data });
  await processImport(new Date());
  expect(
    (await prisma.importJob.findUniqueOrThrow({ where: { id: preview.id } }))
      .stats,
  ).toMatchObject({ total: 1, valid: 1, created: 0 });
  expect(
    await prisma.linkItem.count({
      where: { workspaceId, url: "https://example.org/imported" },
    }),
  ).toBe(0);
  for (let n = 0; n < 2; n++) {
    await prisma.importJob.create({ data: { ...data, dryRun: false } });
    await processImport(new Date());
  }
  expect(
    await prisma.linkItem.count({
      where: { workspaceId, url: "https://example.org/imported" },
    }),
  ).toBe(1);
  expect(await processImport(new Date())).toBe(false);
});
it("cancels queued exports after requester access is revoked", async () => {
  const job = await prisma.exportJob.create({
    data: { workspaceId, requestedById: userId, scope: {} },
  });
  await prisma.membership.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { status: "SUSPENDED" },
  });
  await processExport(new Date());
  expect(
    (await prisma.exportJob.findUniqueOrThrow({ where: { id: job.id } }))
      .status,
  ).toBe("CANCELLED");
  await prisma.membership.update({
    where: { userId_workspaceId: { userId, workspaceId } },
    data: { status: "ACTIVE" },
  });
});
