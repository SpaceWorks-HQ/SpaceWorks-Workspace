import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveRecord,
  operate,
  loadGovernance,
  changeBank,
  revealBank,
  attachFile,
  detachFile,
  type Actor,
} from "@/lib/governance/service";
import { run } from "@/lib/scheduled/governance";
import { searchWorkspace } from "@/lib/assistant/tools/workspace";
import type { Principal } from "@/lib/assistant/principal";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
const suffix = uniqueSuffix(),
  emailSuffix = `@governance-${suffix}.test`,
  slugs = [`governance-${suffix}`, `gov-other-${suffix}`];
let actor: Actor, other: Actor, member: Actor, guest: Actor;
let committeeId = "",
  organisationId = "",
  meetingId = "",
  vendorId = "";
const obligation = (extra = {}) => ({
  kind: "OBLIGATION",
  title: "Governance annual filing",
  status: "TODO",
  dueOn: "2026-12-31",
  details: { recurrence: "ANNUALLY" },
  ...extra,
});
beforeAll(async () => {
  const owner = await createUser(`owner${emailSuffix}`),
    stranger = await createUser(`other${emailSuffix}`),
    ordinary = await createUser(`member${emailSuffix}`),
    visitor = await createUser(`guest${emailSuffix}`);
  const workspace = await createWorkspace(slugs[0], owner.id),
    workspace2 = await createWorkspace(slugs[1], stranger.id);
  const membership = await prisma.membership.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: owner.id },
  });
  actor = { user: owner, workspace, membership };
  other = {
    user: stranger,
    workspace: workspace2,
    membership: { role: "OWNER" },
  };
  member = {
    ...actor,
    user: ordinary,
    membership: await addMember(workspace.id, ordinary.id),
  };
  guest = {
    ...actor,
    user: visitor,
    membership: await addMember(workspace.id, visitor.id, "GUEST"),
  };
  committeeId = (
    await saveRecord(actor, {
      kind: "COMMITTEE",
      title: "Governing board",
      status: "ACTIVE",
      details: { committeeType: "BOARD" },
    })
  ).id;
  organisationId = (
    await prisma.organisation.create({
      data: {
        workspaceId: workspace.id,
        name: "Kochi print cooperative",
        ownerId: owner.id,
      },
    })
  ).id;
  meetingId = (
    await prisma.meeting.create({
      data: {
        workspaceId: workspace.id,
        title: "Board meeting",
        startsAt: new Date(),
        createdById: owner.id,
        visibility: "PRIVATE",
      },
    })
  ).id;
});
afterAll(async () => cleanup(slugs, emailSuffix));
describe("governance tenant boundaries and complete manual flows", () => {
  it("denies members, guests, forged roles and cross-workspace edits", async () => {
    for (const denied of [
      member,
      guest,
      { ...member, membership: { role: "OWNER" as const } },
    ]) {
      await expect(saveRecord(denied, obligation())).rejects.toThrow();
      await expect(loadGovernance(denied, "board", {})).rejects.toThrow();
    }
    await expect(
      saveRecord(other, {
        kind: "COMMITTEE",
        id: committeeId,
        title: "Changed",
        status: "ACTIVE",
        details: { committeeType: "BOARD" },
      }),
    ).rejects.toThrow();
    expect(
      (await loadGovernance(other, "board", {}, committeeId)).selected,
    ).toBeNull();
  });
  it("validates references to committee, meeting, owner, vendor and CRM organisation", async () => {
    await expect(
      saveRecord(other, {
        kind: "MINUTES",
        title: "Minutes",
        status: "DRAFT",
        parentId: committeeId,
        meetingId,
        details: { content: "Agreed." },
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(other, {
        kind: "VENDOR",
        title: "Vendor",
        status: "ACTIVE",
        organisationId,
        details: {},
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, obligation({ ownerId: other.user.id })),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, {
        kind: "CONTRACT",
        title: "Contract",
        status: "ACTIVE",
        startsOn: "2026-01-01",
        endsOn: "2027-01-01",
        details: {
          vendorId: committeeId,
          amountMinor: 10000,
          currency: "INR",
          noticeDays: 30,
        },
      }),
    ).rejects.toThrow();
  });
  it("retains filing proof and creates the next occurrence once under retries", async () => {
    const first = await saveRecord(
      actor,
      obligation({
        status: "FILED",
        ownerId: actor.user.id,
        details: { recurrence: "ANNUALLY", acknowledgement: "ACK-2026" },
      }),
    );
    const results = await Promise.all([
      operate(actor, { op: "next", id: first.id }),
      operate(actor, { op: "next", id: first.id }),
    ]);
    expect(results[0].id).toBe(results[1].id);
    const original = await prisma.governanceRecord.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(original.details).toMatchObject({ acknowledgement: "ACK-2026" });
    expect(
      (
        await prisma.governanceRecord.findUniqueOrThrow({
          where: { id: results[0].id },
        })
      ).dueOn?.toISOString(),
    ).toContain("2027-12-31");
  });
  it("records terms, declarations and a repeat-safe AGM checklist", async () => {
    await saveRecord(actor, {
      kind: "TERM",
      title: "Chair term",
      status: "ACTIVE",
      parentId: committeeId,
      startsOn: "2026-01-01",
      endsOn: "2028-12-31",
      details: { person: "Anjali", position: "Chair" },
    });
    await saveRecord(actor, {
      kind: "CONFLICT",
      title: "Annual declaration",
      status: "DECLARED",
      parentId: committeeId,
      dueOn: "2026-10-20",
      details: { person: "Anjali", declaration: "No conflicts declared." },
    });
    await Promise.all(
      [1, 2].map(() =>
        operate(actor, {
          op: "agm",
          parentId: committeeId,
          year: "2026",
          dueOn: "2026-12-01",
        }),
      ),
    );
    expect(
      await prisma.governanceRecord.count({
        where: { workspaceId: actor.workspace.id, kind: "AGM_ITEM" },
      }),
    ).toBe(6);
  });
  it("approves minutes once and prevents subsequent text, proof or archive changes", async () => {
    const minutes = await saveRecord(actor, {
      kind: "MINUTES",
      title: "Annual minutes",
      status: "DRAFT",
      parentId: committeeId,
      meetingId,
      details: { content: "Accounts were reviewed." },
    });
    await operate(actor, { op: "approve", id: minutes.id });
    await expect(
      operate(actor, { op: "approve", id: minutes.id }),
    ).rejects.toThrow();
    await expect(
      operate(actor, { op: "archive", id: minutes.id }),
    ).rejects.toThrow();
    await expect(
      saveRecord(actor, {
        id: minutes.id,
        kind: "MINUTES",
        title: "Altered",
        status: "DRAFT",
        parentId: committeeId,
        meetingId,
        details: { content: "Changed." },
      }),
    ).rejects.toThrow();
    await expect(
      attachFile(
        actor,
        minutes.id,
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow();
  });
  it("allocates distinct workspace resolution numbers concurrently", async () => {
    const rows = await Promise.all(
      ["One", "Two"].map((title) =>
        saveRecord(actor, {
          kind: "RESOLUTION",
          title,
          status: "PASSED",
          parentId: committeeId,
          details: { content: title },
        }),
      ),
    );
    const records = await prisma.governanceRecord.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: { in: rows.map((r) => r.id) },
      },
    });
    expect(new Set(records.map((r) => r.number)).size).toBe(2);
  });
  it("extends an existing CRM organisation and encrypts every banking revision", async () => {
    vendorId = (
      await saveRecord(actor, {
        kind: "VENDOR",
        title: "Print vendor",
        status: "ACTIVE",
        organisationId,
        details: { pan: "ABCDE1234F", gstin: "32ABCDE1234F1Z5" },
      })
    ).id;
    await changeBank(actor, {
      vendorId,
      accountName: "Print cooperative",
      bankName: "Community bank",
      accountNumber: "0123456789",
      routingCode: "TEST0000001",
      reason: "Initial verified bank instructions",
    });
    await changeBank(actor, {
      vendorId,
      accountName: "Print cooperative",
      bankName: "Community bank",
      accountNumber: "9876543210",
      reason: "Verified replacement account",
    });
    const changes = await prisma.governanceBankChange.findMany({
      where: { workspaceId: actor.workspace.id, vendorId },
    });
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => !c.bankEnc.includes("9876543210"))).toBe(true);
    expect((await revealBank(actor, vendorId))?.accountNumber).toBe(
      "9876543210",
    );
    await expect(revealBank(member, vendorId)).rejects.toThrow();
    await expect(revealBank(other, vendorId)).rejects.toThrow();
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: actor.workspace.id,
          targetId: vendorId,
          action: "governance.bank_revealed",
        },
      }),
    ).toBe(1);
    const selected = (await loadGovernance(actor, "vendors", {}, vendorId))
      .selected!;
    expect(JSON.stringify(selected)).not.toContain("bankEnc");
    expect(JSON.stringify(selected)).not.toContain("9876543210");
  });
  it("stores multiple proof files privately and excludes them from the library", async () => {
    const obligationRow = await saveRecord(actor, obligation());
    const uploaded = await attachFile(
      actor,
      obligationRow.id,
      new File(["%PDF-1.4\nproof"], "acknowledgement.pdf", {
        type: "application/pdf",
      }),
    );
    await attachFile(
      actor,
      obligationRow.id,
      new File(["%PDF-1.4\nsecond"], "second.pdf", { type: "application/pdf" }),
    );
    expect(
      await findDownloadableFile(uploaded.id, actor.user.id),
    ).not.toBeNull();
    for (const denied of [member, guest, other])
      expect(
        await findDownloadableFile(uploaded.id, denied.user.id),
      ).toBeNull();
    const actorFull = await prisma.membership.findFirstOrThrow({
      where: { workspaceId: actor.workspace.id, userId: actor.user.id },
    });
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspace.id },
    });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: actor.user.id },
    });
    expect(
      await prisma.fileObject.count({
        where: {
          ...(await libraryWhere({
            workspace,
            user: { id: user.id, name: user.name },
            membership: actorFull,
          })),
          id: uploaded.id,
        },
      }),
    ).toBe(0);
    await expect(
      attachFile(
        member,
        obligationRow.id,
        new File(["proof"], "proof.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow();
    await expect(
      attachFile(
        actor,
        obligationRow.id,
        new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow();
    await detachFile(actor, obligationRow.id, uploaded.id);
    expect(await findDownloadableFile(uploaded.id, actor.user.id)).toBeNull();
  });
  it("checks source permissions for private governance search and removes archived records", async () => {
    const record = await saveRecord(
      actor,
      obligation({ title: `Governance unique ${suffix}` }),
    );
    for (const viewer of [member, guest, other])
      expect(
        await searchDocuments(
          {
            workspaceId: viewer.workspace.id,
            userId: viewer.user.id,
            role: viewer.membership.role,
          },
          suffix,
          "governance",
        ),
      ).toHaveLength(0);
    expect(
      (
        await searchDocuments(
          {
            workspaceId: actor.workspace.id,
            userId: actor.user.id,
            role: "OWNER",
          },
          suffix,
          "governance",
        )
      ).some((r) => r.entityId === record.id),
    ).toBe(true);
    await operate(actor, { op: "archive", id: record.id });
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: actor.workspace.id, entityId: record.id },
      }),
    ).toBe(0);
  });
  it("reminds for due filings and contract notice dates once across concurrent ticks", async () => {
    const filing = await saveRecord(
      actor,
      obligation({
        ownerId: actor.user.id,
        dueOn: "2027-06-15",
        reminderDays: 7,
      }),
    );
    const contract = await saveRecord(actor, {
      kind: "CONTRACT",
      title: "Printing agreement",
      status: "ACTIVE",
      ownerId: actor.user.id,
      startsOn: "2027-01-01",
      endsOn: "2027-07-15",
      reminderDays: 7,
      details: {
        vendorId,
        amountMinor: 125000,
        currency: "INR",
        noticeDays: 30,
      },
    });
    await Promise.all([
      run(new Date("2027-06-08T04:00:00Z")),
      run(new Date("2027-06-08T04:00:00Z")),
    ]);
    for (const recordId of [filing.id, contract.id])
      expect(
        await prisma.notificationEventRecord.count({
          where: {
            workspaceId: actor.workspace.id,
            dedupeKey: { startsWith: `governance:${recordId}:` },
          },
        }),
      ).toBe(1);
    await run(new Date("2027-06-16T04:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: actor.workspace.id,
          dedupeKey: { startsWith: `governance:${filing.id}:` },
        },
      }),
    ).toBe(2);
  });
  it("restores archived records and their search entries without duplicating them", async () => {
    const record = await saveRecord(
      actor,
      obligation({ title: "Restore this filing" }),
    );
    await operate(actor, { op: "archive", id: record.id });
    expect(
      (await loadGovernance(actor, "compliance", {}, record.id)).selected,
    ).toBeNull();
    expect(
      (await loadGovernance(actor, "compliance", { archived: "1" }, record.id))
        .selected?.id,
    ).toBe(record.id);
    await expect(
      operate(other, { op: "restore", id: record.id }),
    ).rejects.toThrow();
    await operate(actor, { op: "restore", id: record.id });
    expect(
      (await loadGovernance(actor, "compliance", {}, record.id)).selected?.id,
    ).toBe(record.id);
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: actor.workspace.id, entityId: record.id },
      }),
    ).toBe(1);
  });
  it("keeps governance out of assistant jobs and rechecks live source access", async () => {
    const record = await saveRecord(
      actor,
      obligation({
        title: `Assistant governance ${suffix}`,
        ownerId: actor.user.id,
      }),
    );
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: actor.workspace.id },
    });
    const principal: Principal = {
      kind: "user",
      userId: actor.user.id,
      userName: "Owner",
      role: "OWNER",
      workspace,
    };
    const search = async (p: Principal) =>
      (
        await searchWorkspace.run(
          { principal: p, via: "chat", now: new Date() },
          { query: suffix, types: ["governance"], limit: 30 },
        )
      ).data as { results: Array<{ id: string }> };
    expect(
      (await search(principal)).results.some((r) => r.id === record.id),
    ).toBe(true);
    expect(
      (await search({ ...principal, kind: "job", role: "MEMBER" })).results,
    ).toHaveLength(0);
    expect(
      (await search({ ...principal, role: "MEMBER" })).results,
    ).toHaveLength(0);
    await prisma.governanceRecord.update({
      where: { id: record.id },
      data: { archivedAt: new Date() },
    });
    expect(
      (await search(principal)).results.some((r) => r.id === record.id),
    ).toBe(false);
  });
  it("denies stale suspended members and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: other.workspace.id, userId: other.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(saveRecord(other, obligation())).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadGovernance(other, "board", {})).rejects.toThrow();
  });
});
