import "server-only";
import { budgetActual } from "@/lib/finance/tools/service";

import { Prisma, type Workspace } from "@prisma/client";
import { prisma } from "@/lib/db";
import { dateOnly, localDate, monthKeys } from "@/lib/finance/dates";
import { LEDGER_PAGE_SIZE, type LedgerFilters } from "@/lib/finance/filters";
import type { LedgerKindValue } from "@/lib/finance/money";

/**
 * Finance reads. Callers have checked `canViewFinance`. Totals and balances
 * count non-voided entries in the workspace currency only (entries posted in
 * another currency are listed but never summed into the kitty).
 */

type Ws = Pick<Workspace, "id" | "currency" | "timezone">;

export function ledgerWhere(workspaceId: string, filters: Omit<LedgerFilters, "page">): Prisma.LedgerEntryWhereInput {
  const and: Prisma.LedgerEntryWhereInput[] = [];
  if (filters.q) {
    and.push({
      OR: [
        { description: { contains: filters.q, mode: "insensitive" } },
        { counterparty: { contains: filters.q, mode: "insensitive" } },
        { category: { name: { contains: filters.q, mode: "insensitive" } } },
      ],
    });
  }
  return {
    workspaceId,
    privatePayroll: false,
    ...(filters.recordId ? { id: filters.recordId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.from || filters.to ? { occurredOn: { ...(filters.from ? { gte: dateOnly(filters.from) } : {}), ...(filters.to ? { lte: dateOnly(filters.to) } : {}) } } : {}),
    ...(filters.includeVoided ? {} : { voidedAt: null }),
    ...(and.length ? { AND: and } : {}),
  };
}

export type LedgerRow = {
  id: string;
  kind: LedgerKindValue;
  amountMinor: number;
  currency: string;
  occurredOn: Date;
  description: string;
  counterparty: string | null;
  category: { id: string; name: string } | null;
  budget: { id: string; name: string } | null;
  receiptFileId: string | null;
  receiptName: string | null;
  sourceType: string | null;
  sourceId: string | null;
  voidedAt: Date | null;
  createdByName: string | null;
  /** Kitty balance right after this entry (null when voided or in another currency). */
  balanceMinor: number | null;
};

export async function listLedger(workspace: Ws, filters: LedgerFilters) {
  const where = ledgerWhere(workspace.id, filters);
  const [total, rows, sums] = await Promise.all([
    prisma.ledgerEntry.count({ where }),
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * LEDGER_PAGE_SIZE,
      take: LEDGER_PAGE_SIZE,
      include: {
        category: { select: { id: true, name: true } },
        budget: { select: { id: true, name: true } },
        receiptFile: { select: { filename: true, deletedAt: true } },
        createdBy: { select: { name: true } },
      },
    }),
    prisma.ledgerEntry.groupBy({ by: ["kind"], where: { AND: [where, { voidedAt: null, currency: workspace.currency }] }, _sum: { amountMinor: true }, _count: true }),
  ]);
  const balances = await runningBalanceFor(workspace, rows.map((row) => row.id));
  const income = sums.find((row) => row.kind === "INCOME");
  const expense = sums.find((row) => row.kind === "EXPENSE");
  const incomeMinor = income?._sum.amountMinor ?? 0;
  const expenseMinor = expense?._sum.amountMinor ?? 0;
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE)),
    totals: { incomeMinor, expenseMinor, netMinor: incomeMinor - expenseMinor, count: (income?._count ?? 0) + (expense?._count ?? 0) },
    rows: rows.map(
      (row): LedgerRow => ({
        id: row.id,
        kind: row.kind,
        amountMinor: row.amountMinor,
        currency: row.currency,
        occurredOn: row.occurredOn,
        description: row.description,
        counterparty: row.counterparty,
        category: row.category,
        budget: row.budget,
        receiptFileId: row.receiptFile && !row.receiptFile.deletedAt ? row.receiptFileId : null,
        receiptName: row.receiptFile && !row.receiptFile.deletedAt ? row.receiptFile.filename : null,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        voidedAt: row.voidedAt,
        createdByName: row.createdBy?.name ?? null,
        balanceMinor: balances.get(row.id) ?? null,
      }),
    ),
  };
}

/** Balance after each listed entry, over every counted entry in date order. */
async function runningBalanceFor(workspace: Ws, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ id: string; balance: bigint | number }>>`
    WITH ordered AS (
      SELECT "id",
             SUM(CASE WHEN "kind" = 'INCOME' THEN "amountMinor" ELSE -"amountMinor" END)
               OVER (ORDER BY "occurredOn", "createdAt", "id" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "balance"
      FROM "LedgerEntry"
      WHERE "workspaceId" = ${workspace.id} AND "voidedAt" IS NULL AND "currency" = ${workspace.currency}
    )
    SELECT "id", "balance" FROM ordered WHERE "id" IN (${Prisma.join(ids)})`;
  return new Map(rows.map((row) => [row.id, Number(row.balance)]));
}

export async function listCategories(workspaceId: string, options: { includeArchived?: boolean } = {}) {
  const categories = await prisma.financeCategory.findMany({
    where: { workspaceId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    select: { id: true, name: true, kind: true, archivedAt: true, _count: { select: { entries: true } } },
  });
  return categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: Boolean(c.archivedAt), entryCount: c._count.entries }));
}

/** Budgets that can take an entry (ops-money owns them; we only read). */
export async function listBudgetOptions(workspaceId: string) {
  return prisma.budget.findMany({ where: { workspaceId }, orderBy: [{ periodStart: "desc" }, { name: "asc" }], take: 100, select: { id: true, name: true, currency: true, periodStart: true, periodEnd: true } });
}

export async function getLedgerEntry(workspaceId: string, id: string) {
  return prisma.ledgerEntry.findFirst({
    where: { id, workspaceId, privatePayroll: false },
    include: { category: { select: { id: true, name: true } }, budget: { select: { id: true, name: true } }, receiptFile: { select: { id: true, filename: true, deletedAt: true } } },
  });
}

/** Entries for CSV export (same filters as the list, no paging, capped). */
export async function ledgerForExport(workspaceId: string, filters: Omit<LedgerFilters, "page">) {
  return prisma.ledgerEntry.findMany({
    where: ledgerWhere(workspaceId, filters),
    orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    take: 20_001,
    select: { occurredOn: true, kind: true, amountMinor: true, currency: true, description: true, counterparty: true, category: { select: { name: true } } },
  });
}

// ───────────── Summary ─────────────

export type MonthPoint = { month: string; label: string; incomeMinor: number; expenseMinor: number };

export async function getFinanceSummary(workspace: Ws, now = new Date()) {
  const today = localDate(now, workspace.timezone);
  const months = monthKeys(today, 12);
  const start = dateOnly(`${months[0]}-01`);
  const ninetyDaysAgo = dateOnly(new Date(dateOnly(today).getTime() - 90 * 86_400_000).toISOString().slice(0, 10));
  const counted = { workspaceId: workspace.id, voidedAt: null, currency: workspace.currency } as const;

  const [allTime, monthly, topCategories, budgets, outstanding, recent, otherCurrencies] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ["kind"], where: counted, _sum: { amountMinor: true } }),
    prisma.$queryRaw<Array<{ month: string; kind: LedgerKindValue; total: bigint | number }>>`
      SELECT to_char("occurredOn", 'YYYY-MM') AS "month", "kind"::text AS "kind", SUM("amountMinor")::bigint AS "total"
      FROM "LedgerEntry"
      WHERE "workspaceId" = ${workspace.id} AND "voidedAt" IS NULL AND "currency" = ${workspace.currency} AND "occurredOn" >= ${start}
      GROUP BY 1, 2`,
    prisma.ledgerEntry.groupBy({
      by: ["categoryId"],
      where: { ...counted, kind: "EXPENSE", occurredOn: { gte: ninetyDaysAgo } },
      _sum: { amountMinor: true },
      orderBy: { _sum: { amountMinor: "desc" } },
      take: 6,
    }),
    prisma.budget.findMany({
      where: { workspaceId: workspace.id, periodEnd: { gte: dateOnly(today) }, periodStart: { lte: dateOnly(today) } },
      orderBy: { periodEnd: "asc" },
      take: 8,
      select: { id: true, workspaceId: true, name: true, amountMinor: true, currency: true, periodStart: true, periodEnd: true, categories: true, costCentreId: true },
    }),
    prisma.invoice.aggregate({ where: { workspaceId: workspace.id, status: "SENT", currency: workspace.currency }, _sum: { totalMinor: true }, _count: true }),
    prisma.ledgerEntry.findMany({
      where: { workspaceId: workspace.id, voidedAt: null, privatePayroll: false },
      orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
      take: 5,
      select: { id: true, kind: true, amountMinor: true, currency: true, occurredOn: true, description: true, category: { select: { name: true } } },
    }),
    prisma.ledgerEntry.count({ where: { workspaceId: workspace.id, voidedAt: null, currency: { not: workspace.currency } } }),
  ]);

  const sum = (kind: LedgerKindValue) => allTime.find((row) => row.kind === kind)?._sum.amountMinor ?? 0;
  const byMonth = new Map<string, { incomeMinor: number; expenseMinor: number }>();
  for (const row of monthly) {
    const bucket = byMonth.get(row.month) ?? { incomeMinor: 0, expenseMinor: 0 };
    if (row.kind === "INCOME") bucket.incomeMinor += Number(row.total);
    else bucket.expenseMinor += Number(row.total);
    byMonth.set(row.month, bucket);
  }
  const monthLabel = (key: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(dateOnly(`${key}-01`));
  const series: MonthPoint[] = months.map((month) => ({ month, label: monthLabel(month), ...(byMonth.get(month) ?? { incomeMinor: 0, expenseMinor: 0 }) }));

  const categoryIds = topCategories.map((row) => row.categoryId).filter((id): id is string => Boolean(id));
  const names = new Map((await prisma.financeCategory.findMany({ where: { workspaceId: workspace.id, id: { in: categoryIds } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  const actuals = await Promise.all(budgets.map(async (budget) => [budget.id, await budgetActual(prisma, budget)] as const));
  const spent = new Map(actuals);
  const thisMonth = series[series.length - 1]!;

  return {
    today,
    balanceMinor: sum("INCOME") - sum("EXPENSE"),
    thisMonth,
    series,
    topCategories: topCategories.map((row) => ({ id: row.categoryId, name: row.categoryId ? (names.get(row.categoryId) ?? "Former category") : "Uncategorised", amountMinor: row._sum.amountMinor ?? 0 })),
    budgets: budgets.map((budget) => ({ ...budget, spentMinor: spent.get(budget.id) ?? 0 })),
    outstanding: { count: outstanding._count, totalMinor: outstanding._sum.totalMinor ?? 0 },
    recent,
    otherCurrencies,
  };
}

// ───────────── Invoices ─────────────

export async function listInvoices(workspaceId: string, status: "DRAFT" | "SENT" | "PAID" | "VOID" | null, page = 1) {
  const [invoices, counts] = await Promise.all([
    prisma.invoice.findMany({
      where: { workspaceId, ...(status ? { status } : {}) },
      orderBy: [{ issuedOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * 50,
      take: 50,
      select: { id: true, number: true, clientName: true, status: true, issuedOn: true, dueOn: true, totalMinor: true, currency: true, paidAt: true },
    }),
    prisma.invoice.groupBy({ by: ["status"], where: { workspaceId }, _count: true }),
  ]);
  const total = counts.filter((row) => !status || row.status === status).reduce((sum, row) => sum + row._count, 0);
  return { invoices, pageCount: Math.max(1, Math.ceil(total / 50)), counts: Object.fromEntries(counts.map((row) => [row.status, row._count])) as Partial<Record<"DRAFT" | "SENT" | "PAID" | "VOID", number>> };
}

export async function getInvoice(workspaceId: string, id: string) {
  const invoice = await prisma.invoice.findFirst({ where: { id, workspaceId }, include: { createdBy: { select: { name: true } } } });
  if (!invoice) return null;
  const ledgerEntry = await prisma.ledgerEntry.findFirst({ where: { workspaceId, sourceType: "invoice", sourceId: invoice.id }, select: { id: true, occurredOn: true, voidedAt: true } });
  return { ...invoice, ledgerEntry };
}
