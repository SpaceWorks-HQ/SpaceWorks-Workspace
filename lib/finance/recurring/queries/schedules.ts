import "server-only";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import type { RecurringQuery } from "./types";
import { financePickers } from "@/lib/finance/tools/queries";
import { localDate } from "@/lib/finance/dates";
import { monthlyEquivalent, taxAmounts } from "../rules";
import { files } from "./files";
import { iso } from "./formatters";

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
