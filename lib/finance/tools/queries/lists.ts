import "server-only";
import { budgetReportActuals } from "@/lib/finance/reportMetrics";
import { prisma } from "@/lib/db";
import {
  dateOnly,
  localDate,
} from "@/lib/finance/dates";
import { canManageFinance } from "@/lib/roles";
import {
  auditPayView,
  financeAccess,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  FINANCE_PAGE_SIZE,
  toolPeriod,
  type ToolSection,
  type FinanceQuery,
} from "./period";

export async function toolLists(
  actor: FinanceActor,
  section: ToolSection,
  query: FinanceQuery,
) {
  const access = await financeAccess(
    actor,
    section === "payroll" ? "PAY_VIEW" : "VIEW",
  );
  const workspaceId = actor.workspace.id;
  const period = toolPeriod(actor, query);
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(query.page ?? "1", 10) || 1),
  );
  const paging = {
    skip: (page - 1) * FINANCE_PAGE_SIZE,
    take: FINANCE_PAGE_SIZE + 1,
  };
  const q = query.q?.slice(0, 120) ?? "";
  const [funds, budgets, bills, disbursements, month, reconciliations] =
    await Promise.all([
      section === "funds"
        ? prisma.financeFund.findMany({
            where: {
              workspaceId,
              ...(query.record ? { id: query.record } : {}),
              name: { contains: q, mode: "insensitive" },
            },
            orderBy: { name: "asc" },
            ...paging,
          })
        : [],
      section === "budgets"
        ? prisma.budget.findMany({
            where: {
              workspaceId,
              ...(query.record ? { id: query.record } : {}),
              name: { contains: q, mode: "insensitive" },
            },
            orderBy: { periodStart: "desc" },
            ...paging,
          })
        : [],
      section === "bills"
        ? prisma.financeBill.findMany({
            where: {
              workspaceId,
            ...(query.record ? { id: query.record } : {}),
              privatePayroll: false,
              OR: [
                { vendor: { contains: q, mode: "insensitive" } },
                { number: { contains: q, mode: "insensitive" } },
              ],
              ...(query.status === "paid"
                ? {
                    paidMinor: {
                      equals: prisma.financeBill.fields.amountMinor,
                    },
                  }
                : query.status === "unpaid"
                  ? { paidMinor: 0 }
                  : query.status === "partly"
                    ? {
                        paidMinor: {
                          gt: 0,
                          lt: prisma.financeBill.fields.amountMinor,
                        },
                      }
                    : query.status === "overdue"
                      ? {
                          paidMinor: {
                            lt: prisma.financeBill.fields.amountMinor,
                          },
                          dueOn: {
                            lt: dateOnly(
                              localDate(new Date(), actor.workspace.timezone),
                            ),
                          },
                        }
                      : {}),
            },
            orderBy: [{ dueOn: "asc" }, { id: "asc" }],
            include: { payments: { orderBy: { paidOn: "desc" } } },
            ...paging,
          })
        : [],
      section === "disbursements"
        ? prisma.financeDisbursement.findMany({
            where: {
              workspaceId,
            ...(query.record ? { id: query.record } : {}),
              payee: { contains: q, mode: "insensitive" },
              ...(query.status ? { status: query.status } : {}),
            },
            orderBy: { createdAt: "desc" },
            ...paging,
          })
        : [],
      section === "close"
        ? prisma.financeMonth.findUnique({
            where: { workspaceId_month: { workspaceId, month: period.month } },
            include: { steps: { orderBy: { id: "asc" } } },
          })
        : null,
      section === "close"
        ? prisma.financeReconciliation.findMany({
            where: {
              workspaceId,
            ...(query.record ? { id: query.record } : {}),
              ...(query.account ? { accountId: query.account } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 40,
            include: { account: { select: { name: true, currency: true } } },
          })
        : [],
    ]);
  const budgetActuals = await budgetReportActuals(workspaceId, budgets.slice(0, FINANCE_PAGE_SIZE).map(b=>b.id));
  const actualBudgets = budgets.slice(0, FINANCE_PAGE_SIZE).map(b=>({...b,actualMinor:budgetActuals.get(b.id)??0}));
  const fundBalances = await Promise.all(
    funds.slice(0, FINANCE_PAGE_SIZE).map(async (f) => {
      const amounts = await prisma.ledgerEntry.groupBy({
        by: ["kind"],
        where: {
          workspaceId,
          fundId: f.id,
          voidedAt: null,
          currency: f.currency,
        },
        _sum: { amountMinor: true },
      });
      return {
        ...f,
        balanceMinor: amounts.reduce(
          (n, r) =>
            n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
          0,
        ),
      };
    }),
  );
  let cashSummary: {
    restrictedMinor: number;
    unrestrictedMinor: number;
    currency: string;
  } | null = null;
  if (section === "funds") {
    const all = await prisma.ledgerEntry.groupBy({
      by: ["kind"],
      where: { workspaceId, currency: period.currency, voidedAt: null },
      _sum: { amountMinor: true },
    });
    const restricted = await prisma.ledgerEntry.groupBy({
      by: ["kind"],
      where: {
        workspaceId,
        currency: period.currency,
        voidedAt: null,
        fund: { restricted: true },
      },
      _sum: { amountMinor: true },
    });
    const opening =
      (
        await prisma.financeAccount.aggregate({
          where: { workspaceId, currency: period.currency },
          _sum: { openingMinor: true },
        })
      )._sum.openingMinor ?? 0;
    const net = (rows: typeof all) =>
      rows.reduce(
        (n, r) =>
          n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
        0,
      );
    const cashMovements = await prisma.moneyControlMovement.aggregate({where:{workspaceId,currency:period.currency},_sum:{amountMinor:true}});
    cashSummary = {
      currency: period.currency,
      restrictedMinor: net(restricted),
      unrestrictedMinor: opening + net(all) + (cashMovements._sum.amountMinor ?? 0) - net(restricted),
    };
  }
  const accountEntries =
    section === "close"
      ? await prisma.ledgerEntry.findMany({
          where: {
            workspaceId,
            ...(query.record ? { id: query.record } : {}),
            voidedAt: null,
            privatePayroll: !access.payrollView ? false : undefined,
            ...(query.account ? { accountId: query.account } : {}),
            occurredOn: {
              gte: dateOnly(period.from),
              lte: dateOnly(period.to),
            },
          },
          orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
          ...paging,
          include: { account: { select: { name: true } } },
        })
      : [];
  if (
    section === "close" &&
    access.payrollView &&
    accountEntries.some((e) => e.privatePayroll)
  )
    await auditPayView(actor, "reconciliation_payroll", period.month);
  return {
    page,
    period,
    manage: canManageFinance(access.member),
    funds: fundBalances,
    budgets: actualBudgets,
    bills: bills.slice(0, FINANCE_PAGE_SIZE),
    disbursements: disbursements.slice(0, FINANCE_PAGE_SIZE),
    month,
    reconciliations: reconciliations.map((r) => ({
      ...r,
      ledgerMinor: Number(r.ledgerMinor),
    })),
    accountEntries: accountEntries.slice(0, FINANCE_PAGE_SIZE),
    cashSummary,
    hasNext: [funds, budgets, bills, disbursements, accountEntries].some(
      (a) => a.length > FINANCE_PAGE_SIZE,
    ),
  };
}
