import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { canViewFinance } from "@/lib/roles";
import { formatMoney } from "@/lib/format/money";
import { defineTool, plural } from "@/lib/assistant/tools/types";

/* ───────────── Finance (only when the caller may see the kitty) ───────────── */

export const financeSummary = defineTool({
  name: "sw_finance_summary",
  title: "Kitty summary",
  description: "Summarise income, expenses, categories and balance excluding private payroll payments. These totals are not the full bank balance.",
  input: z.object({ months: z.number().int().min(1).max(12).default(3) }),
  write: false,
  scope: "read:finance",
  minRole: "MEMBER",
  available: (principal) => canViewFinance(principal, principal.workspace),
  async run(ctx, input) {
    const { workspace } = ctx.principal;
    const since = new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth() - (input.months - 1), 1));
    const [months, categories, totals] = await Promise.all([
      prisma.$queryRaw<Array<{ month: string; kind: string; total: bigint }>>`
        SELECT to_char(date_trunc('month', "occurredOn"), 'YYYY-MM') AS month, "kind"::text AS kind, SUM("amountMinor")::bigint AS total
        FROM "LedgerEntry"
        WHERE "workspaceId" = ${workspace.id} AND "privatePayroll" = false AND "voidedAt" IS NULL AND "currency" = ${workspace.currency} AND "occurredOn" >= ${since}
        GROUP BY 1, 2 ORDER BY 1`,
      prisma.$queryRaw<Array<{ name: string | null; kind: string; total: bigint }>>`
        SELECT c."name" AS name, e."kind"::text AS kind, SUM(e."amountMinor")::bigint AS total
        FROM "LedgerEntry" e LEFT JOIN "FinanceCategory" c ON c."id" = e."categoryId"
        WHERE e."workspaceId" = ${workspace.id} AND e."privatePayroll" = false AND e."voidedAt" IS NULL AND e."currency" = ${workspace.currency} AND e."occurredOn" >= ${since}
        GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 12`,
      prisma.$queryRaw<Array<{ kind: string; total: bigint }>>`
        SELECT "kind"::text AS kind, SUM("amountMinor")::bigint AS total FROM "LedgerEntry"
        WHERE "workspaceId" = ${workspace.id} AND "privatePayroll" = false AND "voidedAt" IS NULL AND "currency" = ${workspace.currency}
        GROUP BY 1`,
    ]);
    const money = (minor: number) => formatMoney(minor, workspace.currency);
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const row of months) {
      const entry = byMonth.get(row.month) ?? { income: 0, expense: 0 };
      entry[row.kind === "INCOME" ? "income" : "expense"] += Number(row.total);
      byMonth.set(row.month, entry);
    }
    const income = Number(totals.find((t) => t.kind === "INCOME")?.total ?? 0);
    const expense = Number(totals.find((t) => t.kind === "EXPENSE")?.total ?? 0);
    return {
      summary: `Summarised finance excluding private payroll for ${plural(input.months, "month")}`,
      data: {
        currency: workspace.currency,
        excludesPrivatePayroll: true,
        balance: money(income - expense),
        months: [...byMonth.entries()].map(([month, v]) => ({ month, income: money(v.income), expenses: money(v.expense), net: money(v.income - v.expense) })),
        topCategories: categories.map((c) => ({ category: c.name ?? "Uncategorised", kind: c.kind.toLowerCase(), total: money(Number(c.total)) })),
      },
    };
  },
});
