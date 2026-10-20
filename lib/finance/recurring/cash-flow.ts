import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { FinanceError } from "@/lib/finance/tools/access";
/** Cash-only principal/deposit movements belong in cash flow, without becoming expenses. */
export async function monthlyCashFlow(
  workspaceId: string,
  period: { from: string; to: string; currency: string },
  centre?: string,
) {
  const rows = await prisma.$queryRaw<
    Array<{
      name: string;
      incomeMinor: bigint;
      expenseMinor: bigint;
      netMinor: bigint;
      count: bigint;
    }>
  >(Prisma.sql`
    WITH cash AS (
      SELECT left(e."occurredOn"::text,7) AS month,e."amountMinor"::bigint * CASE WHEN e.kind='INCOME' THEN 1 ELSE -1 END AS amount
      FROM "LedgerEntry" e WHERE e."workspaceId"=${workspaceId} AND e.currency=${period.currency} AND e."voidedAt" IS NULL
        AND e."occurredOn" BETWEEN ${new Date(period.from)} AND ${new Date(period.to)}
        ${centre ? Prisma.sql`AND e."costCentreId"=${centre}` : Prisma.empty}
      UNION ALL
      SELECT left(m."occurredOn"::text,7),m."amountMinor"::bigint
      FROM "MoneyControlMovement" m JOIN "MoneyControlRecord" r ON r.id=m."recordId" AND r."workspaceId"=m."workspaceId"
      WHERE m."workspaceId"=${workspaceId} AND m.currency=${period.currency} AND r.kind='DEPOSIT'
        AND m."occurredOn" BETWEEN ${new Date(period.from)} AND ${new Date(period.to)}
        ${centre ? Prisma.sql`AND (EXISTS (SELECT 1 FROM "StaffAdvance" a WHERE a."workspaceId"=${workspaceId} AND a."depositId"=r.id AND a."costCentreId"=${centre}) OR EXISTS (SELECT 1 FROM "RecurringCostSchedule" s WHERE s."workspaceId"=${workspaceId} AND s."costCentreId"=${centre} AND (s."depositId"=r.id OR r."recordKey"='emi:'||s.id)))` : Prisma.empty}
    ) SELECT month AS name,coalesce(sum(amount) FILTER(WHERE amount>0),0)::bigint AS "incomeMinor",
      coalesce(-sum(amount) FILTER(WHERE amount<0),0)::bigint AS "expenseMinor",sum(amount)::bigint AS "netMinor",count(*)::bigint AS count
      FROM cash GROUP BY month ORDER BY month`);
  return rows.map((r) => {
    const row = {
      name: r.name,
      incomeMinor: Number(r.incomeMinor),
      expenseMinor: Number(r.expenseMinor),
      netMinor: Number(r.netMinor),
      count: Number(r.count),
    };
    if (
      ![row.incomeMinor, row.expenseMinor, row.netMinor, row.count].every(
        Number.isSafeInteger,
      )
    )
      throw new FinanceError(
        "Narrow the report period to keep totals within range.",
      );
    return row;
  });
}
