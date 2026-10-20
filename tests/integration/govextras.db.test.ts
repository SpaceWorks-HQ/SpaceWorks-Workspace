import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
import {
  saveRecord,
  loadGovernance,
  attachFile,
  detachFile,
  operate,
  type Actor,
} from "@/lib/governance/service";
import {
  appointHandler,
  createCase,
  loadCases,
  addCaseEvent,
  updateCase,
  completeCaseAction,
  uploadCaseFile,
  caseAccess,
} from "@/lib/govextras/cases";
import { linkConflict, loadConflictLinks } from "@/lib/govextras/conflicts";
import { packPdf } from "@/lib/govextras/pack-pdf";
import { freezePack } from "@/lib/govextras/packs";
import { run as remind } from "@/lib/scheduled/govextras";
import { run as remindGovernance } from "@/lib/scheduled/governance";
import { findDownloadableFile } from "@/lib/files";
import { getObject, deleteObjects } from "@/lib/storage";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { indexSearchDocument } from "@/lib/search/documents";
import { writeFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
const suffix = uniqueSuffix(),
  domain = `@govextras-${suffix}.test`,
  slugs = [`govex-${suffix}`, `govex-other-${suffix}`];
let owner: Actor,
  admin: Actor,
  handler: Actor,
  second: Actor,
  other: Actor,
  guest: Actor,
  committee: string,
  caseId: string,
  docId: string,
  entityId: string;
const proof = () =>
  new File(["%PDF-1.4\nGovernance evidence"], "proof.pdf", {
    type: "application/pdf",
  });
beforeAll(async () => {
  const users = await Promise.all(
    ["owner", "admin", "handler", "second", "other", "guest"].map((n) =>
      createUser(n + domain, n),
    ),
  );
  const workspace = await createWorkspace(slugs[0], users[0].id),
    otherWorkspace = await createWorkspace(slugs[1], users[4].id);
  owner = { user: users[0], workspace, membership: { role: "OWNER" } };
  admin = {
    user: users[1],
    workspace,
    membership: await addMember(workspace.id, users[1].id, "ADMIN"),
  };
  handler = {
    user: users[2],
    workspace,
    membership: await addMember(workspace.id, users[2].id, "MEMBER"),
  };
  second = {
    user: users[3],
    workspace,
    membership: await addMember(workspace.id, users[3].id, "MEMBER"),
  };
  other = {
    user: users[4],
    workspace: otherWorkspace,
    membership: { role: "OWNER" },
  };
  guest = {
    user: users[5],
    workspace,
    membership: await addMember(workspace.id, users[5].id, "GUEST"),
  };
  committee = (
    await saveRecord(owner, {
      kind: "COMMITTEE",
      title: "Internal Committee",
      status: "ACTIVE",
      details: { committeeType: "COMMITTEE", mandate: "Safeguarding" },
    })
  ).id;
  entityId = (
    await saveRecord(owner, {
      kind: "LEGAL_ENTITY",
      title: "Kochi Community Trust",
      status: "ACTIVE",
      details: { entityType: "TRUST" },
    })
  ).id;
  docId = (
    await prisma.doc.create({
      data: {
        workspaceId: workspace.id,
        title: "Emergency response SOP",
        contentText: "Check exits. Gather outside. Call the designated lead.",
        contentHtml:
          "<p>Check exits. Gather outside. Call the designated lead.</p>",
        createdById: owner.user.id,
        visibility: "ADMINS",
      },
    })
  ).id;
});
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspaceId: { in: [owner.workspace.id, other.workspace.id] } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup(slugs, domain);
});
describe("governance extras production flows", () => {
  it("extends cover, licence and registration records with private evidence and calendar links", async () => {
    const obligation = (
      await saveRecord(owner, {
        kind: "OBLIGATION",
        title: "Renew office cover",
        status: "TODO",
        dueOn: "2027-01-10",
        details: { recurrence: "ANNUALLY" },
      })
    ).id;
    for (const kind of ["INSURANCE", "LICENCE", "REGISTRATION"] as const) {
      const row = await saveRecord(owner, {
        kind,
        title: kind,
        status: "ACTIVE",
        startsOn: "2026-01-01",
        endsOn: "2027-01-10",
        ownerId: owner.user.id,
        details: {
          issuer: "Community insurer",
          reference: "DEMO-123",
          scope: "Kochi office",
          currency: "INR",
          sumInsuredMinor: 10000000,
          premiumMinor: 125000,
          obligationId: obligation,
        },
      });
      const file = await attachFile(owner, row.id, proof());
      expect(await findDownloadableFile(file.id, admin.user.id)).not.toBeNull();
      expect(await findDownloadableFile(file.id, handler.user.id)).toBeNull();
      expect(
        (await loadGovernance(owner, "registers", {}, row.id)).selected?.kind,
      ).toBe(kind);
      await expect(
        saveRecord(other, {
          id: row.id,
          kind,
          title: "Foreign",
          status: "ACTIVE",
          startsOn: "2026-01-01",
          endsOn: "2027-01-01",
          details: { issuer: "X", reference: "X", currency: "INR" },
        }),
      ).rejects.toThrow();
    }
  });
  it("enforces tenant references for registers, emergency plans and reviews", async () => {
    await expect(
      saveRecord(other, {
        kind: "STATUTORY_REGISTER",
        title: "Members",
        status: "CURRENT",
        dueOn: "2027-01-01",
        details: { entityId, registerType: "MEMBERS" },
      }),
    ).rejects.toThrow();
    await expect(
      saveRecord(other, {
        kind: "SOP_REVIEW",
        title: "Foreign SOP",
        status: "DUE",
        dueOn: "2027-01-01",
        details: { docId },
      }),
    ).rejects.toThrow();
    const row = await saveRecord(owner, {
      kind: "STATUTORY_REGISTER",
      title: "Trustee register snapshot",
      status: "CURRENT",
      dueOn: "2027-01-01",
      details: {
        entityId,
        registerType: "DIRECTORS",
        scope: "Trust deed register",
      },
    });
    await attachFile(owner, row.id, proof());
    expect(
      (await loadGovernance(owner, "registers", {}, row.id)).selected
        ?.attachments,
    ).toHaveLength(1);
  });
  it("records risks, emergency plan document links and completed drills", async () => {
    const risk = await saveRecord(owner, {
      kind: "RISK",
      title: "Blocked exit",
      status: "OPEN",
      dueOn: "2027-01-01",
      details: {
        likelihood: 3,
        impact: 5,
        controls: "Daily exit check",
        assessment: "Office occupants",
      },
    });
    const plan = await saveRecord(owner, {
      kind: "EMERGENCY_PLAN",
      title: "Evacuation",
      status: "ACTIVE",
      dueOn: "2027-01-01",
      details: { docId },
    });
    const drill = await saveRecord(owner, {
      kind: "DRILL",
      title: "October drill",
      status: "DONE",
      dueOn: "2026-10-01",
      details: {
        planId: plan.id,
        findings: "All exits clear",
        actions: "Refresh signage",
      },
    });
    expect(
      (await loadGovernance(owner, "risk", {}, risk.id)).selected?.details,
    ).toMatchObject({ likelihood: 3, impact: 5 });
    expect(
      (await loadGovernance(owner, "risk", {}, drill.id)).selected?.status,
    ).toBe("DONE");
  });
  it("links declarations to tenant purchases, bills, contracts and decisions and flags payees", async () => {
    const organisation = await prisma.organisation.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Kochi Print Cooperative",
      },
    });
    const vendor = (
      await saveRecord(owner, {
        kind: "VENDOR",
        title: organisation.name,
        status: "ACTIVE",
        organisationId: organisation.id,
        details: {},
      })
    ).id;
    const declaration = (
      await saveRecord(owner, {
        kind: "CONFLICT",
        title: "Print interest",
        status: "DECLARED",
        parentId: committee,
        dueOn: "2026-10-20",
        details: {
          person: "Trustee",
          declaration: "Related party",
          partyOrgId: organisation.id,
          partyName: organisation.name,
        },
      })
    ).id;
    const purchase = await prisma.purchaseRequest.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Printing",
        requesterId: owner.user.id,
        items: [],
        totalMinor: 10000,
        vendorOrgId: organisation.id,
      },
    });
    const bill = await prisma.financeBill.create({
      data: {
        workspaceId: owner.workspace.id,
        vendor: "  KOCHI PRINT COOPERATIVE ",
        number: "BILL-1",
        issuedOn: new Date("2026-10-01"),
        dueOn: new Date("2026-10-31"),
        amountMinor: 10000,
        createdById: owner.user.id,
      },
    });
    const contract = await saveRecord(owner, {
      kind: "CONTRACT",
      title: "Printing agreement",
      status: "ACTIVE",
      startsOn: "2026-01-01",
      endsOn: "2027-01-01",
      details: {
        vendorId: vendor,
        amountMinor: 10000,
        currency: "INR",
        noticeDays: 30,
      },
    });
    const decision = await prisma.decision.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Approve print purchase",
        decisionMd: "Recusal recorded",
        createdById: owner.user.id,
      },
    });
    for (const [targetType, targetId] of [
      ["purchase", purchase.id],
      ["bill", bill.id],
      ["contract", contract.id],
      ["decision", decision.id],
    ])
      await linkConflict(owner, {
        declarationId: declaration,
        targetType,
        targetId,
        note: "Trustee recused",
      });
    const data = await loadConflictLinks(owner, declaration);
    expect(data.links).toHaveLength(4);
    expect(data.warnings).toHaveLength(3);
    await expect(
      linkConflict(other, {
        declarationId: declaration,
        targetType: "purchase",
        targetId: purchase.id,
      }),
    ).rejects.toThrow();
    const otherDecision = await prisma.decision.create({
      data: {
        workspaceId: other.workspace.id,
        title: "Private",
        decisionMd: "Private",
      },
    });
    await expect(
      linkConflict(owner, {
        declarationId: declaration,
        targetType: "decision",
        targetId: otherDecision.id,
      }),
    ).rejects.toThrow();
  });
  it("lets only owners record explicit current committee appointments", async () => {
    await expect(
      appointHandler(admin, {
        userId: handler.user.id,
        committeeId: committee,
        endsOn: "2099-12-31",
      }),
    ).rejects.toThrow();
    await expect(
      appointHandler(owner, {
        userId: other.user.id,
        committeeId: committee,
        endsOn: "2099-12-31",
      }),
    ).rejects.toThrow();
    for (const userId of [handler.user.id, second.user.id])
      await appointHandler(owner, {
        userId,
        committeeId: committee,
        endsOn: "2099-12-31",
      });
    expect((await loadCases(owner, {})).appointed).toBe(false);
    expect((await loadCases(handler, {})).appointed).toBe(true);
  });
  it("keeps case details from owners, admins, guests and unassigned handlers", async () => {
    caseId = (
      await createCase(handler, {
        kind: "POSH",
        receivedOn: "2026-10-01",
        dueOn: "2026-10-31",
        handlerIds: [handler.user.id],
        details: "Private concern for committee",
      })
    ).id;
    const stored = await prisma.safeguardingCase.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: caseId },
    });
    expect(stored.detailsEnc).not.toContain("Private concern");
    for (const denied of [
      owner,
      admin,
      guest,
      second,
      other,
      { ...admin, membership: { role: "OWNER" as const } },
    ])
      await expect(caseAccess(denied, caseId)).rejects.toThrow();
    expect(
      (
        await loadCases(handler, {
          q: "999999999999999999999999999999999999999",
        })
      ).rows,
    ).toHaveLength(0);
    expect((await loadCases(handler, {}, caseId)).selected?.details).toBe(
      "Private concern for committee",
    );
    await expect(
      createCase(admin, {
        kind: "POSH",
        receivedOn: "2026-10-01",
        dueOn: "2026-10-31",
        handlerIds: [admin.user.id],
        details: "Concern",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.searchDocument.count({
        where: { workspaceId: owner.workspace.id, entityId: caseId },
      }),
    ).toBe(0);
  });
  it("stores case photos and PDFs with source-specific access outside the file library", async () => {
    const file = await uploadCaseFile(handler, caseId, proof());
    expect(await findDownloadableFile(file.id, handler.user.id)).not.toBeNull();
    for (const denied of [owner, admin, second, other, guest])
      expect(await findDownloadableFile(file.id, denied.user.id)).toBeNull();
    const exported = await buildWorkspaceExport(owner.workspace.id);
    expect(JSON.stringify(exported)).not.toContain(file.id);
    await indexSearchDocument({
      workspaceId: owner.workspace.id,
      entityType: "file",
      entityId: file.id,
      title: `Restricted proof ${suffix}`,
      url: `/api/files/${file.id}`,
      visibility: "WORKSPACE",
    });
    expect(
      await searchDocuments(
        {
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
          role: "OWNER",
        },
        suffix,
        "file",
      ),
    ).toHaveLength(0);
    const user = await prisma.user.findFirstOrThrow({
      where: { id: handler.user.id },
    });
    expect(
      await prisma.fileObject.count({
        where: {
          ...(await libraryWhere({
            ...handler,
            user: { id: user.id, name: user.name },
          })),
          id: file.id,
        },
      }),
    ).toBe(0);
    await expect(
      uploadCaseFile(
        handler,
        caseId,
        new File(["bad"], "bad.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow();
    await expect(uploadCaseFile(admin, caseId, proof())).rejects.toThrow();
    const orphan = await prisma.fileObject.create({
      data: {
        workspaceId: owner.workspace.id,
        folder: "/safeguarding",
        filename: "orphan.pdf",
        storageKey: `orphan-${suffix}`,
        contentType: "application/pdf",
        size: 1,
      },
    });
    expect(await findDownloadableFile(orphan.id, owner.user.id)).toBeNull();
  });
  it("maintains restricted append-only timelines and requires finished actions plus outcome", async () => {
    await addCaseEvent(handler, {
      caseId,
      kind: "ACTION",
      body: "Committee action",
      ownerId: handler.user.id,
      dueOn: "2026-10-31",
    });
    await expect(
      updateCase(handler, { caseId, status: "CLOSED" }),
    ).rejects.toThrow();
    const action = await prisma.safeguardingEvent.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, caseId, kind: "ACTION" },
    });
    expect(action.bodyEnc).not.toContain("Committee action");
    await expect(
      completeCaseAction(admin, caseId, action.id),
    ).rejects.toThrow();
    await completeCaseAction(handler, caseId, action.id);
    await expect(
      updateCase(handler, { caseId, status: "CLOSED" }),
    ).rejects.toThrow();
    await addCaseEvent(handler, {
      caseId,
      kind: "OUTCOME",
      body: "Committee outcome recorded",
    });
    await updateCase(handler, { caseId, status: "CLOSED" });
    await expect(
      addCaseEvent(handler, { caseId, kind: "NOTE", body: "Late edit" }),
    ).rejects.toThrow();
    await expect(uploadCaseFile(handler, caseId, proof())).rejects.toThrow();
  });
  it("revokes case and file access immediately after appointment revocation", async () => {
    const row = await createCase(second, {
      kind: "SAFEGUARDING",
      receivedOn: "2026-10-01",
      dueOn: "2026-10-31",
      handlerIds: [second.user.id],
      details: "Restricted",
    });
    const file = await uploadCaseFile(second, row.id, proof());
    await appointHandler(owner, {
      userId: second.user.id,
      committeeId: committee,
      endsOn: "2099-12-31",
      revoke: true,
    });
    await expect(caseAccess(second, row.id)).rejects.toThrow();
    expect(await findDownloadableFile(file.id, second.user.id)).toBeNull();
    expect((await loadCases(second, {})).rows).toHaveLength(0);
  });
  it("freezes reports, decisions, finance and binary evidence into immutable private PDF and ZIP", async () => {
    const evidence = (
      await saveRecord(owner, {
        kind: "RISK",
        title: "Evidence for board",
        status: "CONTROLLED",
        dueOn: "2027-01-01",
        details: { likelihood: 2, impact: 3, controls: "Exit checks" },
      })
    ).id;
    await attachFile(owner, evidence, proof());
    const decision = await prisma.decision.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Safety review",
        decisionMd: "Keep exits clear",
      },
    });
    const pack = await saveRecord(owner, {
      kind: "BOARD_PACK",
      title: "October board pack",
      status: "DRAFT",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      details: {
        docIds: [docId],
        decisionIds: [decision.id],
        recordIds: [evidence],
        includeFinance: true,
        currency: "INR",
      },
    });
    await freezePack(owner, pack.id);
    await freezePack(owner, pack.id);
    const frozen = (await loadGovernance(owner, "packs", {}, pack.id))
      .selected!;
    expect(frozen.status).toBe("FROZEN");
    const pdfFile = frozen.attachments.find(
      (a) => a.file.contentType === "application/pdf",
    )!.file;
    const zipFile = frozen.attachments.find(
      (a) => a.file.contentType === "application/zip",
    )!.file;
    const pdf = await findDownloadableFile(pdfFile.id, owner.user.id),
      zip = await findDownloadableFile(zipFile.id, owner.user.id);
    const pdfBytes = await getObject(pdf!.storageKey),
      zipBytes = await getObject(zip!.storageKey);
    expect(await PDFDocument.load(pdfBytes!.body)).toBeTruthy();
    expect(Buffer.from(zipBytes!.body).includes(Buffer.from("evidence/"))).toBe(
      true,
    );
    expect(
      Buffer.from(zipBytes!.body).includes(
        Buffer.from("Emergency response SOP"),
      ),
    ).toBe(true);
    const oldChecksum = pdf!.storageKey;
    await prisma.doc.updateMany({
      where: { workspaceId: owner.workspace.id, id: docId },
      data: { contentText: "Changed after freeze" },
    });
    expect(
      (await findDownloadableFile(pdfFile.id, owner.user.id))?.storageKey,
    ).toBe(oldChecksum);
    await expect(attachFile(owner, pack.id, proof())).rejects.toThrow();
    await expect(detachFile(owner, pack.id, pdfFile.id)).rejects.toThrow();
    await expect(
      operate(owner, { op: "archive", id: pack.id }),
    ).rejects.toThrow();
    expect(await findDownloadableFile(zipFile.id, handler.user.id)).toBeNull();
    await mkdir("/tmp/govextras-pdf-qa", { recursive: true });
    await writeFile("/tmp/govextras-pdf-qa/board-pack.pdf", pdfBytes!.body);
    await writeFile("/tmp/govextras-pdf-qa/board-pack.zip", zipBytes!.body);
  }, 60000);
  it("paginates long reports while retaining the final section", async () => {
    const body = await packPdf(
      "Quarterly board report " + "with a long heading ".repeat(8),
      "Kochi community office",
      Array.from({ length: 12 }, (_, i) => ({
        title: `Section ${i + 1}`,
        body: "Controls reviewed. Keep exits clear and record the next drill.\n".repeat(
          10,
        ),
      })),
    );
    expect((await PDFDocument.load(body)).getPageCount()).toBeGreaterThan(2);
    await writeFile("/tmp/govextras-pdf-qa/long-report.pdf", body);
  }, 60000);
  it("reminds for policy reviews and renewals once across replica ticks", async () => {
    const review = await saveRecord(owner, {
      kind: "SOP_REVIEW",
      title: "Review evacuation SOP",
      status: "DUE",
      ownerId: owner.user.id,
      dueOn: "2027-01-10",
      details: { docId },
    });
    await prisma.doc.updateMany({
      where: { workspaceId: owner.workspace.id, id: docId },
      data: {
        verifiedUntil: new Date("2027-01-10"),
        verifiedById: owner.user.id,
      },
    });
    const now = new Date("2027-01-05T04:00:00Z");
    await Promise.all([
      remind(now),
      remind(now),
      remindGovernance(now),
      remindGovernance(now),
    ]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "governance.review_due",
          dedupeKey: { contains: review.id },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "doc.review_due",
          dedupeKey: { contains: docId },
        },
      }),
    ).toBe(1);
  }, 60000);
  it("dispatches generic case reminders only to currently assigned appointed handlers", async () => {
    const row = await createCase(handler, {
      kind: "SAFEGUARDING",
      receivedOn: "2026-10-01",
      dueOn: "2026-10-15",
      handlerIds: [handler.user.id],
      details: "Never send this concern",
    });
    await Promise.all([
      remind(new Date("2026-10-20T04:00:00Z")),
      remind(new Date("2026-10-20T04:00:00Z")),
    ]);
    const events = await prisma.notificationEventRecord.findMany({
      where: {
        workspaceId: owner.workspace.id,
        type: "safeguarding.review_due",
        dedupeKey: { contains: row.id },
      },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("Never send this concern");
    const notifications = await prisma.notification.findMany({
      where: { workspaceId: owner.workspace.id, eventId: events[0].id },
    });
    expect(notifications.map((n) => n.userId)).toEqual([handler.user.id]);
  }, 60000);
  it("indexes ordinary extras privately with live governance role checks", async () => {
    const risk = await saveRecord(owner, {
      kind: "RISK",
      title: `Risk searchable ${suffix}`,
      status: "OPEN",
      dueOn: "2027-01-01",
      details: { likelihood: 1, impact: 1, controls: "Check" },
    });
    const search = (a: Actor) =>
      searchDocuments(
        {
          workspaceId: a.workspace.id,
          userId: a.user.id,
          role: a.membership.role,
        },
        suffix,
        "governance",
      );
    expect((await search(owner)).some((r) => r.entityId === risk.id)).toBe(
      true,
    );
    expect(await search(handler)).toHaveLength(0);
    expect(await search(other)).toHaveLength(0);
  });
  it("seeds every manual tool repeatably without inventing evidence", async () => {
    // The demo loader discovers this standard module automatically.
    const modulePath = "../../scripts/seed/govextras.mjs";
    const seed = (await import(modulePath)).default;
    const context = {
      workspaceId: owner.workspace.id,
      workspace: owner.workspace,
      users: { owner: owner.user },
      channels: {},
    };
    await seed(prisma, context);
    const count = await prisma.governanceRecord.count({
      where: { workspaceId: owner.workspace.id },
    });
    await seed(prisma, context);
    expect(
      await prisma.governanceRecord.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(count);
  });
  it("denies stale suspended handlers and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: handler.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(loadCases(handler, {})).rejects.toThrow();
    await prisma.workspace.updateMany({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(loadGovernance(other, "risk", {})).rejects.toThrow();
  });
});
