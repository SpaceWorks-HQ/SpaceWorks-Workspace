import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
import { prisma } from "@/lib/db";
import { type ControlsActor, controlRecord } from "@/lib/moneyControls/access";
import {
  saveControl,
  transitionControl,
  markControlMovement,
} from "@/lib/moneyControls/service";
import {
  uploadControlFiles,
  removeControlFile,
} from "@/lib/moneyControls/files";
import {
  listControls,
  controlsSummary,
  loadControlsView,
} from "@/lib/moneyControls/queries";
import { fundAssessment } from "@/lib/moneyControls/funds";
import {
  addEntry,
  saveBill,
  payBill,
  saveEntryTags,
} from "@/lib/finance/tools/service";
import { saveDisbursement } from "@/lib/finance/tools/disbursements";
import {
  savePayProfile,
  savePayRun,
  grantPayroll,
} from "@/lib/finance/tools/payroll";
import { accountBalance, reconcileAccount } from "@/lib/finance/tools/close";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { reportEntries } from "@/lib/finance/tools/queries";
import { searchDocuments, canAccessResource } from "@/lib/search/query";
import { run } from "@/lib/scheduled/moneyControls";
import { decide } from "@/lib/approvals/engine";
import { offboardingSources } from "@/lib/people/onboarding";
import { saveMoneyControlAction } from "@/app/actions/money-controls";
import { GET as exportRoute } from "@/app/w/[workspaceSlug]/money-controls/export/[section]/route";
import { getObject, deleteObjects } from "@/lib/storage";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
const suffix = uniqueSuffix(),
  emailSuffix = `@mc-${suffix}.test`,
  slugs = [`mc-${suffix}`, `mc-other-${suffix}`];
let actor: ControlsActor,
  admin: ControlsActor,
  member: ControlsActor,
  guest: ControlsActor,
  other: ControlsActor,
  cash: string,
  bank: string,
  category: string,
  foreignAccount: string,
  asset: string;
const on = "2026-06-10",
  date = new Date(on),
  keys: string[] = [];
const save = (kind: string, extra: Record<string, unknown> = {}, as = actor) =>
  saveControl(as, {
    kind,
    title: `Office ${kind} ${randomUUID()}`,
    currency: "INR",
    occurredOn: on,
    details: {},
    ...extra,
  });
const transition = (
  id: string,
  operation = "POST",
  extra: Record<string, unknown> = {},
  as = actor,
) =>
  transitionControl(as, {
    id,
    operation,
    occurredOn: on,
    reference: "Manual reference",
    operationKey: randomUUID(),
    ...extra,
  });
async function attach(id: string, as = actor) {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const body = await pdf.save();
  const out = await uploadControlFiles(as, id, [
    new File([Buffer.from(body)], "office-proof.pdf", {
      type: "application/pdf",
    }),
  ]);
  for (const f of out) {
    const row = await prisma.fileObject.findUniqueOrThrow({
      where: { id: f.id },
    });
    keys.push(row.storageKey);
  }
  return out[0];
}
async function fund(name: string, budget = 10000, details = {}) {
  const f = await prisma.financeFund.create({
    data: {
      workspaceId: actor.workspace.id,
      name: `${name}-${randomUUID()}`,
      currency: "INR",
      restricted: true,
    },
  });
  await save("FUND_RULE", {
    fundId: f.id,
    amountMinor: budget,
    occurredOn: "2026-04-01",
    endsOn: "2027-03-31",
    details: {
      allowedCategoryIds: [category],
      eligibilityMode: "BLOCK",
      budgetMode: "BLOCK",
      duplicateMode: "BLOCK",
      ...details,
    },
  });
  return f.id;
}
const expense = (fundId: string, amountMinor: number, extra = {}) => ({
  kind: "EXPENSE",
  description: "Programme supplies",
  currency: "INR",
  occurredOn: on,
  amountMinor,
  fundId,
  categoryId: category,
  incomeSource: "OTHER",
  ...extra,
});
beforeAll(async () => {
  const owner = await createUser(`owner${emailSuffix}`),
    a = await createUser(`admin${emailSuffix}`),
    m = await createUser(`member${emailSuffix}`),
    g = await createUser(`guest${emailSuffix}`),
    o = await createUser(`other${emailSuffix}`);
  const ws = await createWorkspace(slugs[0], owner.id),
    foreign = await createWorkspace(slugs[1], o.id);
  await addMember(ws.id, a.id, "ADMIN");
  await addMember(ws.id, m.id);
  await addMember(ws.id, g.id, "GUEST");
  const ctx = (
    user: typeof owner,
    role: "OWNER" | "ADMIN" | "MEMBER" | "GUEST",
    workspace = ws,
  ): ControlsActor => ({ user, workspace, membership: { role } });
  actor = ctx(owner, "OWNER");
  admin = ctx(a, "ADMIN");
  member = ctx(m, "MEMBER");
  guest = ctx(g, "GUEST");
  other = ctx(o, "OWNER", foreign);
  cash = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Cash tin",
        openingOn: new Date("2026-04-01"),
        openingMinor: 500000,
        currency: "INR",
      },
    })
  ).id;
  bank = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Operating bank",
        openingOn: new Date("2026-04-01"),
        openingMinor: 5000000,
        currency: "INR",
      },
    })
  ).id;
  foreignAccount = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: foreign.id,
        name: "Private account",
        openingOn: new Date("2026-04-01"),
        openingMinor: 100,
        currency: "INR",
      },
    })
  ).id;
  category = (
    await prisma.financeCategory.create({
      data: { workspaceId: ws.id, name: "Office supplies", kind: "EXPENSE" },
    })
  ).id;
  asset = (
    await prisma.asset.create({
      data: {
        workspaceId: ws.id,
        name: "Office laptop",
        category: "IT",
        tag: `it-${suffix}`,
      },
    })
  ).id;
  await save("FLOAT", {
    accountId: cash,
    ownerId: actor.user.id,
    amountMinor: 500000,
  });
});
afterAll(async () => {
  await deleteObjects(keys);
  await cleanup(slugs, emailSuffix);
});
describe("internal money controls", () => {
  it("rechecks membership and rejects role forgery, guests and foreign references", async () => {
    await expect(
      save(
        "TRANSFER",
        {
          accountId: cash,
          otherAccountId: bank,
          amountMinor: 10,
          details: { reference: "x" },
        },
        { ...member, membership: { role: "OWNER" } },
      ),
    ).rejects.toThrow();
    await expect(
      save(
        "COUNT",
        { accountId: cash, details: { denominations: "500=1" } },
        guest,
      ),
    ).rejects.toThrow();
    await expect(
      save("TRANSFER", {
        accountId: cash,
        otherAccountId: foreignAccount,
        amountMinor: 10,
        details: { reference: "x" },
      }),
    ).rejects.toThrow();
    await expect(listControls(guest, { section: "cash" })).rejects.toThrow();
  });
  it("numbers vouchers concurrently and posts proof-backed expenses once", async () => {
    const ids = await Promise.all([
      save("VOUCHER", {
        accountId: cash,
        amountMinor: 10000,
        categoryId: category,
        details: { payee: "Office supplier" },
      }),
      save("VOUCHER", {
        accountId: cash,
        amountMinor: 20000,
        categoryId: category,
        details: { payee: "Office supplier" },
      }),
    ]);
    const rows = await prisma.moneyControlRecord.findMany({
      where: { workspaceId: actor.workspace.id, id: { in: ids } },
    });
    expect(new Set(rows.map((r) => r.number)).size).toBe(2);
    await expect(transition(ids[0])).rejects.toThrow(/proof/);
    await attach(ids[0]);
    const operationKey = randomUUID(),
      input = { operationKey };
    await Promise.all([
      transition(ids[0], "POST", input),
      transition(ids[0], "POST", input),
    ]);
    expect(
      await prisma.ledgerEntry.count({
        where: {
          workspaceId: actor.workspace.id,
          sourceType: "cash_voucher",
          sourceId: ids[0],
        },
      }),
    ).toBe(1);
    await expect(
      transition(ids[0], "POST", { operationKey, reference: "Changed" }),
    ).rejects.toThrow(/different details/);
    const report = await reportEntries(actor, { from: on, to: on });
    expect(
      report.entries.find((e) => e.sourceId === ids[0])?.receipts,
    ).toHaveLength(1);
  });
  it("keeps transfers and deposits outside income and expenses, and returns deposits partially", async () => {
    const count = await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
      before = await accountBalance(prisma, actor.workspace.id, cash, date);
    const transferId = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: cash,
      amountMinor: 30000,
      details: { reference: "Transfer" },
    });
    await attach(transferId);
    await transition(transferId);
    const deposit = await save("DEPOSIT", {
      accountId: cash,
      amountMinor: 10000,
      details: { direction: "GIVEN", counterparty: "Venue" },
    });
    await attach(deposit);
    await transition(deposit);
    const returnKey = randomUUID();
    await Promise.all([
      transition(deposit, "RETURN", {
        amountMinor: 4000,
        operationKey: returnKey,
      }),
      transition(deposit, "RETURN", {
        amountMinor: 4000,
        operationKey: returnKey,
      }),
    ]);
    await expect(
      transition(deposit, "RETURN", { amountMinor: 7000 }),
    ).rejects.toThrow(/outstanding/);
    expect((await controlRecord(actor, deposit)).status).toBe(
      "PARTLY_RETURNED",
    );
    expect(
      (await accountBalance(prisma, actor.workspace.id, cash, date))
        .balanceMinor,
    ).toBe(before.balanceMinor + 24000);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: actor.workspace.id },
      }),
    ).toBe(count);
  });
  it("requires movement reconciliation and rejects changes to signed account ranges", async () => {
    const isolated = (
      await prisma.financeAccount.create({
        data: {
          workspaceId: actor.workspace.id,
          name: "Reconciliation account",
          currency: "INR",
          openingMinor: 0,
          openingOn: new Date("2026-04-01"),
        },
      })
    ).id;
    const t = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: isolated,
      amountMinor: 100,
      details: { reference: "Reconcile" },
    });
    await attach(t);
    await transition(t);
    await expect(
      reconcileAccount(actor, {
        accountId: isolated,
        upTo: on,
        statementMinor: 100,
        signOff: true,
      }),
    ).rejects.toThrow(/movements reconciled/);
    const movement = await prisma.moneyControlMovement.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        recordId: t,
        accountId: isolated,
      },
    });
    await markControlMovement(actor, movement.id);
    await reconcileAccount(actor, {
      accountId: isolated,
      upTo: on,
      statementMinor: 100,
      signOff: true,
    });
    const next = await save("TRANSFER", {
      accountId: bank,
      otherAccountId: isolated,
      amountMinor: 100,
      details: { reference: "Backdated" },
    });
    await attach(next);
    await expect(transition(next)).rejects.toThrow(/reconciled/);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: actor.workspace.id, recordId: next },
      }),
    ).toBe(0);
  });
  it("requires cash-count difference explanations and freezes the counted facts", async () => {
    const id = await save("COUNT", {
      accountId: cash,
      details: { denominations: "500=1" },
    });
    await expect(transition(id)).rejects.toThrow(/difference/);
    await save("COUNT", {
      id,
      accountId: cash,
      details: { denominations: "500=1" },
      notes: "Cash was recounted; accountant review pending.",
    });
    await transition(id);
    const r = await controlRecord(actor, id);
    expect(r.amountMinor).toBe(50000);
    expect((r.details as { differenceMinor: number }).differenceMinor).not.toBe(
      0,
    );
    await expect(
      save("COUNT", {
        id,
        accountId: cash,
        details: { denominations: "500=2" },
      }),
    ).rejects.toThrow(/confirmed/);
  });
  it("uses the existing approvals engine before replenishing cash", async () => {
    const id = await save("REPLENISHMENT", {
      accountId: cash,
      otherAccountId: bank,
      amountMinor: 20000,
      details: { reference: "Top-up" },
    });
    await attach(id);
    await transition(id, "REQUEST");
    await expect(transition(id)).rejects.toThrow(/Approve/);
    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        subjectType: "CUSTOM",
        subjectId: id,
      },
    });
    const review = await decide(admin, {
      requestId: approval.id,
      decision: "APPROVED",
    });
    expect(review.ok).toBe(true);
    await transition(id);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: actor.workspace.id, recordId: id },
      }),
    ).toBe(2);
  });
  it("requires both custodians to sign and scopes personal handovers", async () => {
    const id = await save("HANDOVER", {
      accountId: cash,
      ownerId: member.user.id,
      amountMinor: 1000,
    });
    await expect(transition(id, "SIGN_IN", {}, member)).rejects.toThrow();
    await expect(controlRecord(other, id)).rejects.toThrow();
    await transition(id, "SIGN_OUT", {
      notes: "Difference explained in the cash count.",
    });
    await transition(id, "SIGN_IN", {}, member);
    expect(
      (
        await prisma.moneyControlRecord.findFirstOrThrow({
          where: {
            workspaceId: actor.workspace.id,
            kind: "FLOAT",
            accountId: cash,
          },
        })
      ).ownerId,
    ).toBe(member.user.id);
    expect(
      (await listControls(member, { section: "cash" })).rows.every(
        (r) => r.kind === "HANDOVER",
      ),
    ).toBe(true);
  });
  it("retains private evidence, prevents library mutation and rechecks current rights", async () => {
    const id = await save("DEPOSIT", {
        accountId: bank,
        amountMinor: 1000,
        details: {
          direction: "RECEIVED",
          counterparty: "Internal lease partner",
        },
      }),
      f = await attach(id);
    expect(await findDownloadableFile(f.id, member.user.id)).toBeNull();
    expect(await findDownloadableFile(f.id, actor.user.id)).not.toBeNull();
    expect(
      await prisma.fileObject.count({
        where: { AND: [await libraryWhere(actor), { id: f.id }] },
      }),
    ).toBe(0);
    expect(await getObject(keys.at(-1)!)).not.toBeNull();
    await transition(id);
    await expect(removeControlFile(actor, f.id)).rejects.toThrow(/retained/);
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: actor.workspace.id,
          userId: admin.user.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    expect(await findDownloadableFile(f.id, admin.user.id)).toBeNull();
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: actor.workspace.id,
          userId: admin.user.id,
        },
      },
      data: { status: "ACTIVE" },
    });
  });
  it("tracks asset issue, acknowledgement, offboarding and return before disposal", async () => {
    const id = await save("ASSIGNMENT", {
      assetId: asset,
      ownerId: member.user.id,
      details: { condition: "Good" },
    });
    await transition(id);
    await transition(id, "ACKNOWLEDGE", {}, member);
    const sources = await prisma.$transaction((tx) =>
      offboardingSources(tx, actor.workspace.id, member.user.id),
    );
    expect(sources.assetsOwned.some((a) => a.id === asset)).toBe(true);
    const disposal = await save("DISPOSAL", {
      assetId: asset,
      amountMinor: 0,
      details: { method: "DONATION", counterparty: "Partner NGO" },
    });
    await attach(disposal);
    await expect(transition(disposal)).rejects.toThrow(/Return assigned/);
    await transition(id, "RETURN", { notes: "Good; charger received." });
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: asset } }))
        .ownerUserId,
    ).toBeNull();
    await transition(disposal);
    expect(
      (await prisma.asset.findUniqueOrThrow({ where: { id: asset } })).status,
    ).toBe("RETIRED");
  });
  it("snapshots depreciation policy and records verification evidence", async () => {
    const equipment = (
      await prisma.asset.create({
        data: {
          workspaceId: actor.workspace.id,
          name: "Office projector",
          category: "Equipment",
          tag: `projector-${suffix}`,
        },
      })
    ).id;
    const cat = await save("ASSET_CATEGORY", {
      details: {
        method: "SLM",
        lifeYears: 5,
        rateBps: 2000,
        residualMinor: 0,
        taxBlockNote: "Reviewed book policy",
      },
    });
    const id = await save("SCHEDULE", {
      assetId: equipment,
      amountMinor: 100000,
      occurredOn: "2026-04-01",
      details: { categoryRecordId: cat, fundingSource: "Unrestricted kitty" },
    });
    await attach(id);
    await transition(id);
    await save("ASSET_CATEGORY", {
      id: cat,
      details: { method: "WDV", lifeYears: 3, rateBps: 4000, residualMinor: 0 },
    });
    const summary = await controlsSummary(actor, "assets", 2026);
    expect(summary.schedules.find((s) => s.id === id)?.depreciationMinor).toBe(
      20000,
    );
    const verify = await save("VERIFICATION", {
      assetId: equipment,
      details: { condition: "Good" },
    });
    await attach(verify);
    await transition(verify);
    expect((await controlRecord(actor, verify)).status).toBe("RECORDED");
  });
  it("matches official certificates and retains filing acceptance history", async () => {
    const details = {
      payee: "Office landlord",
      section: "194-I",
      fiscalYear: 2026,
      quarter: "Q1",
      grossMinor: 100000,
    };
    const deduction = await save("TDS_DEDUCTION", {
      amountMinor: 10000,
      details,
    });
    await transition(deduction);
    await expect(
      save("CERTIFICATE", {
        parentId: deduction,
        amountMinor: 10000,
        details: {
          ...details,
          payee: "Wrong payee",
          direction: "ISSUED",
          form: "16A",
          certificateNumber: "MC-1",
        },
      }),
    ).rejects.toThrow(/Match/);
    const cert = await save("CERTIFICATE", {
      parentId: deduction,
      amountMinor: 10000,
      details: {
        ...details,
        direction: "ISSUED",
        form: "16A",
        certificateNumber: "MC-1",
      },
    });
    await expect(transition(cert)).rejects.toThrow(/PDF/);
    await attach(cert);
    await transition(cert);
    const filing = await save("FILING", {
      amountMinor: 10000,
      details: {
        fiscalYear: 2026,
        quarter: "Q1",
        form: "Quarterly withholding return",
      },
    });
    await transition(filing);
    await expect(transition(filing, "ACCEPTED")).rejects.toThrow(/order/);
    await attach(filing);
    for (const op of ["SUBMITTED", "ACCEPTED", "PAID"])
      await transition(filing, op, { reference: `${op}-ACK` });
    const history = await prisma.moneyControlEvent.findMany({
      where: {
        workspaceId: actor.workspace.id,
        recordId: filing,
        action: { in: ["SUBMITTED", "ACCEPTED", "PAID"] },
      },
    });
    expect(history).toHaveLength(3);
    expect((await controlRecord(actor, filing)).status).toBe("PAID");
  });
  it("requires explicit payroll access for salary certificates and revokes downloads", async () => {
    await expect(
      save("CERTIFICATE", {
        details: {
          payee: "Staff",
          fiscalYear: 2026,
          quarter: "ANNUAL",
          direction: "ISSUED",
          form: "16",
          certificateNumber: "Salary-1",
        },
      }),
    ).rejects.toThrow(/payroll grant/);
    await grantPayroll(actor, { userId: actor.user.id, access: "MANAGE" });
    const id = await save("CERTIFICATE", {
        details: {
          payee: "Staff",
          fiscalYear: 2026,
          quarter: "ANNUAL",
          direction: "ISSUED",
          form: "16",
          certificateNumber: "Salary-1",
        },
      }),
      f = await attach(id);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: actor.workspace.id,
          entityType: "money_control",
          entityId: id,
        },
      }),
    ).toBe(0);
    expect(await findDownloadableFile(f.id, admin.user.id)).toBeNull();
    await grantPayroll(actor, { userId: actor.user.id, access: "NONE" });
    expect(await findDownloadableFile(f.id, actor.user.id)).toBeNull();
  });
  it("checks fund categories and periods, including concurrent expense limits", async () => {
    const f = await fund("Concurrent", 10000);
    const outcomes = await Promise.allSettled([
      addEntry(actor, expense(f, 6000)),
      addEntry(actor, expense(f, 6000)),
    ]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    await expect(
      addEntry(actor, expense(f, 100, { occurredOn: "2027-04-01" })),
    ).rejects.toThrow(/period/);
    await expect(
      addEntry(actor, expense(f, 100, { categoryId: null })),
    ).rejects.toThrow(/categories/);
  });
  it("replaces bill reservations with payments and blocks duplicate expense references across funds", async () => {
    const f = await fund("Bill reserve", 20000),
      f2 = await fund("Second grant", 20000),
      number = `B-${suffix}`;
    const bill = await saveBill(actor, {
      vendor: "Supplier",
      number,
      issuedOn: on,
      dueOn: "2026-06-30",
      currency: "INR",
      amountMinor: 15000,
      fundId: f,
      categoryId: category,
    });
    await payBill(actor, {
      billId: bill,
      paymentKey: randomUUID(),
      amountMinor: 6000,
      paidOn: on,
      reference: "Part payment",
      post: true,
    });
    expect(
      (await fundAssessment(prisma, actor.workspace.id)).find(
        (x) => x.rule.fundId === f,
      )?.committedMinor,
    ).toBe(15000);
    await expect(
      addEntry(
        actor,
        expense(f2, 1000, { counterparty: "Supplier", invoiceNumber: number }),
      ),
    ).rejects.toThrow(/already charged/);
  });
  it("checks payroll and disbursement commitments and persists warnings", async () => {
    const f = await fund("Payroll restriction", 1000);
    await grantPayroll(actor, { userId: actor.user.id, access: "MANAGE" });
    const profile = await savePayProfile(actor, {
      name: "Payee",
      kind: "STAFF",
      currency: "INR",
      rateMinor: 2000,
      rateBasis: "MONTH",
    });
    await expect(
      savePayRun(actor, {
        profileId: profile,
        month: "2026-06",
        grossMinor: 2000,
        fundId: f,
        categoryId: category,
      }),
    ).rejects.toThrow(/budget/);
    await expect(
      saveDisbursement(actor, {
        payee: "Volunteer",
        purpose: "Office travel",
        kind: "ADVANCE",
        currency: "INR",
        amountMinor: 2000,
        fundId: f,
        categoryId: category,
        dueOn: on,
      }),
    ).rejects.toThrow(/budget/);
    const warned = await fund("Warn only", 1000, { budgetMode: "WARN" });
    await addEntry(actor, expense(warned, 2000));
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: actor.workspace.id,
          action: "moneycontrols.fund_warning",
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("checks retagging without trusting the client and preserves source privacy in search", async () => {
    const f = await fund("Retag", 10),
      entry = await addEntry(actor, { ...expense(f, 20), fundId: null });
    await expect(
      saveEntryTags(actor, {
        entryId: entry,
        fundId: f,
        categoryId: category,
        incomeSource: "OTHER",
      }),
    ).rejects.toThrow(/budget/);
    const id = await save("DEPOSIT", {
      title: `Private controls ${suffix}`,
      accountId: bank,
      amountMinor: 100,
      details: { direction: "GIVEN", counterparty: "Office" },
    });
    expect(
      await canAccessResource(
        {
          workspaceId: actor.workspace.id,
          userId: actor.user.id,
          role: "OWNER",
        },
        "money_control",
        id,
      ),
    ).toBe(true);
    expect(
      await searchDocuments(
        {
          workspaceId: actor.workspace.id,
          userId: member.user.id,
          role: "MEMBER",
        },
        `Private controls ${suffix}`,
      ),
    ).toHaveLength(0);
  });
  it("deduplicates generic reminders across replicas", async () => {
    const id = await save("FILING", {
      dueOn: on,
      ownerId: actor.user.id,
      details: { fiscalYear: 2026, quarter: "Q1", form: "Return" },
    });
    await Promise.all([run(date), run(date)]);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: actor.workspace.id,
          type: "moneycontrols.reminder",
          dedupeKey: { contains: id },
        },
      }),
    ).toBe(1);
  });
  it("guards actions and exports with current session and tenant permissions", async () => {
    const form = new FormData();
    form.set("kind", "FLOAT");
    session.id = guest.user.id;
    expect((await saveMoneyControlAction(actor.workspace.slug, form)).ok).toBe(
      false,
    );
    const context = {
      params: Promise.resolve({
        workspaceSlug: actor.workspace.slug,
        section: "cash",
      }),
    };
    session.id = other.user.id;
    expect(
      (await exportRoute(new Request("http://localhost/export"), context))
        .status,
    ).toBe(404);
    session.id = actor.user.id;
    const result = await exportRoute(
      new Request("http://localhost/export"),
      context,
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(await result.text()).toContain("File references");
  });
  it("loads a selected record with its proof even outside the current filters", async () => {
    const id = await save("FILING", {
      occurredOn: "2025-06-10",
      details: { fiscalYear: 2025, quarter: "Q1", form: "Prior-year return" },
    });
    await attach(id);
    const view = await loadControlsView(
      actor,
      "tds",
      { fiscalYear: 2026, q: "no matching title", quarter: "Q4" },
      id,
    );
    expect(view.data.rows.find((r) => r.id === id)?.files).toHaveLength(1);
    expect(view.editing?.id).toBe(id);
  });
  it("fails closed for archived workspaces and cascades control descendants", async () => {
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(listControls(other, { section: "cash" })).rejects.toThrow();
    await prisma.workspace.update({
      where: { id: other.workspace.id },
      data: { archivedAt: null },
    });
    const id = await save(
      "FILING",
      { details: { fiscalYear: 2026, quarter: "Q1", form: "Return" } },
      other,
    );
    await attach(id, other);
    await transition(id, "POST", {}, other);
    await prisma.workspace.delete({ where: { id: other.workspace.id } });
    expect(
      await prisma.moneyControlRecord.count({
        where: { workspaceId: other.workspace.id },
      }),
    ).toBe(0);
    expect(
      await prisma.moneyControlEvent.count({
        where: { workspaceId: other.workspace.id },
      }),
    ).toBe(0);
  });
});
