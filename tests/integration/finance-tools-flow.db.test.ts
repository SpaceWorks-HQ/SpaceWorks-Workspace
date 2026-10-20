import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
const ai = vi.hoisted(() => ({ configured: false, called: 0 }));
vi.mock("@/lib/assistant/client", () => ({
  getAssistantConfig: async () =>
    ai.configured
      ? { apiKey: "fake", model: "configured-model", jobModel: "unused" }
      : null,
  createAnthropicClient: () => ({
    beta: {
      messages: {
        create: async (input: Record<string, unknown>) => {
          expect(input.model).toBe("configured-model");
          ai.called++;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  vendor: "Receipt supplier",
                  date: "2026-06-10",
                  invoiceNumber: "R-10",
                  gstin: null,
                  taxableValue: "100",
                  cgst: "9",
                  sgst: "9",
                  igst: "0",
                  total: "118",
                  suggestedCategory: "Office materials",
                }),
              },
            ],
          };
        },
      },
    },
  }),
  messageText: (m: { content: Array<{ text: string }> }) =>
    m.content.map((v) => v.text).join(""),
  modelOptions: () => ({}),
}));
import { prisma } from "@/lib/db";
import { getWorkspaceForAction } from "@/lib/permissions";
import type { WorkspaceContext } from "@/lib/permissions";
import { financeAccess } from "@/lib/finance/tools/access";
import {
  addEntry,
  saveBudget,
  saveFund,
  saveCentre,
  saveBill,
  payBill,
  saveEntryTags,
  budgetActual,
} from "@/lib/finance/tools/service";
import {
  addAccount,
  accountBalance,
  startMonth,
  saveStep,
  reconcileAccount,
  markReconciled,
  closeMonth,
  reviewSpending,
} from "@/lib/finance/tools/close";
import {
  grantPayroll,
  savePayProfile,
  savePayRun,
  savePayBookkeeping,
  transitionPayRun,
  revealPayDetails,
} from "@/lib/finance/tools/payroll";
import {
  saveDisbursement,
  transitionDisbursement,
} from "@/lib/finance/tools/disbursements";
import {
  uploadFinanceFiles,
  claimStagedFiles,
  purgeExpiredStagedFiles,
  removeFinanceFile,
} from "@/lib/finance/tools/files";
import { extractReceipt } from "@/lib/finance/tools/extract";
import { financeCsv } from "@/lib/finance/tools/export";
import { generatePayslip } from "@/lib/finance/tools/pdf";
import { generateReportPdf } from "@/lib/finance/tools/report-pdf";
import {
  financeReports,
  payrollData,
  spendingReview,
} from "@/lib/finance/tools/queries";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { getLedgerEntry, ledgerWhere } from "@/lib/finance/queries";
import { createLedgerEntry } from "@/lib/finance/service";
import { ledgerEntrySchema } from "@/lib/finance/schemas";
import { financeToolAction } from "@/app/actions/finance-tools";
import { GET as csvRoute } from "@/app/w/[workspaceSlug]/finance/export/[kind]/route";
import { decide } from "@/lib/approvals/engine";
import { run as reminders } from "@/lib/scheduled/financeTools";
import { run as opsReminders } from "@/lib/scheduled/opsMoney";
import { getObject, deleteObjects } from "@/lib/storage";
import { dateOnly } from "@/lib/finance/dates";
import { searchDocuments } from "@/lib/search/query";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix(),
  domain = `@finance-tools-${suffix}.test`,
  slugs = [`ft-${suffix}`, `ft-other-${suffix}`];
let owner: WorkspaceContext,
  admin: WorkspaceContext,
  member: WorkspaceContext,
  guest: WorkspaceContext,
  foreign: WorkspaceContext;
let categoryId: string,
  foreignCategoryId: string,
  fundId: string,
  centreId: string,
  accountId: string,
  payRunId: string;
const entry = (extra: Record<string, unknown> = {}) => ({
  kind: "EXPENSE",
  amountMinor: 10000,
  currency: "INR",
  occurredOn: "2026-06-10",
  description: "Office materials",
  categoryId,
  accountId,
  fundId,
  costCentreId: centreId,
  ...extra,
});
const bill = (extra: Record<string, unknown> = {}) => ({
  vendor: "Paper cooperative",
  number: `B-${randomUUID()}`,
  issuedOn: "2026-06-01",
  dueOn: "2026-06-08",
  amountMinor: 30000,
  currency: "INR",
  categoryId,
  accountId,
  fundId,
  costCentreId: centreId,
  ...extra,
});
const receipt = () =>
  new File(["%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF"], "office-receipt.pdf", {
    type: "application/pdf",
  });
async function actor(slug: string, id: string) {
  session.id = id;
  return (await getWorkspaceForAction(slug))!;
}
beforeAll(async () => {
  const [o, a, m, g] = await Promise.all(
    ["owner", "admin", "member", "guest"].map((n) =>
      createUser(`${n}${domain}`, n),
    ),
  );
  const w = await createWorkspace(slugs[0]!, o!.id);
  await createWorkspace(slugs[1]!, o!.id);
  await addMember(w.id, a!.id, "ADMIN");
  await addMember(w.id, m!.id);
  await addMember(w.id, g!.id, "GUEST");
  owner = await actor(slugs[0]!, o!.id);
  admin = await actor(slugs[0]!, a!.id);
  member = await actor(slugs[0]!, m!.id);
  guest = await actor(slugs[0]!, g!.id);
  foreign = await actor(slugs[1]!, o!.id);
  categoryId = (
    await prisma.financeCategory.create({
      data: { workspaceId: w.id, name: "Office materials", kind: "EXPENSE" },
    })
  ).id;
  foreignCategoryId = (
    await prisma.financeCategory.create({
      data: {
        workspaceId: foreign.workspace.id,
        name: "Private category",
        kind: "EXPENSE",
      },
    })
  ).id;
  fundId = await saveFund(owner, {
    name: "Restricted education grant",
    restricted: true,
    currency: "INR",
    funder: "Local foundation",
  });
  centreId = await saveCentre(owner, {
    name: "Office programme",
    kind: "PROGRAMME",
  });
  accountId = await addAccount(owner, {
    name: "Office bank",
    currency: "INR",
    openingMinor: 50000,
    openingOn: "2026-01-01",
  });
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspace: { slug: { in: slugs } } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup(slugs, domain);
  await prisma.$disconnect();
});

describe.sequential("manual finance access and records", () => {
  it.each(["member", "guest"])(
    "denies %s writes even with forged context roles",
    async (role) => {
      const a = role === "member" ? member : guest;
      await expect(
        addEntry({ ...a, membership: { role: "OWNER" } }, entry()),
      ).rejects.toThrow("access");
    },
  );
  it("rechecks suspension and archive state", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(financeAccess(admin, "MANAGE")).rejects.toThrow("access");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: admin.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: foreign.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(financeAccess(foreign)).rejects.toThrow("access");
    await prisma.workspace.update({
      where: { id: foreign.workspace.id },
      data: { archivedAt: null },
    });
  });
  it("enforces finance visibility independently of general membership", async () => {
    await expect(financeAccess(member)).rejects.toThrow("access");
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { financeVisibleToMembers: true },
    });
    expect((await financeAccess(member)).member.role).toBe("MEMBER");
    await expect(financeAccess(guest)).rejects.toThrow("access");
  });
  it("rejects foreign categories, funds, accounts, centres and bills", async () => {
    await expect(
      addEntry(owner, entry({ categoryId: foreignCategoryId })),
    ).rejects.toThrow("category");
    await expect(addEntry(foreign, entry())).rejects.toThrow();
    await expect(
      saveBudget(foreign, {
        name: "Denied",
        amountMinor: 100,
        currency: "INR",
        periodStart: "2026-06-01",
        periodEnd: "2026-06-30",
        costCentreId: centreId,
      }),
    ).rejects.toThrow();
    const b = await saveBill(owner, bill());
    await expect(
      payBill(foreign, {
        billId: b,
        paymentKey: randomUUID(),
        amountMinor: 10,
        paidOn: "2026-06-10",
        reference: "NO",
      }),
    ).rejects.toThrow("unavailable");
  });
  it("validates date-only values and money through the action boundary", async () => {
    session.id = owner.user.id;
    const f = new FormData();
    Object.entries({
      kind: "EXPENSE",
      currency: "INR",
      amountMinor: "1.25",
      occurredOn: "2026-06-10",
      description: "Action entry",
      accountId,
    }).forEach(([k, v]) => f.set(k, v));
    const r = await financeToolAction(owner.workspace.slug, "entry", f);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (
          await prisma.ledgerEntry.findFirstOrThrow({
            where: { id: r.data!.id, workspaceId: owner.workspace.id },
          })
        ).amountMinor,
      ).toBe(125);
    f.set("occurredOn", "2026-02-30");
    expect((await financeToolAction(owner.workspace.slug, "entry", f)).ok).toBe(
      false,
    );
  });
  it("counts budget category actuals across unlinked entries, excluding voids and other currencies", async () => {
    const id = await saveBudget(owner, {
      name: "June office line",
      amountMinor: 100000,
      currency: "INR",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      categoryId,
      costCentreId: centreId,
      varianceNote: "Annual purchase",
    });
    const ledger = await addEntry(owner, entry());
    await prisma.ledgerEntry.create({
      data: {
        workspaceId: owner.workspace.id,
        kind: "EXPENSE",
        currency: "USD",
        amountMinor: 99999,
        description: "Other currency",
        categoryId,
        costCentreId: centreId,
        occurredOn: dateOnly("2026-06-10"),
      },
    });
    const b = await prisma.budget.findFirstOrThrow({
      where: { id, workspaceId: owner.workspace.id },
    });
    expect(await budgetActual(prisma, b)).toBe(10000);
    await prisma.ledgerEntry.updateMany({
      where: { id: ledger, workspaceId: owner.workspace.id },
      data: { voidedAt: new Date() },
    });
    expect(await budgetActual(prisma, b)).toBe(0);
  });
  it("records partial bill payments and posts one expense per payment under retries", async () => {
    const id = await saveBill(owner, bill());
    const v = {
      billId: id,
      paymentKey: randomUUID(),
      amountMinor: 10000,
      paidOn: "2026-06-10",
      reference: "UTR-10",
    };
    const results = await Promise.all([payBill(owner, v), payBill(admin, v)]);
    expect(results[0]).toBe(results[1]);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: "finance_bill_payment",
          sourceId: results[0],
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).paidMinor,
    ).toBe(10000);
    await expect(payBill(owner, { ...v, amountMinor: 10001 })).rejects.toThrow(
      "already used",
    );
    await expect(
      payBill(owner, { ...v, paymentKey: randomUUID(), amountMinor: 20001 }),
    ).rejects.toThrow("exceeds");
    await payBill(owner, {
      ...v,
      paymentKey: randomUUID(),
      amountMinor: 20000,
      post: false,
    });
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).paidMinor,
    ).toBe(30000);
  });
  it("uploads multiple private files and protects staged ownership", async () => {
    const uploaded = await uploadFinanceFiles(owner, "STAGED", owner.user.id, [
      receipt(),
      receipt(),
    ]);
    expect(uploaded).toHaveLength(2);
    expect(
      await findDownloadableFile(uploaded[0]!.id, admin.user.id),
    ).toBeNull();
    await expect(
      prisma.$transaction((tx) =>
        claimStagedFiles(tx, admin, [uploaded[0]!.id], "LEDGER", "fake"),
      ),
    ).rejects.toThrow("newly uploaded");
    const id = await addEntry(
      owner,
      entry({ fileIds: uploaded.map((f) => f.id) }),
    );
    expect(
      await findDownloadableFile(uploaded[0]!.id, member.user.id),
    ).not.toBeNull();
    expect(
      await findDownloadableFile(uploaded[0]!.id, guest.user.id),
    ).toBeNull();
    expect(
      await prisma.fileObject.count({
        where: {
          id: { in: uploaded.map((f) => f.id) },
          ...(await libraryWhere({
            workspace: owner.workspace,
            user: owner.user,
            membership: owner.membership,
          })),
        },
      }),
    ).toBe(0);
    expect(
      (await financeReports(owner, { month: "2026-06" })).entries.find(
        (e) => e.id === id,
      )?.receipts,
    ).toHaveLength(2);
  });
  it("isolates staged form ids and expires only unclaimed proof", async () => {
    const stage = randomUUID();
    const [pending] = await uploadFinanceFiles(owner, "STAGED", stage, [
      receipt(),
    ]);
    expect(await findDownloadableFile(pending!.id, admin.user.id)).toBeNull();
    await expect(
      removeFinanceFile(admin, pending!.attachmentId),
    ).rejects.toThrow("unavailable");
    const [committed] = await uploadFinanceFiles(
      owner,
      "STAGED",
      randomUUID(),
      [receipt()],
    );
    await addEntry(owner, entry({ fileIds: [committed!.id] }));
    await prisma.financeAttachment.updateMany({
      where: {
        workspaceId: owner.workspace.id,
        fileId: { in: [pending!.id, committed!.id] },
      },
      data: { createdAt: new Date(Date.now() - 2 * 86400000) },
    });
    await prisma.$transaction((tx) =>
      purgeExpiredStagedFiles(tx, owner.workspace.id, new Date()),
    );
    expect(
      await prisma.fileObject.count({
        where: { workspaceId: owner.workspace.id, id: pending!.id },
      }),
    ).toBe(0);
    expect(
      await prisma.fileObject.count({
        where: { workspaceId: owner.workspace.id, id: committed!.id },
      }),
    ).toBe(1);
  });
  it("keeps extraction optional, uses the configured model, and never posts unconfirmed entries", async () => {
    const [file] = await uploadFinanceFiles(owner, "STAGED", owner.user.id, [
      receipt(),
    ]);
    const before = await prisma.ledgerEntry.count({
      where: { workspaceId: owner.workspace.id },
    });
    ai.configured = false;
    expect(await extractReceipt(owner, file!.id)).toEqual({
      configured: false,
    });
    expect(ai.called).toBe(0);
    ai.configured = true;
    expect(await extractReceipt(owner, file!.id)).toMatchObject({
      configured: true,
      fields: { vendor: "Receipt supplier", total: "118" },
    });
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    const id = await addEntry(owner, entry({ fileIds: [file!.id] }));
    expect(
      (
        await prisma.ledgerEntry.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).extractionUsed,
    ).toBe(true);
  });
  it("inherits bill proof in spending reports and escapes accountant CSV cells", async () => {
    const id = await saveBill(owner, bill({ vendor: "=SUM(1,2)" }));
    const [file] = await uploadFinanceFiles(owner, "BILL", id, [receipt()]);
    const payment = await payBill(owner, {
      billId: id,
      paymentKey: randomUUID(),
      amountMinor: 10000,
      paidOn: "2026-06-11",
      reference: "UTR-11",
    });
    const data = await spendingReview(owner, { month: "2026-06" });
    const row = data.entries.find((e) => e.sourceId === payment)!;
    expect(row.receipts.map((r) => r.id)).toContain(file!.id);
    expect(data.missingReceipts.some((e) => e.id === row.id)).toBe(false);
    expect(await financeCsv(owner, "bills", { month: "2026-06" })).toContain(
      "'=SUM(1,2)",
    );
  });
  it("indexes finance records privately and applies live finance permissions in search", async () => {
    const id = await saveFund(owner, {
      name: `UniqueFinance${suffix}`,
      currency: "INR",
    });
    const doc = await prisma.searchDocument.findFirstOrThrow({
      where: { entityId: id, workspaceId: owner.workspace.id },
    });
    expect(doc.visibility).toBe("PRIVATE");
    const hits = await searchDocuments(
      { workspaceId: owner.workspace.id, userId: owner.user.id, role: "OWNER" },
      `UniqueFinance${suffix}`,
    );
    expect(hits.some((h) => h.entityId === id)).toBe(true);
    expect(
      await searchDocuments(
        {
          workspaceId: foreign.workspace.id,
          userId: foreign.user.id,
          role: "OWNER",
        },
        `UniqueFinance${suffix}`,
      ),
    ).toEqual([]);
  });
  it("emits overdue bills once per day and budget thresholds at 80 and 100 percent", async () => {
    const b = await saveBill(owner, bill({ ownerId: admin.user.id }));
    const budget = await saveBudget(owner, {
      name: "Budget alert",
      amountMinor: 100,
      currency: "INR",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      categoryId,
    });
    await addEntry(owner, entry({ amountMinor: 100 }));
    await reminders(new Date("2026-06-15T10:00:00Z"));
    await reminders(new Date("2026-06-15T10:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "finance.bill.overdue",
          payload: { path: ["data", "billId"], equals: b },
        },
      }),
    ).toBe(1);
    await opsReminders(new Date("2026-06-15T10:00:00Z"));
    await opsReminders(new Date("2026-06-15T10:00:00Z"));
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "budget.threshold",
          payload: { path: ["data", "budgetId"], equals: budget },
        },
      }),
    ).toBe(2);
  });
});

describe.sequential("payroll privacy and manual approvals", () => {
  it("denies owners and admins until explicitly granted, and only owners may grant", async () => {
    await expect(payrollData(owner, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await expect(payrollData(admin, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await expect(
      grantPayroll(admin, { userId: admin.user.id, access: "MANAGE" }),
    ).rejects.toThrow("access");
    await grantPayroll(owner, { userId: owner.user.id, access: "MANAGE" });
    await grantPayroll(owner, { userId: admin.user.id, access: "MANAGE" });
  });
  it("encrypts PAN and bank references, audits reveals and rejects full bank account numbers", async () => {
    await expect(
      savePayProfile(owner, {
        name: "Denied",
        kind: "STAFF",
        rateMinor: 100,
        rateBasis: "MONTH",
        currency: "INR",
        bankLast4: "123456789",
      }),
    ).rejects.toThrow();
    const id = await savePayProfile(owner, {
      name: "Asha test",
      kind: "STAFF",
      rateMinor: 100000,
      rateBasis: "MONTH",
      currency: "INR",
      pan: "ABCDE1234F",
      bankLast4: "1234",
      ifsc: "SBIN0001234",
    });
    const row = await prisma.financePayProfile.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    expect(row.panEnc).not.toContain("ABCDE1234F");
    expect(row.bankEnc).not.toContain("1234");
    expect(await revealPayDetails(owner, id)).toMatchObject({
      pan: "ABCDE1234F",
      bank: { last4: "1234" },
    });
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          targetId: id,
          action: "finance.payroll_viewed",
        },
      }),
    ).toBe(1);
    await expect(revealPayDetails(member, id)).rejects.toThrow("access");
    await expect(revealPayDetails(foreign, id)).rejects.toThrow("access");
    payRunId = await savePayRun(owner, {
      profileId: id,
      month: "2026-06",
      grossMinor: 100000,
      allowancesMinor: 10000,
      pfMinor: 1000,
      esiMinor: 500,
      ptMinor: 200,
      tdsMinor: 5000,
      advancesMinor: 10000,
      otherMinor: 300,
      accountId,
      categoryId,
      costCentreId: centreId,
    });
  });
  it("requires a distinct approver and posts a paid run to the ledger once", async () => {
    await expect(
      transitionPayRun(owner, { runId: payRunId, transition: "APPROVE" }),
    ).rejects.toThrow("another payroll manager");
    await transitionPayRun(admin, { runId: payRunId, transition: "APPROVE" });
    await expect(
      savePayRun(owner, {
        id: payRunId,
        profileId: "bad",
        month: "2026-06",
        grossMinor: 1,
      }),
    ).rejects.toThrow();
    await transitionPayRun(owner, {
      runId: payRunId,
      transition: "PAY",
      paidOn: "2026-06-20",
      reference: "UTR-PAY",
    });
    await Promise.all([
      transitionPayRun(owner, { runId: payRunId, transition: "POST" }),
      transitionPayRun(admin, { runId: payRunId, transition: "POST" }),
    ]);
    const rows = await prisma.ledgerEntry.findMany({
      where: {
        workspaceId: owner.workspace.id,
        sourceType: "finance_payroll",
        sourceId: payRunId,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amountMinor: 93000,
      privatePayroll: true,
      costCentreId: centreId,
    });
    expect(await getLedgerEntry(owner.workspace.id, rows[0]!.id)).toBeNull();
    expect(
      await prisma.ledgerEntry.count({
        where: ledgerWhere(owner.workspace.id, {
          q: "",
          kind: null,
          categoryId: null,
          from: null,
          to: null,
          includeVoided: false,
        }),
      }),
    ).toBeGreaterThan(0);
  });
  it("lets payroll managers correct coding without changing pay amounts", async () => {
    const centre = await saveCentre(owner, {
      name: "Staff support programme",
      kind: "PROGRAMME",
    });
    await expect(
      savePayBookkeeping(member, {
        runId: payRunId,
        costCentreId: centre,
        accountId,
      }),
    ).rejects.toThrow("access");
    await savePayBookkeeping(owner, {
      runId: payRunId,
      costCentreId: centre,
      accountId,
      categoryId,
      purpose: "Monthly staff payment",
    });
    const run = await prisma.financePayRun.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: payRunId },
    });
    const ledger = await prisma.ledgerEntry.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: run.ledgerEntryId! },
    });
    expect(run).toMatchObject({
      grossMinor: 100000,
      netMinor: 93000,
      costCentreId: centre,
    });
    expect(ledger).toMatchObject({
      amountMinor: 93000,
      privatePayroll: true,
      costCentreId: centre,
      purpose: "Monthly staff payment",
    });
  });
  it("audits each record view and keeps salary, PAN, bank and private files out of ordinary exports and search", async () => {
    const before = await prisma.auditEvent.count({
      where: {
        workspaceId: owner.workspace.id,
        action: "finance.payroll_viewed",
      },
    });
    const data = await payrollData(admin, { month: "2026-06" });
    expect(data.runs).toHaveLength(1);
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          action: "finance.payroll_viewed",
        },
      }),
    ).toBe(before + data.profiles.length + data.runs.length);
    const exportData = await buildWorkspaceExport(owner.workspace.id);
    expect(
      (
        exportData as { entities: Record<string, Array<{ id?: string }>> }
      ).entities.LedgerEntry?.some((e) => e.id === data.runs[0]?.ledgerEntryId),
    ).toBe(false);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: owner.workspace.id,
          entityId: { in: [payRunId, ...data.profiles.map((p) => p.id)] },
        },
      }),
    ).toBe(0);
    expect(
      (await financeReports(owner, { month: "2026-06" })).entries.some(
        (e) => e.privatePayroll,
      ),
    ).toBe(false);
  });
  it("stores generated payslips privately and checks grants on every download", async () => {
    const fileId = await generatePayslip(owner, payRunId);
    expect(await generatePayslip(owner, payRunId)).toBe(fileId);
    expect(await findDownloadableFile(fileId, member.user.id)).toBeNull();
    expect(await findDownloadableFile(fileId, admin.user.id)).not.toBeNull();
    const file = await prisma.fileObject.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id: fileId },
    });
    expect(
      Buffer.from((await getObject(file.storageKey))!.body)
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await grantPayroll(owner, { userId: admin.user.id, access: "NONE" });
    expect(await findDownloadableFile(fileId, admin.user.id)).toBeNull();
    await grantPayroll(owner, { userId: admin.user.id, access: "MANAGE" });
  }, 60000);
  it("permits payroll-only members with explicit grants and denies suspended grantees", async () => {
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { financeVisibleToMembers: false },
    });
    await grantPayroll(owner, { userId: member.user.id, access: "VIEW" });
    expect((await payrollData(member, { month: "2026-06" })).runs).toHaveLength(
      1,
    );
    await expect(
      savePayProfile(member, {
        name: "No",
        kind: "STAFF",
        rateMinor: 1,
        rateBasis: "MONTH",
        currency: "INR",
      }),
    ).rejects.toThrow("access");
    await expect(financeAccess(member)).rejects.toThrow("access");
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(payrollData(member, { month: "2026-06" })).rejects.toThrow(
      "access",
    );
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
  });
});

describe.sequential("disbursements, month-end and export routes", () => {
  it("uses existing approvals and tracks advance settlement without a second expense", async () => {
    const id = await saveDisbursement(owner, {
      payee: "Programme volunteer",
      purpose: "Travel advance",
      kind: "ADVANCE",
      amountMinor: 10000,
      currency: "INR",
      accountId,
      categoryId,
      costCentreId: centreId,
    });
    await expect(
      transitionDisbursement(owner, {
        id,
        transition: "PAY",
        paidOn: "2026-06-21",
        reference: "UTR-ADV",
      }),
    ).rejects.toThrow("Approve");
    await transitionDisbursement(owner, { id, transition: "REQUEST_APPROVAL" });
    const row = await prisma.financeDisbursement.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    expect(
      (
        await decide(admin, {
          requestId: row.approvalId!,
          decision: "APPROVED",
        })
      ).ok,
    ).toBe(true);
    await transitionDisbursement(owner, {
      id,
      transition: "PAY",
      paidOn: "2026-06-21",
      reference: "UTR-ADV",
    });
    await expect(
      transitionDisbursement(owner, {
        id,
        transition: "SETTLE",
        paidOn: "2026-06-25",
        settledMinor: 10000,
      }),
    ).rejects.toThrow("proof");
    await uploadFinanceFiles(owner, "DISBURSEMENT", id, [receipt()]);
    await transitionDisbursement(owner, {
      id,
      transition: "SETTLE",
      paidOn: "2026-06-25",
      settledMinor: 10000,
    });
    expect(
      (
        await prisma.financeDisbursement.findFirstOrThrow({
          where: { workspaceId: owner.workspace.id, id },
        })
      ).settledMinor,
    ).toBe(10000);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: owner.workspace.id,
          sourceType: "finance_disbursement",
          sourceId: id,
        },
      }),
    ).toBe(1);
  });
  it("compares manual statements, requires reconciliation marks and locks signed periods", async () => {
    const account = await addAccount(owner, {
      name: "May cash",
      currency: "INR",
      openingMinor: 10000,
      openingOn: "2026-05-01",
    });
    const e = await addEntry(
      owner,
      entry({
        accountId: account,
        occurredOn: "2026-05-10",
        amountMinor: 2500,
      }),
    );
    expect(
      (
        await accountBalance(
          prisma,
          owner.workspace.id,
          account,
          dateOnly("2026-05-31"),
        )
      ).balanceMinor,
    ).toBe(7500);
    await expect(
      reconcileAccount(owner, {
        accountId: account,
        upTo: "2026-05-31",
        statementMinor: 8000,
        signOff: true,
      }),
    ).rejects.toThrow("differ");
    await expect(
      reconcileAccount(owner, {
        accountId: account,
        upTo: "2026-05-31",
        statementMinor: 7500,
        signOff: true,
      }),
    ).rejects.toThrow("every entry");
    await markReconciled(owner, { entryId: e, reconciled: true });
    await reconcileAccount(owner, {
      accountId: account,
      upTo: "2026-05-31",
      statementMinor: 7500,
      signOff: true,
    });
    await expect(
      saveEntryTags(owner, {
        entryId: e,
        accountId: account,
        incomeSource: "OTHER",
      }),
    ).rejects.toThrow("reconciled");
  });
  it("signs a complete month, prevents old and new ledger edits, and can reopen it", async () => {
    const month = await startMonth(owner, { month: "2025-12" });
    await expect(closeMonth(owner, { month: "2025-12" })).rejects.toThrow(
      "Complete",
    );
    const steps = await prisma.financeMonthStep.findMany({
      where: { workspaceId: owner.workspace.id, monthId: month },
    });
    for (const step of steps)
      await saveStep(owner, {
        id: step.id,
        month: "2025-12",
        title: step.title,
        done: true,
      });
    await reviewSpending(owner, { month: "2025-12", notes: "No transactions" });
    await closeMonth(owner, { month: "2025-12" });
    await expect(
      addEntry(owner, entry({ occurredOn: "2025-12-05", accountId: null })),
    ).rejects.toThrow("signed off");
    const old = await createLedgerEntry(
      owner,
      ledgerEntrySchema.parse({
        kind: "EXPENSE",
        amount: "1",
        occurredOn: "2025-12-05",
        description: "Should fail",
      }),
      null,
    );
    expect(old.ok).toBe(false);
    await closeMonth(owner, { month: "2025-12", reopen: true });
    expect(
      await addEntry(
        owner,
        entry({ occurredOn: "2025-12-05", accountId: null }),
      ),
    ).toBeTruthy();
  });
  it("stores report PDFs and links them to the month", async () => {
    const id = await generateReportPdf(owner, { month: "2026-06" });
    const row = await prisma.financeAttachment.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, fileId: id },
    });
    expect(row.recordType).toBe("MONTH");
    expect(await findDownloadableFile(id, guest.user.id)).toBeNull();
    expect(await findDownloadableFile(id, owner.user.id)).not.toBeNull();
  }, 60000);
  it.each([
    ["", 404],
    ["guest", 404],
    ["member", 404],
    ["owner", 200],
  ])("CSV export checks %s access", async (role, status) => {
    session.id =
      role === "owner"
        ? owner.user.id
        : role === "member"
          ? member.user.id
          : role === "guest"
            ? guest.user.id
            : "";
    const response = await csvRoute(
      new Request(
        `http://localhost/w/${owner.workspace.slug}/finance/export/entries?month=2026-06`,
      ),
      {
        params: Promise.resolve({
          workspaceSlug: owner.workspace.slug,
          kind: "entries",
        }),
      },
    );
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
