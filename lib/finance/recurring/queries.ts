import "server-only";
import { prisma } from "@/lib/db";
import { canManageFinance, canReadStaffAdvance } from "@/lib/roles";
import {
  financeAccess,
  FinanceError,
  auditPayView,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { financePickers } from "@/lib/finance/tools/queries";
import { localDate } from "@/lib/finance/dates";
import { monthlyEquivalent, nextDue, taxAmounts } from "./rules";
import type { RecurringCostSchedule } from "@prisma/client";
export type RecurringQuery = {
  q?: string;
  status?: string;
  kind?: string;
  fund?: string;
  centre?: string;
  currency?: string;
  days?: string;
  edit?: string;
  page?: string;
  person?: string;
};
export const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
async function files(actor: FinanceActor, type: string, ids: string[]) {
  const rows = await prisma.financeAttachment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      recordType: type,
      recordId: { in: ids },
      file: { deletedAt: null },
    },
    select: {
      id: true,
      recordId: true,
      file: { select: { id: true, filename: true, contentType: true } },
    },
  });
  return Object.fromEntries(
    ids.map((id) => [
      id,
      rows
        .filter((r) => r.recordId === id)
        .map((r) => ({ ...r.file, attachmentId: r.id })),
    ]),
  );
}
export async function scheduleView(
  actor: FinanceActor,
  q: RecurringQuery = {},
) {
  const access = await financeAccess(actor, "MANAGE");
  const workspaceId = actor.workspace.id;
  const schedules = await prisma.recurringCostSchedule.findMany({
    where: {
      workspaceId,
      ...(q.q
        ? { title: { contains: q.q.slice(0, 120), mode: "insensitive" } }
        : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.fund ? { fundId: q.fund } : {}),
      ...(q.centre ? { costCentreId: q.centre } : {}),
    },
    include: {
      dues: {
        select: {
          principalMinor: true,
          bill: { select: { amountMinor: true, paidMinor: true, dueOn: true } },
        },
      },
    },
    orderBy: { nextDueOn: "asc" },
    take: 10001,
  });
  if (schedules.length > 10000)
    throw new FinanceError("Narrow the filters to at most 10,000 schedules.");
  const today = localDate(new Date(), actor.workspace.timezone),
    page = Math.max(1, Math.min(250, Number(q.page) || 1)),
    selected = q.edit
      ? await prisma.recurringCostSchedule.findFirst({
          where: { workspaceId, id: q.edit },
        })
      : null;
  const [
    pickers,
    contacts,
    organisations,
    leases,
    subscriptions,
    insurance,
    deposits,
  ] = await Promise.all([
    financePickers(actor),
    prisma.contact.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.organisation.findMany({
      where: { workspaceId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.facilityLease.findMany({
      where: { workspaceId, status: "ACTIVE" },
      select: { id: true, title: true },
    }),
    prisma.subscription.findMany({
      where: { workspaceId, status: "ACTIVE" },
      select: { id: true, name: true },
    }),
    prisma.governanceRecord.findMany({
      where: { workspaceId, kind: "INSURANCE", archivedAt: null },
      select: { id: true, title: true },
    }),
    prisma.moneyControlRecord.findMany({
      where: { workspaceId, kind: "DEPOSIT", payroll: false },
      select: { id: true, title: true },
    }),
  ]);
  const burn = new Map<
    string,
    {
      currency: string;
      fundId: string | null;
      costCentreId: string | null;
      amountMinor: number;
    }
  >();
  for (const s of schedules.filter(
    (s) => s.status === "ACTIVE" && !s.estimated,
  )) {
    const key = `${s.currency}:${s.fundId}:${s.costCentreId}`;
    const b = burn.get(key) ?? {
      currency: s.currency,
      fundId: s.fundId,
      costCentreId: s.costCentreId,
      amountMinor: 0,
    };
    b.amountMinor += monthlyEquivalent(
      taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent).cashMinor,
      s.frequency,
    );
    burn.set(key, b);
  }
  return {
    financeManage: true,
    payrollView: access.payrollView,
    defaultCurrency: actor.workspace.currency,
    today,
    schedules: schedules
      .slice((page - 1) * 40, page * 40)
      .map(({ dues, ...s }) => ({
        ...s,
        outstandingPrincipalMinor: Math.max(
          0,
          s.principalMinor -
            dues.reduce(
              (n, d) =>
                n +
                Math.round(
                  (d.principalMinor * d.bill.paidMinor) / d.bill.amountMinor,
                ),
              0,
            ),
        ),
        monthlyMinor: monthlyEquivalent(s.amountMinor, s.frequency),
        overdue: dues.filter(
          (d) =>
            iso(d.bill.dueOn) < today && d.bill.paidMinor < d.bill.amountMinor,
        ).length,
      })),
    selected,
    burn: [...burn.values()],
    total: schedules.length,
    page,
    pickers,
    contacts: contacts.map((c) => ({ id: c.id, name: c.displayName })),
    organisations,
    leases: leases.map((c) => ({ id: c.id, name: c.title })),
    subscriptions,
    insurance: insurance.map((c) => ({ id: c.id, name: c.title })),
    deposits: deposits.map((c) => ({ id: c.id, name: c.title })),
    files: await files(actor, "RECURRING", selected ? [selected.id] : []),
  };
}
export type ScheduleView = Awaited<ReturnType<typeof scheduleView>>;
export type DueRow = {
  id: string;
  title: string;
  kind: string;
  dueOn: string;
  amountMinor: number;
  paidMinor: number;
  currency: string;
  fundId: string | null;
  costCentreId: string | null;
  needsActual: boolean;
  projected: boolean;
  privatePayroll: boolean;
  billId: string | null;
  scheduleId: string | null;
  principalMinor: number;
  interestMinor: number;
  splitConfirmed: boolean;
  paidOn: string;
  reference: string;
  tdsMinor: number;
  gstMinor: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  sourceRunId: string | null;
};
export async function upcomingView(
  actor: FinanceActor,
  q: RecurringQuery = {},
  payrollOnly = false,
) {
  const access = await financeAccess(
      actor,
      payrollOnly ? "PAY_VIEW" : "MANAGE",
    ),
    workspaceId = actor.workspace.id;
  if (payrollOnly)
    await auditPayView(actor, "upcoming_remittances", workspaceId);
  const today = new Date(localDate(new Date(), actor.workspace.timezone)),
    days = [30, 60, 90].includes(Number(q.days)) ? Number(q.days) : 30,
    horizon = new Date(+today + days * 86400000);
  const where = {
    workspaceId,
    privatePayroll: payrollOnly ? true : access.payrollView ? undefined : false,
    dueOn: { lte: horizon },
    ...(q.fund ? { fundId: q.fund } : {}),
    ...(q.centre ? { costCentreId: q.centre } : {}),
    ...(q.currency ? { currency: q.currency } : {}),
    ...(q.status === "paid"
      ? { paidMinor: { equals: prisma.financeBill.fields.amountMinor } }
      : { paidMinor: { lt: prisma.financeBill.fields.amountMinor } }),
  };
  const bills = await prisma.financeBill.findMany({
    where,
    include: { recurringDue: true, payments: { orderBy: { paidOn: "desc" } } },
    orderBy: { dueOn: "asc" },
    take: 10001,
  });
  if (bills.length > 10000)
    throw new FinanceError("Narrow the due filters to at most 10,000 bills.");
  const rows: DueRow[] = bills.map((b) => ({
    id: b.id,
    title: `${b.vendor} · ${b.number}`,
    kind: b.recurringDue?.kind ?? "BILL",
    dueOn: iso(b.dueOn),
    amountMinor: b.amountMinor,
    paidMinor: b.paidMinor,
    currency: b.currency,
    fundId: b.fundId,
    costCentreId: b.costCentreId,
    needsActual: b.needsActual,
    privatePayroll: b.privatePayroll,
    projected: false,
    billId: b.id,
    scheduleId: b.recurringDue?.scheduleId ?? null,
    principalMinor: b.recurringDue?.principalMinor ?? 0,
    interestMinor: b.recurringDue?.interestMinor ?? 0,
    splitConfirmed: b.recurringDue?.splitConfirmed ?? false,
    paidOn: iso(b.payments[0]?.paidOn ?? null),
    reference: b.payments.map((p) => p.reference).join("; "),
    tdsMinor: b.tdsMinor,
    gstMinor: b.cgstMinor + b.sgstMinor + b.igstMinor,
    cgstMinor: b.cgstMinor,
    sgstMinor: b.sgstMinor,
    igstMinor: b.igstMinor,
    sourceRunId: b.recurringDue?.payRunId ?? null,
  }));
  const schedules = payrollOnly
    ? []
    : await prisma.recurringCostSchedule.findMany({
        where: {
          workspaceId,
          status: "ACTIVE",
          ...(q.fund ? { fundId: q.fund } : {}),
          ...(q.centre ? { costCentreId: q.centre } : {}),
          ...(q.currency ? { currency: q.currency } : {}),
        },
        include: { _count: { select: { dues: true } } },
        take: 10001,
      });
  if (schedules.length > 10000)
    throw new FinanceError("Narrow the schedule filters.");
  if (q.status !== "paid")
    for (const s of schedules) {
      let d = s.nextDueOn;
      for (let i = 0; i < 100 && d <= horizon; i++) {
        if (
          (s.endsOn && d > s.endsOn) ||
          (s.kind === "EMI" && s._count.dues + i >= s.tenure)
        )
          break;
        const tax = taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent);
        rows.push({
          id: `${s.id}:${iso(d)}`,
          title: s.title,
          kind: s.kind,
          dueOn: iso(d),
          amountMinor: tax.cashMinor,
          paidMinor: 0,
          currency: s.currency,
          fundId: s.fundId,
          costCentreId: s.costCentreId,
          needsActual: s.estimated,
          projected: true,
          privatePayroll: false,
          billId: null,
          scheduleId: s.id,
          principalMinor: 0,
          interestMinor: 0,
          splitConfirmed: false,
          paidOn: "",
          reference: "",
          tdsMinor: tax.tdsMinor,
          gstMinor: tax.gstMinor,
          sourceRunId: null,
        });
        d = nextDue(d, s.frequency, s.dueDay);
      }
    }
  if (access.payrollManage) {
    await auditPayView(actor, "advance_dues", workspaceId);
    const recoveries = await prisma.staffAdvanceRecovery.findMany({
      where: {
        workspaceId,
        dueOn: { lte: horizon },
        recoveredMinor: { lt: prisma.staffAdvanceRecovery.fields.amountMinor },
        advance: {
          status: "PAID",
          ...(q.fund ? { fundId: q.fund } : {}),
          ...(q.centre ? { costCentreId: q.centre } : {}),
        },
      },
      include: { advance: true },
      take: 10001,
    });
    if (recoveries.length > 10000)
      throw new FinanceError("Narrow the recovery filters.");
    if (q.status !== "paid")
      for (const r of recoveries)
        rows.push({
          id: r.id,
          title: "Staff advance recovery",
          kind: "ADVANCE_RECOVERY",
          dueOn: iso(r.dueOn),
          amountMinor: r.amountMinor,
          paidMinor: r.recoveredMinor,
          currency: r.advance.currency,
          fundId: r.advance.fundId,
          costCentreId: r.advance.costCentreId,
          needsActual: false,
          privatePayroll: true,
          projected: false,
          billId: null,
          scheduleId: null,
          principalMinor: 0,
          interestMinor: 0,
          splitConfirmed: false,
          paidOn: "",
          reference: "",
          tdsMinor: 0,
          gstMinor: 0,
          sourceRunId: null,
        });
  }
  const filtered = rows
    .filter(
      (r) =>
        (!q.kind || r.kind === q.kind) &&
        (!q.q ||
          r.title.toLowerCase().includes(q.q.toLowerCase().slice(0, 120))) &&
        (!q.currency || r.currency === q.currency),
    )
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  const page = Math.max(1, Math.min(1000, Number(q.page) || 1)),
    shown = filtered.slice((page - 1) * 40, page * 40);
  return {
    rows: shown,
    all: filtered,
    total: filtered.length,
    page,
    days,
    today: iso(today),
    payrollOnly,
    financeManage: canManageFinance(access.member),
    payrollManage: access.payrollManage,
    files: await files(
      actor,
      "BILL",
      shown.flatMap((r) => (r.billId ? [r.billId] : [])),
    ),
    pickers: await financePickers(actor, payrollOnly),
  };
}
export type UpcomingView = Awaited<ReturnType<typeof upcomingView>>;
export async function advancesView(
  actor: FinanceActor,
  q: RecurringQuery = {},
  exporting = false,
) {
  const member = await prisma.membership.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      userId: actor.user.id,
      status: "ACTIVE",
      user: { disabledAt: null },
      workspace: { archivedAt: null },
    },
  });
  const grant = await prisma.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  if (
    !member ||
    !canReadStaffAdvance(member, grant, actor.user.id, actor.user.id)
  )
    throw new FinanceError("You don't have access to advances.");
  const manage = !!grant?.manage;
  const page = Math.max(1, Math.min(250, Math.trunc(Number(q.page) || 1)));
  const where = {
    workspaceId: actor.workspace.id,
    ...(grant?.manage ? {} : { userId: actor.user.id }),
    ...(q.status ? { status: q.status } : {}),
    ...(q.q
      ? {
          reason: { contains: q.q.slice(0, 120), mode: "insensitive" as const },
        }
      : {}),
    ...(q.person ? { profileId: q.person } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.staffAdvance.findMany({
      where,
      include: { recoveries: { orderBy: { dueOn: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: exporting ? 10001 : 40,
      ...(exporting ? {} : { skip: (page - 1) * 40 }),
    }),
    prisma.staffAdvance.count({ where }),
  ]);
  if (exporting && rows.length > 10000)
    throw new FinanceError("Narrow the export to at most 10,000 advances.");
  await auditPayView(actor, "staff_advances", actor.workspace.id);
  const profiles = manage
    ? await prisma.financePayProfile.findMany({
        where: {
          workspaceId: actor.workspace.id,
          archivedAt: null,
          userId: { not: null },
        },
        select: { id: true, name: true, currency: true },
      })
    : [];
  const grants = manage
    ? await prisma.financePayrollGrant.findMany({
        where: { workspaceId: actor.workspace.id, manage: true },
        select: { userId: true },
      })
    : [];
  const people = manage
    ? await prisma.membership.findMany({
        where: {
          workspaceId: actor.workspace.id,
          userId: { in: grants.map((g) => g.userId) },
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
        select: { userId: true, user: { select: { name: true } } },
      })
    : [];
  const runs = manage
    ? await prisma.financePayRun.findMany({
        where: { workspaceId: actor.workspace.id, status: "PAID" },
        select: { id: true, month: true, profileId: true, paidOn: true },
        orderBy: { month: "desc" },
        take: 1000,
      })
    : [];
  return {
    rows,
    manage,
    total,
    page,
    payrollView: !!grant,
    financeManage: canManageFinance(member),
    profiles,
    people: people.map((p) => ({
      id: p.userId,
      name: p.user.name ?? "Payroll manager",
    })),
    runs,
    pickers: manage ? await financePickers(actor, true) : null,
    files: await files(
      actor,
      "ADVANCE",
      rows.map((r) => r.id),
    ),
  };
}
export type AdvancesView = Awaited<ReturnType<typeof advancesView>>;
export async function leaseFinanceView(
  actor: FinanceActor,
  leaseIds: string[],
) {
  await financeAccess(actor, "MANAGE");
  const rows = await prisma.recurringCostSchedule.findMany({
    where: { workspaceId: actor.workspace.id, leaseId: { in: leaseIds } },
    include: {
      dues: {
        include: {
          bill: { include: { payments: { orderBy: { paidOn: "desc" } } } },
        },
        orderBy: { dueOn: "desc" },
      },
    },
  });
  const deposits = await prisma.moneyControlRecord.findMany({
    where: {
      workspaceId: actor.workspace.id,
      kind: "DEPOSIT",
      payroll: false,
      id: { in: rows.flatMap((r) => (r.depositId ? [r.depositId] : [])) },
    },
    include: { movements: { orderBy: { occurredOn: "asc" } } },
  });
  return {
    rows,
    deposits,
    files: await files(
      actor,
      "BILL",
      rows.flatMap((r) => r.dues.map((d) => d.billId)),
    ),
  };
}
export type LeaseFinanceView = Awaited<ReturnType<typeof leaseFinanceView>>;
export function scheduleCsvRow(s: RecurringCostSchedule) {
  return [
    s.title,
    s.kind,
    s.payee,
    s.status,
    s.currency,
    s.amountMinor,
    s.estimated ? "Estimate" : "Fixed",
    s.frequency,
    monthlyEquivalent(s.amountMinor, s.frequency),
    iso(s.nextDueOn),
    s.fundId,
    s.costCentreId,
    s.gstPercent,
    s.tdsSection,
    s.tdsPercent,
    s.notes,
  ];
}
// Used only by export; view reads are bounded independently.
export async function allSchedules(actor: FinanceActor, q: RecurringQuery) {
  await financeAccess(actor, "MANAGE");
  return prisma.recurringCostSchedule.findMany({
    where: {
      workspaceId: actor.workspace.id,
      ...(q.q
        ? { title: { contains: q.q.slice(0, 120), mode: "insensitive" } }
        : {}),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.fund ? { fundId: q.fund } : {}),
      ...(q.centre ? { costCentreId: q.centre } : {}),
    },
    orderBy: { nextDueOn: "asc" },
    take: 10001,
  });
}
