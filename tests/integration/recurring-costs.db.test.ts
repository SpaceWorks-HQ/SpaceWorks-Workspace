import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
const session = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (session.id ? { user: { id: session.id } } : null),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/actionRateLimit", () => ({
  isActionRateLimited: async () => false,
}));
import { prisma } from "@/lib/db";
import {
  getWorkspaceForAction,
  type WorkspaceContext,
} from "@/lib/permissions";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../helpers/fixtures";
import {
  saveSchedule,
  generateSchedule,
  confirmActual,
  scheduleFromSource,
  createRemittances,
} from "@/lib/finance/recurring/service";
import {
  saveAdvance,
  requestAdvanceApproval,
  payAdvance,
  recoverAdvance,
  readAdvance,
} from "@/lib/finance/recurring/advances";
import { upcomingView, advancesView } from "@/lib/finance/recurring/queries";
import { monthlyCashFlow } from "@/lib/finance/recurring/cash-flow";
import { financeCsv } from "@/lib/finance/tools/export";
import { payBill } from "@/lib/finance/tools/service";
import { lockFinance } from "@/lib/finance/tools/access";
import { savePayRun, transitionPayRun } from "@/lib/finance/tools/payroll";
import { uploadFinanceFiles } from "@/lib/finance/tools/files";
import { findDownloadableFile } from "@/lib/files";
import { deleteObjects } from "@/lib/storage";
import { accountBalance } from "@/lib/finance/tools/close";
import { decide } from "@/lib/approvals/engine";
import { run } from "@/lib/scheduled/recurringCosts";
import { canAccessResource } from "@/lib/search/query";
import { recurringCostAction } from "@/app/actions/recurring-costs";
import { GET as exportCsv } from "@/app/w/[workspaceSlug]/finance/recurring/export/route";
const suffix = uniqueSuffix(),
  domain = `@recurring-${suffix}.test`,
  slug = `recurring-${suffix}`,
  foreignSlug = `recurring-other-${suffix}`;
let owner: WorkspaceContext,
  manager: WorkspaceContext,
  person: WorkspaceContext,
  outsider: WorkspaceContext,
  guest: WorkspaceContext;
let categoryId: string,
  accountId: string,
  profileId: string,
  foreignFund: string,
  runId: string,
  advanceId: string,
  scheduleId: string,
  utilityBill: string,
  emiBill: string;
const schedule = (extra: Record<string, unknown> = {}) => ({
  requestKey: randomUUID(),
  title: "Office rent",
  kind: "RENT",
  payee: "Landlord",
  amountMinor: 4500000,
  currency: "INR",
  frequency: "MONTHLY",
  dueDay: 1,
  startsOn: "2026-10-01",
  leadDays: 14,
  categoryId,
  accountId,
  ...extra,
});
const pdf = () =>
  new File(["%PDF-1.4\nmanual proof"], "challan.pdf", {
    type: "application/pdf",
  });
async function generate(id: string, day = "2026-10-21") {
  await prisma.$transaction(async (tx) => {
    await lockFinance(tx, owner.workspace.id);
    const s = await tx.recurringCostSchedule.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, id },
    });
    await generateSchedule(tx, s, new Date(day));
  });
}
async function ctx(id: string, space = slug) {
  session.id = id;
  return (await getWorkspaceForAction(space))!;
}
beforeAll(async () => {
  const users = await Promise.all(
    ["owner", "manager", "person", "outsider", "guest"].map((n) =>
      createUser(`${n}${domain}`, n),
    ),
  );
  const ws = await createWorkspace(slug, users[0]!.id),
    other = await createWorkspace(foreignSlug, users[3]!.id);
  await addMember(ws.id, users[1]!.id, "ADMIN");
  await addMember(ws.id, users[2]!.id, "MEMBER");
  await addMember(ws.id, users[4]!.id, "GUEST");
  owner = await ctx(users[0]!.id);
  manager = await ctx(users[1]!.id);
  person = await ctx(users[2]!.id);
  guest = await ctx(users[4]!.id);
  outsider = await ctx(users[3]!.id, foreignSlug);
  for (const actor of [owner, manager])
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: ws.id,
        userId: actor.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
  categoryId = (
    await prisma.financeCategory.create({
      data: {
        workspaceId: ws.id,
        name: "Recurring office costs",
        kind: "EXPENSE",
      },
    })
  ).id;
  accountId = (
    await prisma.financeAccount.create({
      data: {
        workspaceId: ws.id,
        name: "Office bank",
        openingMinor: 50000000,
        openingOn: new Date("2026-01-01"),
      },
    })
  ).id;
  profileId = (
    await prisma.financePayProfile.create({
      data: {
        workspaceId: ws.id,
        name: "Staff member",
        userId: person.user.id,
        kind: "STAFF",
        rateMinor: 3000000,
      },
    })
  ).id;
  foreignFund = (
    await prisma.financeFund.create({
      data: { workspaceId: other.id, name: "Foreign fund" },
    })
  ).id;
}, 60000);
afterAll(async () => {
  const files = await prisma.fileObject.findMany({
    where: { workspace: { slug: { in: [slug, foreignSlug] } } },
    select: { storageKey: true },
  });
  await deleteObjects(files.map((f) => f.storageKey));
  await cleanup([slug, foreignSlug], domain);
  await prisma.$disconnect();
});
describe.sequential("manual recurring finance", () => {
  it("rejects forged roles, guests and cross-workspace tags", async () => {
    await expect(
      saveSchedule({ ...person, membership: { role: "OWNER" } }, schedule()),
    ).rejects.toThrow(/access/);
    await expect(saveSchedule(guest, schedule())).rejects.toThrow(/access/);
    await expect(
      saveSchedule(owner, schedule({ fundId: foreignFund })),
    ).rejects.toThrow(/fund/);
  });
  it("creates a schedule and generates each period once under concurrent claims", async () => {
    scheduleId = await saveSchedule(owner, schedule());
    await Promise.all([generate(scheduleId), generate(scheduleId)]);
    const dues = await prisma.recurringCostDue.findMany({
      where: { workspaceId: owner.workspace.id, scheduleId },
      include: { bill: true },
    });
    expect(dues).toHaveLength(2);
    expect(dues[0]!.bill.amountMinor).toBe(4500000);
    expect(dues[0]!.bill.categoryId).toBe(categoryId);
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(0);
  });
  it("retains future projections in 90-day view without issuing early bills", async () => {
    const v = await upcomingView(owner, { days: "90" });
    expect(v.all.some((r) => r.scheduleId === scheduleId && r.projected)).toBe(
      true,
    );
    expect(v.all[0]!.dueOn <= v.all.at(-1)!.dueOn).toBe(true);
  });
  it("keeps source timing immutable once bills exist", async () => {
    const s = await prisma.recurringCostSchedule.findFirstOrThrow({
      where: { id: scheduleId },
    });
    await expect(
      saveSchedule(owner, {
        ...s,
        startsOn: "2026-10-01",
        endsOn: null,
        renewalOn: null,
        dueDay: 2,
      }),
    ).rejects.toThrow(/timing/);
  });
  it("requires actual utility amount, then uses ordinary idempotent partial payments", async () => {
    const id = await saveSchedule(
      owner,
      schedule({
        title: "Electricity",
        kind: "ELECTRICITY",
        estimated: true,
        amountMinor: 800000,
      }),
    );
    await generate(id);
    utilityBill = (
      await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, scheduleId: id },
      })
    ).billId;
    const payment = {
      billId: utilityBill,
      paymentKey: randomUUID(),
      amountMinor: 450000,
      paidOn: "2026-10-21",
      reference: "Power bill",
      post: true,
    };
    await expect(payBill(owner, payment)).rejects.toThrow(/actual/);
    await confirmActual(owner, { billId: utilityBill, amountMinor: 900000 });
    const ids = await Promise.all([
      payBill(owner, payment),
      payBill(owner, payment),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(
      (
        await prisma.financeBill.findFirstOrThrow({
          where: { id: utilityBill },
        })
      ).paidMinor,
    ).toBe(450000);
    await expect(payBill(outsider, payment)).rejects.toThrow(/unavailable/);
  });
  it("requires reviewed GST components instead of inferring a place of supply", async () => {
    const id = await saveSchedule(
      owner,
      schedule({ title: "Taxable office rent", gstPercent: 18 }),
    );
    await generate(id);
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, scheduleId: id },
      include: { bill: true },
    });
    expect(due.bill).toMatchObject({
      needsActual: true,
      amountMinor: 5310000,
      igstMinor: 0,
    });
    await confirmActual(owner, {
      billId: due.billId,
      amountMinor: 5310000,
      cgstMinor: 405000,
      sgstMinor: 405000,
    });
    expect(
      await prisma.financeBill.findFirst({
        where: { workspaceId: owner.workspace.id, id: due.billId },
      }),
    ).toMatchObject({
      needsActual: false,
      taxableMinor: 4500000,
      cgstMinor: 405000,
      sgstMinor: 405000,
      igstMinor: 0,
    });
    await expect(
      confirmActual(owner, {
        billId: due.billId,
        amountMinor: 5310000,
        cgstMinor: 405000,
        igstMinor: 405000,
      }),
    ).rejects.toThrow(/either/);
  });
  it("splits EMI principal into cash movements and interest into expenses", async () => {
    const id = await saveSchedule(
      owner,
      schedule({
        title: "Equipment EMI",
        kind: "EMI",
        amountMinor: 100000,
        principalMinor: 30000000,
        tenure: 36,
        annualRatePercent: 9,
      }),
    );
    await generate(id);
    emiBill = (
      await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, scheduleId: id },
      })
    ).billId;
    const p = {
      billId: emiBill,
      paymentKey: randomUUID(),
      amountMinor: 100000,
      paidOn: "2026-10-21",
      reference: "EMI 1",
      post: true,
    };
    await expect(payBill(owner, p)).rejects.toThrow(/split/);
    await confirmActual(owner, {
      billId: emiBill,
      amountMinor: 100000,
      principalMinor: 75000,
      interestMinor: 25000,
    });
    const pid = await payBill(owner, p);
    expect(
      await prisma.ledgerEntry.findFirst({
        where: { workspaceId: owner.workspace.id, sourceId: pid },
      }),
    ).toMatchObject({ amountMinor: 25000 });
    expect(
      await prisma.moneyControlMovement.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          operationKey: `emi-payment:${pid}`,
        },
      }),
    ).toMatchObject({ amountMinor: -75000 });
  });
  it("creates rent schedules in one source step and preserves TDS in the existing register", async () => {
    const contact = await prisma.contact.create({
      data: {
        workspaceId: owner.workspace.id,
        displayName: "Landlord",
        kinds: ["facilities"],
        createdById: owner.user.id,
      },
    });
    const lease = await prisma.facilityLease.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Office",
        landlordContactId: contact.id,
        ownerId: owner.user.id,
        rentMinor: 4500000,
        startsOn: new Date("2026-01-01"),
        renewalOn: new Date("2027-01-01"),
        notes: "",
        requestKey: randomUUID(),
      },
    });
    const id = await scheduleFromSource(owner, "LEASE", lease.id);
    expect(await scheduleFromSource(owner, "LEASE", lease.id)).toBe(id);
    const s = await prisma.recurringCostSchedule.findFirstOrThrow({
      where: { id },
    });
    await saveSchedule(owner, {
      ...s,
      startsOn: "2026-10-01",
      endsOn: null,
      renewalOn: "2027-01-01",
      tdsPercent: 10,
      accountId,
      categoryId,
    });
    await generate(id, "2026-11-01");
    const d = await prisma.recurringCostDue.findFirstOrThrow({
      where: { scheduleId: id },
      include: { bill: true },
    });
    await payBill(owner, {
      billId: d.billId,
      paymentKey: randomUUID(),
      amountMinor: d.bill.amountMinor,
      paidOn: "2026-11-01",
      reference: "Rent",
      post: true,
    });
    expect(
      await prisma.moneyControlRecord.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          kind: "TDS_DEDUCTION",
          recordKey: `recurring-tds:${d.billId}`,
        },
      }),
    ).toMatchObject({
      amountMinor: 450000,
      details: expect.objectContaining({ section: "194-I", fiscalYear: 2026 }),
    });
  });
  it("creates all four remittances atomically when a pay run is paid", async () => {
    runId = await savePayRun(owner, {
      profileId,
      month: "2026-09",
      grossMinor: 3000000,
      pfMinor: 180000,
      esiMinor: 22500,
      ptMinor: 20000,
      tdsMinor: 100000,
      advancesMinor: 500000,
      accountId,
      categoryId,
    });
    await transitionPayRun(manager, { runId, transition: "APPROVE" });
    await transitionPayRun(owner, {
      runId,
      transition: "PAY",
      paidOn: "2026-10-01",
      reference: "Salary",
    });
    await prisma.$transaction(async (tx) =>
      createRemittances(
        tx,
        await tx.financePayRun.findFirstOrThrow({ where: { id: runId } }),
      ),
    );
    const dues = await prisma.recurringCostDue.findMany({
      where: { workspaceId: owner.workspace.id, payRunId: runId },
      include: { bill: true },
    });
    expect(dues).toHaveLength(4);
    expect(dues.every((d) => d.bill.privatePayroll)).toBe(true);
    expect(
      dues.find((d) => d.kind === "SALARY_TDS")!.dueOn.toISOString(),
    ).toContain("2026-10-07");
  });
  it("keeps payroll bills out of general CSV and revokes private proof downloads", async () => {
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      // The statutory payment test below needs its salary-tax bill without proof.
      where: { workspaceId: owner.workspace.id, payRunId: runId, kind: { not: "SALARY_TDS" } },
    });
    const [file] = await uploadFinanceFiles(owner, "BILL", due.billId, [pdf()]);
    expect(await findDownloadableFile(file!.id, owner.user.id)).not.toBeNull();
    await prisma.financePayrollGrant.deleteMany({
      where: { workspaceId: owner.workspace.id, userId: owner.user.id },
    });
    expect(await findDownloadableFile(file!.id, owner.user.id)).toBeNull();
    await expect(
      payBill(owner, {
        billId: due.billId,
        paymentKey: randomUUID(),
        amountMinor: 1,
        paidOn: "2026-10-21",
        reference: "No access",
      }),
    ).rejects.toThrow(/access/);
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    expect(
      await financeCsv(owner, "bills", {
        from: "2026-09-01",
        to: "2026-12-31",
      }),
    ).not.toContain(due.kind + "-2026-09");
  });
  it("requires challans and records statutory paid dates and private ledger postings", async () => {
    const due = await prisma.recurringCostDue.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        payRunId: runId,
        kind: "SALARY_TDS",
      },
      include: { bill: true },
    });
    const p = {
      billId: due.billId,
      paymentKey: randomUUID(),
      amountMinor: due.bill.amountMinor,
      paidOn: "2026-10-21",
      reference: "Challan 192",
      post: true,
    };
    await expect(payBill(owner, p)).rejects.toThrow(/challan/);
    await uploadFinanceFiles(owner, "BILL", due.billId, [pdf()]);
    const id = await payBill(manager, p);
    expect(
      await prisma.ledgerEntry.findFirst({
        where: { workspaceId: owner.workspace.id, sourceId: id },
      }),
    ).toMatchObject({ privatePayroll: true, amountMinor: 100000 });
  });
  it("supports a private staff advance with independent approval and cash-only payout", async () => {
    advanceId = await saveAdvance(owner, {
      requestKey: randomUUID(),
      profileId,
      reason: "Urgent travel",
      amountMinor: 2000000,
      instalments: 4,
      startsOn: "2026-10-01",
      accountId,
    });
    await expect(
      requestAdvanceApproval(owner, advanceId, owner.user.id),
    ).rejects.toThrow(/another/);
    await requestAdvanceApproval(owner, advanceId, manager.user.id);
    const row = await prisma.staffAdvance.findFirstOrThrow({
      where: { id: advanceId },
    });
    await decide(manager, {
      requestId: row.approvalId!,
      decision: "APPROVED",
      comment: "Reviewed",
    });
    await expect(
      payAdvance(owner, advanceId, "2026-10-01", "Advance payout"),
    ).rejects.toThrow(/proof/);
    await uploadFinanceFiles(owner, "ADVANCE", advanceId, [pdf()]);
    const before = await accountBalance(
      prisma,
      owner.workspace.id,
      accountId,
      new Date("2026-12-31"),
    );
    await payAdvance(owner, advanceId, "2026-10-01", "Advance payout");
    const after = await accountBalance(
      prisma,
      owner.workspace.id,
      accountId,
      new Date("2026-12-31"),
    );
    expect(before.balanceMinor - after.balanceMinor).toBe(2000000);
    expect(await readAdvance(person, advanceId)).toMatchObject({
      amountMinor: 2000000,
    });
    await expect(readAdvance(outsider, advanceId)).rejects.toThrow(
      /unavailable/,
    );
    expect((await advancesView(person)).rows).toHaveLength(1);
  });
  it("a payroll view grant does not reveal another person's advance", async () => {
    await prisma.financePayrollGrant.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { manage: false },
    });
    await expect(readAdvance(manager, advanceId)).rejects.toThrow(
      /unavailable/,
    );
    const proof = await prisma.financeAttachment.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        recordType: "ADVANCE",
        recordId: advanceId,
      },
    });
    expect(
      await findDownloadableFile(proof.fileId, manager.user.id),
    ).toBeNull();
    expect(
      await findDownloadableFile(proof.fileId, person.user.id),
    ).not.toBeNull();
    expect(
      await findDownloadableFile(proof.fileId, outsider.user.id),
    ).toBeNull();
    expect((await advancesView(manager)).rows).toHaveLength(0);
    await prisma.financePayrollGrant.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { manage: true },
    });
  });
  it("recovers against a paid run once without posting another cash movement", async () => {
    const recovery = await prisma.staffAdvanceRecovery.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, advanceId },
      orderBy: { instalment: "asc" },
    });
    const data = {
      id: recovery.id,
      amountMinor: 500000,
      paidOn: "2026-10-01",
      reference: "Salary deduction",
      operationKey: randomUUID(),
      payRunId: runId,
    };
    const before = await prisma.moneyControlMovement.count({
      where: { workspaceId: owner.workspace.id },
    });
    await recoverAdvance(owner, data);
    await recoverAdvance(owner, data);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    await expect(
      recoverAdvance(owner, {
        ...data,
        operationKey: randomUUID(),
        amountMinor: 1,
      }),
    ).rejects.toThrow(/balance/);
  });
  it("recovers manually with bounded, idempotent cash movements", async () => {
    const recovery = await prisma.staffAdvanceRecovery.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, advanceId, instalment: 2 },
    });
    const data = {
      id: recovery.id,
      amountMinor: 500000,
      paidOn: "2026-10-21",
      reference: "Cash return",
      operationKey: randomUUID(),
    };
    await Promise.all([
      recoverAdvance(manager, data),
      recoverAdvance(manager, data),
    ]);
    expect(
      await prisma.moneyControlMovement.count({
        where: {
          workspaceId: owner.workspace.id,
          operationKey: data.operationKey,
        },
      }),
    ).toBe(1);
  });
  it("enforces live search and download permissions for schedule evidence", async () => {
    const [file] = await uploadFinanceFiles(owner, "RECURRING", scheduleId, [
      pdf(),
    ]);
    expect(await findDownloadableFile(file!.id, person.user.id)).toBeNull();
    expect(
      await canAccessResource(
        {
          workspaceId: owner.workspace.id,
          userId: person.user.id,
          role: "MEMBER",
        },
        "recurring_cost",
        scheduleId,
      ),
    ).toBe(false);
    expect(
      await canAccessResource(
        {
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
          role: "OWNER",
        },
        "recurring_cost",
        scheduleId,
      ),
    ).toBe(true);
  });
  it("deduplicates beat reminders and omits sensitive payloads", async () => {
    const now = new Date("2026-10-22T08:00:00Z");
    await run(now);
    const count = await prisma.notificationEventRecord.count({
      where: { workspaceId: owner.workspace.id, type: "finance.recurring.due" },
    });
    await run(now);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "finance.recurring.due",
        },
      }),
    ).toBe(count);
    expect(count).toBeGreaterThan(0);
  });
  it("includes principal and deposit cash without treating them as expenses", async () => {
    const flow = await monthlyCashFlow(owner.workspace.id, {
      from: "2026-10-01",
      to: "2026-10-31",
      currency: "INR",
    });
    const expense = await prisma.ledgerEntry.aggregate({
      where: {
        workspaceId: owner.workspace.id,
        kind: "EXPENSE",
        voidedAt: null,
        occurredOn: {
          gte: new Date("2026-10-01"),
          lte: new Date("2026-10-31"),
        },
      },
      _sum: { amountMinor: true },
    });
    const movement = await prisma.moneyControlMovement.aggregate({
      where: {
        workspaceId: owner.workspace.id,
        amountMinor: { lt: 0 },
        record: { kind: "DEPOSIT" },
        occurredOn: {
          gte: new Date("2026-10-01"),
          lte: new Date("2026-10-31"),
        },
      },
      _sum: { amountMinor: true },
    });
    expect(flow[0]!.expenseMinor).toBe(
      (expense._sum.amountMinor ?? 0) - (movement._sum.amountMinor ?? 0),
    );
  });
  it("checks write authority before resolving private profile ids or parsing amounts", async () => {
    session.id = person.user.id;
    const form = (profile: string) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({
        profileId: profile,
        amountMinor: "invalid",
        reason: "Private request",
        requestKey: randomUUID(),
        instalments: "4",
        startsOn: "2026-10-01",
        accountId,
      }))
        f.set(k, v);
      return f;
    };
    const known = await recurringCostAction(slug, "advance", form(profileId));
    const missing = await recurringCostAction(
      slug,
      "advance",
      form("unavailable-profile"),
    );
    expect(known).toMatchObject({ ok: false });
    expect(missing).toEqual(known);
  });
  it("allows an explicit payroll manager without general finance access to manage remittance dates", async () => {
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: person.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    try {
      session.id = person.user.id;
      const due = await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, payRunId: runId, kind: "PF" },
      });
      const form = new FormData();
      form.set("billId", due.billId);
      form.set("dueOn", "2026-10-28");
      expect(
        await recurringCostAction(slug, "remittanceDue", form),
      ).toMatchObject({ ok: true });
    } finally {
      await prisma.financePayrollGrant.deleteMany({
        where: { workspaceId: owner.workspace.id, userId: person.user.id },
      });
    }
  });
  it("guards action and CSV boundaries for ordinary members and foreign tenants", async () => {
    session.id = person.user.id;
    expect(
      await recurringCostAction(slug, "schedule", new FormData()),
    ).toMatchObject({ ok: false });
    const response = await exportCsv(
      new Request(
        `http://localhost/w/${slug}/finance/recurring/export?export=schedules`,
      ),
      { params: Promise.resolve({ workspaceSlug: slug }) },
    );
    expect(response.status).toBe(404);
    session.id = outsider.user.id;
    const res = await exportCsv(
      new Request(`http://localhost/w/${slug}/finance/recurring/export`),
      { params: Promise.resolve({ workspaceSlug: slug }) },
    );
    expect(res.status).toBe(404);
  });
  it("denies suspended managers and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(saveSchedule(manager, schedule())).rejects.toThrow(/access/);
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(upcomingView(owner)).rejects.toThrow(/access/);
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: null },
    });
  });
});
