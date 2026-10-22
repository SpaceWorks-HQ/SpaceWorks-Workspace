import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEFINITIONS, factSql } from "../definitions";
import { AnalyticsError, type Access } from "../access";

export async function forecastSources(
  a: Access,
  currency: string,
  today: string,
  start: string,
  end: string,
  showPayroll: boolean,
) {
  const ws = a.workspace.id;
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
  return {
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
  };
}
