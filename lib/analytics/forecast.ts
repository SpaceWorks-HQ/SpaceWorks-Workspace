import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFINITIONS, factSql } from "./definitions";
import { context } from "./queries";
import { AnalyticsError, type Actor } from "./access";
import {
  day,
  addMonths,
  forecastBuckets,
  forecastBucketPeriod,
  safeNumber,
  addDays,
} from "./metrics";
import { localDate } from "@/lib/finance/dates";
import { nextDue, taxAmounts } from "@/lib/finance/recurring/rules";
import { pledgeDue, object } from "@/lib/funding/analytics";
import type {
  AnalyticsQuery,
  ForecastLine,
  ForecastResult,
  DrillData,
} from "./types";
export async function cashForecast(
  actor: Actor,
  raw: AnalyticsQuery = {},
  now = new Date(),
  includePayroll = true,
): Promise<ForecastResult> {
  const { access: a, q } = await context(actor, raw, now);
  if (!a.admin)
    throw new AnalyticsError("Ask a finance admin to open the cash forecast.");
  if (q.fund || q.centre || q.team || q.project || q.programme)
    throw new AnalyticsError(
      "Clear the area filters for the account-level cash forecast. Account opening balances are not allocated to funds or projects.",
    );
  const showPayroll = a.payroll && includePayroll;
  const ws = a.workspace.id,
    currency = q.currency!,
    today = localDate(now, a.workspace.timezone),
    start = addDays(today, 1),
    end = addMonths(start, 6),
    threshold = Number(q.threshold ?? 10000000);
  const [
    opening,
    bills,
    schedules,
    dues,
    pay,
    funding,
    adjustments,
    budgets,
    disbursements,
    receivables,
  ] = await Promise.all([
    prisma.$queryRaw<{ amount: Prisma.Decimal; accounts: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS accounts,coalesce(sum(a."openingMinor" + coalesce((SELECT sum(CASE WHEN e.kind='INCOME' THEN e."amountMinor"::bigint ELSE -e."amountMinor"::bigint END) FROM "LedgerEntry" e WHERE e."workspaceId"=${ws} AND e."accountId"=a.id AND e.currency=a.currency AND e."voidedAt" IS NULL AND e."occurredOn" BETWEEN a."openingOn" AND ${today}::date),0) + coalesce((SELECT sum(m."amountMinor"::bigint) FROM "MoneyControlMovement" m WHERE m."workspaceId"=${ws} AND m."accountId"=a.id AND m.currency=a.currency AND m."occurredOn" BETWEEN a."openingOn" AND ${today}::date),0)),0)::numeric AS amount FROM "FinanceAccount" a WHERE a."workspaceId"=${ws} AND a.currency=${currency} AND a."openingOn"<=${today}::date`,
    ),
    prisma.financeBill.findMany({
      where: {
        workspaceId: ws,
        currency,
        dueOn: { lt: new Date(end) },
        paidMinor: { lt: prisma.financeBill.fields.amountMinor },
        ...(showPayroll ? {} : { privatePayroll: false }),
      },
      select: {
        id: true,
        vendor: true,
        dueOn: true,
        amountMinor: true,
        paidMinor: true,
        privatePayroll: true,
        needsActual: true,
      },
      take: 10001,
    }),
    prisma.recurringCostSchedule.findMany({
      where: {
        workspaceId: ws,
        currency,
        status: "ACTIVE",
        startsOn: { lt: new Date(end) },
      },
      include: { _count: { select: { dues: true } } },
      take: 10001,
    }),
    prisma.recurringCostDue.findMany({
      where: { workspaceId: ws, dueOn: { lt: new Date(end) } },
      select: { scheduleId: true, dueOn: true },
      take: 20001,
    }),
    showPayroll
      ? prisma.financePayRun.findMany({
          where: {
            workspaceId: ws,
            currency,
            status: { in: ["DRAFT", "APPROVED"] },
          },
          select: { id: true, month: true, netMinor: true },
          take: 10001,
        })
      : [],
    prisma.fundingRecord.findMany({
      where: {
        workspaceId: ws,
        currency,
        archivedAt: null,
        kind: { in: ["INSTALMENT", "PLEDGE", "DONATION"] },
      },
      take: 10001,
    }),
    prisma.analyticsAdjustment.findMany({
      where: {
        workspaceId: ws,
        currency,
        dueOn: { gte: new Date(start), lt: new Date(end) },
      },
      take: 10001,
    }),
    prisma.budget.findMany({
      where: {
        workspaceId: ws,
        currency,
        periodEnd: { gte: new Date(start) },
        periodStart: { lt: new Date(end) },
      },
      select: { id: true, name: true, amountMinor: true },
      take: 10001,
    }),
    prisma.$queryRaw<
      { id: string; payee: string; amountMinor: number; dueOn: Date | null }[]
    >(Prisma.sql`SELECT r.id,r.payee,r."amountMinor",r."dueOn" FROM "FinanceDisbursement" r
      WHERE r."workspaceId"=${ws} AND r.currency=${currency} AND r.status<>'PAID'
      AND r."dueOn"<${end}::date AND EXISTS(SELECT 1 FROM "ApprovalRequest" approval
        WHERE approval.id=r."approvalId" AND approval."workspaceId"=r."workspaceId"
        AND approval."subjectType"='CUSTOM' AND approval."subjectId"=r.id AND approval.status='APPROVED') LIMIT 10001`),
    prisma.$queryRaw<
      {
        id: string;
        title: string;
        date: Date;
        value: Prisma.Decimal;
        path: string;
      }[]
    >(Prisma.sql`WITH invoices AS (${await factSql(DEFINITIONS.find((d) => d.id === "document-receivables")!, a, today)}) SELECT id,title,date,value,path FROM invoices WHERE currency=${currency} AND date<${end}::date
 UNION ALL SELECT r.id,r.number||' · '||r."clientName",coalesce(r."dueOn",r."issuedOn"),r."totalMinor"::numeric,'/finance/invoices/'||r.id FROM "Invoice" r WHERE r."workspaceId"=${ws} AND r.currency=${currency} AND r.status='SENT' AND coalesce(r."dueOn",r."issuedOn")<${end}::date AND NOT EXISTS(SELECT 1 FROM "BusinessDocument" copy WHERE copy."workspaceId"=${ws} AND copy."sourceType"='INVOICE' AND copy."sourceId"=r.id AND copy.status='ISSUED') LIMIT 10001`),
  ]);
  if (
    [
      bills,
      schedules,
      pay,
      funding,
      adjustments,
      budgets,
      disbursements,
      receivables,
    ].some((rows) => rows.length > 10000) ||
    dues.length > 20000
  )
    throw new AnalyticsError(
      "Narrow the forecast data before exporting more than 10,000 commitments.",
    );
  const lines: ForecastLine[] = [],
    base = `/w/${a.workspace.slug}`,
    date = (v: Date | null) => (v && day(v) > today ? day(v) : start);
  for (const b of bills)
    lines.push({
      id: b.id,
      title: b.privatePayroll ? "Statutory payroll remittance" : b.vendor,
      date: date(b.dueOn),
      amountMinor: -(b.amountMinor - b.paidMinor),
      source: "Supplier bill",
      path: `${base}/finance/${b.privatePayroll ? "payroll/dues" : `bills?record=${b.id}`}`,
      estimated: b.needsActual,
    });
  const generated = new Set(dues.map((d) => `${d.scheduleId}:${day(d.dueOn)}`));
  for (const s of schedules) {
    let due = day(s.nextDueOn),
      n = 0;
    while (due < end && n++ < 120) {
      if (
        (s.endsOn && due > day(s.endsOn)) ||
        (s.kind === "EMI" && s._count.dues + n - 1 >= s.tenure)
      )
        break;
      if (!generated.has(`${s.id}:${due}`))
        lines.push({
          id: `${s.id}:${due}`,
          title: s.title,
          date: due > today ? due : start,
          amountMinor: -taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent)
            .cashMinor,
          source: "Projected recurring cost",
          path: `${base}/finance/recurring?edit=${s.id}`,
          estimated: true,
        });
      const next = day(
        nextDue(
          new Date(due),
          s.frequency as "MONTHLY" | "QUARTERLY" | "YEARLY",
          s.dueDay,
        ),
      );
      if (next <= due) break;
      due = next;
    }
  }
  for (const r of pay) {
    const due = `${r.month}-28`;
    if (due < end)
      lines.push({
        id: r.id,
        title: "Planned payroll",
        date: due > today ? due : start,
        amountMinor: -r.netMinor,
        source: "Payroll estimate",
        path: `${base}/finance/payroll?month=${r.month}#${r.id}`,
        estimated: true,
      });
  }
  for (const f of funding) {
    if (f.kind === "INSTALMENT" && f.status === "EXPECTED") {
      const when = date(f.dueOn);
      if (when < end)
        lines.push({
          id: f.id,
          title: f.title,
          date: when,
          amountMinor: f.amountMinor,
          source: "Grant instalment",
          path: `${base}/funding/grants?edit=${f.id}`,
          estimated: true,
        });
    }
    if (f.kind === "PLEDGE" && f.status === "ACTIVE") {
      let due = pledgeDue(
          f,
          funding.filter((g) => g.kind === "DONATION"),
        ),
        n = 0;
      const d = object(f.details),
        paid = funding
          .filter(
            (g) =>
              g.kind === "DONATION" &&
              g.status === "RECEIVED" &&
              g.currency === f.currency &&
              object(g.details).pledgeId === f.id &&
              object(g.details).mode !== "IN_KIND",
          )
          .reduce((sum, g) => sum + g.amountMinor, 0);
      while (due && due < end && n++ < 24) {
        lines.push({
          id: `${f.id}:${due}`,
          title: f.title,
          date: due > today ? due : start,
          amountMinor:
            n === 1 ? f.amountMinor - (paid % f.amountMinor) : f.amountMinor,
          source: "Pledge estimate",
          path: `${base}/funding/donations?edit=${f.id}`,
          estimated: true,
        });
        if (d.frequency === "ONCE") break;
        due = addMonths(
          String(d.nextExpectedOn),
          (Math.floor(paid / f.amountMinor) + n) *
            (d.frequency === "YEARLY" ? 12 : d.frequency === "QUARTERLY" ? 3 : 1),
        );
        if (d.endOn && due > String(d.endOn)) break;
      }
    }
  }
  for (const r of disbursements)
    lines.push({
      id: r.id,
      title: r.payee,
      date: date(r.dueOn),
      amountMinor: -r.amountMinor,
      source: "Approved disbursement",
      path: `${base}/finance/disbursements?record=${r.id}#${r.id}`,
      estimated: true,
    });
  for (const r of receivables)
    lines.push({
      id: r.id,
      title: r.title,
      date: date(r.date),
      amountMinor: safeNumber(r.value),
      source: "Receivable estimate",
      path: `${base}${r.path}`,
      estimated: true,
    });
  for (const r of adjustments)
    lines.push({
      id: r.id,
      title: r.title,
      date: day(r.dueOn),
      amountMinor: r.amountMinor,
      source: "Manual one-off",
      path: `${base}/analytics?section=finance#adjustments`,
      estimated: true,
    });
  if (lines.length > 10000)
    throw new AnalyticsError(
      "The forecast has more than 10,000 lines. Review overdue items and inactive schedules, or choose another currency.",
    );
  lines.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const openingMinor = safeNumber(opening[0]?.amount ?? 0),
    openingKnown = Number(opening[0]?.accounts ?? 0) > 0;
  return {
    asOf: today,
    currency,
    openingMinor,
    openingKnown,
    thresholdMinor: threshold,
    weekly: forecastBuckets(
      lines,
      openingMinor,
      start,
      12,
      "week",
      threshold,
    ).map((b) => ({ ...b, low: openingKnown && b.low })),
    monthly: forecastBuckets(
      lines,
      openingMinor,
      start,
      6,
      "month",
      threshold,
    ).map((b) => ({ ...b, low: openingKnown && b.low })),
    lines,
    warnings: [
      ...(!openingKnown
        ? [
            `No finance accounts have an opening balance for ${currency} by the as-of date. Closing cash is an illustrative change from zero until accounts are recorded.`,
          ]
        : []),
      "Only entered commitments are included. Unentered pay runs and costs are not assumed.",
      "Opening balance includes all recorded account movements through today. Unassigned ledger entries do not alter account balances.",
      "Overdue commitments are carried into the first forecast day. Future cash dates are estimates; payroll uses day 28 when no pay date is stored.",
      ...(showPayroll
        ? []
        : [
            "Private payroll and statutory commitments are omitted from this view. Use the payroll-permitted analytics view for the complete private forecast. Opening cash remains aggregate.",
          ]),
      `${budgets.length} overlapping budgets (${budgets.reduce((n, b) => n + b.amountMinor, 0)} minor units) are spending envelopes, not dated cash obligations. They are excluded to avoid counting the same bills twice; add a one-off adjustment for uncommitted planned spending.`,
      "Receivables use current outstanding balances and their due dates; legacy copies linked to controlled issued invoices are excluded. They remain estimates until payment is logged.",
      "Pledges and grants must not describe the same receipt twice. Subscriptions, rent, insurance and EMIs enter through recurring schedules; no second projection is added from their source registers.",
    ],
  };
}
export async function forecastDrill(
  actor: Actor,
  raw: AnalyticsQuery = {},
  limit = 50,
): Promise<DrillData> {
  const { q } = await context(actor, raw),
    f = await cashForecast(actor, q),
    cadence = q.cadence === "week" ? "week" : "month",
    buckets = cadence === "week" ? f.weekly : f.monthly,
    index = q.bucket ? buckets.findIndex((b) => b.label === q.bucket) : 0;
  if (index < 0)
    throw new AnalyticsError("Choose a bucket from the current forecast.");
  const { from, to } = forecastBucketPeriod(addDays(f.asOf, 1), index, cadence),
    page = Math.max(1, Number(q.page ?? 1));
  const rows = f.lines.filter((l) => l.date >= from && l.date < to),
    selected = rows.slice((page - 1) * limit, page * limit);
  return {
    title: "Cash forecast assumptions",
    description: `Opening cash for this bucket ${f.openingMinor + f.lines.filter((l) => l.date < from).reduce((n, l) => n + l.amountMinor, 0)} ${f.currency} minor units, including earlier forecast lines from the account balance as of ${f.asOf}. These are projected cash lines, not accounting entries. Open each source to review it.`,
    unit: "money" as const,
    basisUnit: "money",
    q,
    period: { from, to: addDays(to, -1) },
    page,
    more: rows.length > page * limit,
    rows: selected.map((l) => ({
      id: l.id,
      title: l.title,
      path: l.path,
      date: l.date,
      label: l.source,
      value: l.amountMinor,
      base: 0,
    })),
  };
}
