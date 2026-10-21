import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
/** One definition for reporting and analytics: category/centre selection takes precedence over explicit budget tagging. */
export function budgetActualSql(alias: "r" | "b" = "r") {
  const b = Prisma.raw(alias);
  return Prisma.sql`coalesce((SELECT sum(e."amountMinor"::bigint) FROM "LedgerEntry" e
 WHERE e."workspaceId"=${b}."workspaceId" AND e."voidedAt" IS NULL AND e.kind='EXPENSE' AND e.currency=${b}.currency
 AND e."occurredOn" BETWEEN ${b}."periodStart" AND ${b}."periodEnd"
 AND (CASE WHEN cardinality(${b}.categories)>0 OR ${b}."costCentreId" IS NOT NULL
 THEN (cardinality(${b}.categories)=0 OR e."categoryId"=ANY(${b}.categories)) AND (${b}."costCentreId" IS NULL OR e."costCentreId"=${b}."costCentreId")
 ELSE e."budgetId"=${b}.id END)),0)`;
}
export async function budgetReportActuals(
  workspaceId: string,
  ids: string[],
  client: DbClient = prisma,
): Promise<Map<string, number>> {
  if (!ids.length) return new Map<string, number>();
  const rows = await client.$queryRaw<{ id: string; actual: bigint }[]>(
    Prisma.sql`SELECT r.id,${budgetActualSql()}::bigint AS actual FROM "Budget" r WHERE r."workspaceId"=${workspaceId} AND r.id IN (${Prisma.join(ids)})`,
  );
  return new Map(
    rows.map((r) => {
      const value = Number(r.actual);
      if (!Number.isSafeInteger(value))
        throw new Error("Narrow the report to keep totals within range.");
      return [r.id, value];
    }),
  );
}
