import "server-only";
import { prisma } from "@/lib/db";
import {
  financeAccess,
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import type { RecurringQuery } from "./types";
import { canManageFinance } from "@/lib/roles";
import { auditPayView } from "@/lib/finance/tools/access";
import { financePickers } from "@/lib/finance/tools/queries";
import { localDate } from "@/lib/finance/dates";
import { nextDue, taxAmounts } from "../rules";
import type { DueRow } from "./types";
import { files } from "./files";
import { iso } from "./formatters";

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
