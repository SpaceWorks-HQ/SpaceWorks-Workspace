import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sessionUser = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (sessionUser.id ? { user: { id: sessionUser.id } } : null),
}));

import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { findWorkspaceForUser, getWorkspaceForAction, requireWorkspace } from "@/lib/permissions";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@iso-${suffix}.test`;
const slugA = `iso-a-${suffix}`;
const slugB = `iso-b-${suffix}`;
let ownerA: string;
let ownerB: string;
let guestA: string;
let workspaceA: string;
let fileId: string;

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && String((error as { digest?: string }).digest ?? "").includes("404");
}

describe.sequential("workspace isolation", () => {
  beforeAll(async () => {
    ownerA = (await createUser(`a${domain}`)).id;
    ownerB = (await createUser(`b${domain}`)).id;
    guestA = (await createUser(`guest${domain}`)).id;
    workspaceA = (await createWorkspace(slugA, ownerA)).id;
    await createWorkspace(slugB, ownerB);
    await addMember(workspaceA, guestA, "GUEST");
    fileId = (await prisma.fileObject.create({
      data: { workspaceId: workspaceA, storageKey: `workspaces/${workspaceA}/files/${suffix}/plan.pdf`, filename: "plan.pdf", contentType: "application/pdf", size: 10, uploadedById: ownerA },
    })).id;
  });

  beforeEach(() => {
    sessionUser.id = "";
  });

  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  });

  it("resolves a member's own workspace", async () => {
    sessionUser.id = ownerA;
    const ctx = await requireWorkspace(slugA);
    expect(ctx.workspace.id).toBe(workspaceA);
    expect(ctx.membership.role).toBe("OWNER");
  });

  it("answers notFound for another tenant's workspace and for unknown slugs alike", async () => {
    sessionUser.id = ownerB;
    const foreign = await requireWorkspace(slugA).catch((error) => error);
    const unknown = await requireWorkspace(`nope-${suffix}`).catch((error) => error);
    expect(isNotFound(foreign)).toBe(true);
    expect(isNotFound(unknown)).toBe(true);
    await expect(getWorkspaceForAction(slugA)).resolves.toBeNull();
    await expect(findWorkspaceForUser(slugA, ownerB)).resolves.toBeNull();
  });

  it("hides pages below the member's role", async () => {
    sessionUser.id = guestA;
    await expect(requireWorkspace(slugA, "GUEST")).resolves.toMatchObject({ membership: { role: "GUEST" } });
    expect(isNotFound(await requireWorkspace(slugA, "ADMIN").catch((error) => error))).toBe(true);
    await expect(getWorkspaceForAction(slugA, "MEMBER")).resolves.toBeNull();
  });

  it("locks out suspended members and archived workspaces", async () => {
    await prisma.membership.update({ where: { userId_workspaceId: { userId: guestA, workspaceId: workspaceA } }, data: { status: "SUSPENDED" } });
    await expect(findWorkspaceForUser(slugA, guestA)).resolves.toBeNull();
    await prisma.membership.update({ where: { userId_workspaceId: { userId: guestA, workspaceId: workspaceA } }, data: { status: "ACTIVE" } });

    await prisma.workspace.update({ where: { id: workspaceA }, data: { archivedAt: new Date() } });
    await expect(findWorkspaceForUser(slugA, ownerA)).resolves.toBeNull();
    await prisma.workspace.update({ where: { id: workspaceA }, data: { archivedAt: null } });
  });

  it("serves files only to members of the file's workspace", async () => {
    await expect(findDownloadableFile(fileId, ownerA)).resolves.toMatchObject({ id: fileId });
    await expect(findDownloadableFile(fileId, guestA)).resolves.toMatchObject({ id: fileId });
    await expect(findDownloadableFile(fileId, ownerB)).resolves.toBeNull();
    await expect(findDownloadableFile("../../etc/passwd", ownerA)).resolves.toBeNull();
  });

  it("keeps finance receipts away from members who can't see the kitty", async () => {
    await prisma.ledgerEntry.create({
      data: { workspaceId: workspaceA, kind: "EXPENSE", amountMinor: 5000, currency: "INR", description: "Solder", occurredOn: new Date("2026-10-01"), receiptFileId: fileId, createdById: ownerA },
    });
    await expect(findDownloadableFile(fileId, guestA)).resolves.toBeNull();
    await expect(findDownloadableFile(fileId, ownerA)).resolves.toMatchObject({ id: fileId });
  });
});
