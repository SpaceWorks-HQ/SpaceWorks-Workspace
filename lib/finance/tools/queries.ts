import "server-only";
import { monthlyCashFlow } from "@/lib/finance/recurring/cash-flow";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { dateOnly, localDate, monthKeys } from "@/lib/finance/dates";
import { canManageFinance } from "@/lib/roles";
import {
  possibleDuplicates,
  monthPeriod,
  monthSchema,
} from "@/lib/finance/tools-rules";
import {
  FinanceError,
  auditPayView,
  financeAccess,
  type FinanceActor,
} from "./access";
import { budgetActual } from "./service";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";

export const FINANCE_PAGE_SIZE = 40;
export type ToolSection =
  | "funds"
  | "budgets"
  | "bills"
  | "close"
  | "reports"
  | "payroll"
  | "disbursements"
  | "spending"
  | "receipt";
export type FinanceQuery = {
  month?: string;
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  centre?: string;
  currency?: string;
  page?: string;
  account?: string;
};
export function toolPeriod(actor: FinanceActor, query: FinanceQuery) {
  const month = monthSchema.safeParse(query.month);
  const key = month.success
    ? month.data
    : localDate(new Date(), actor.workspace.timezone).slice(0, 7);
  const period = monthPeriod(key);
  const valid = (v: string | undefined) =>
    v &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(+dateOnly(v)) &&
    dateOnly(v).toISOString().slice(0, 10) === v;
  const from = valid(query.from) ? query.from! : period.start,
    to = valid(query.to) ? query.to! : period.end;
  if (from > to)
    throw new FinanceError("Choose an end date after the start date.");
  const currency =
    query.currency && /^[A-Z]{3}$/.test(query.currency)
      ? query.currency
      : actor.workspace.currency;
  return { month: key, from, to, currency };
}
export async function financePickers(actor: FinanceActor, payroll = false) {
  await financeAccess(actor, payroll ? "PAY_VIEW" : "VIEW");
  const workspaceId = actor.workspace.id;
  const hidden = await hiddenTeamIds(workspaceId, {
    userId: actor.user.id,
    role: actor.membership.role,
  });
  const [funds, centres, accounts, categories, budgets, members, projects] =
    await Promise.all([
      prisma.financeFund.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
      }),
      prisma.financeCostCentre.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
      }),
      prisma.financeAccount.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
      }),
      prisma.financeCategory.findMany({
        where: { workspaceId, archivedAt: null },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true },
      }),
      prisma.budget.findMany({
        where: { workspaceId },
        orderBy: { periodStart: "desc" },
        select: { id: true, name: true, currency: true },
      }),
      prisma.membership.findMany({
        where: { workspaceId, status: "ACTIVE", user: { disabledAt: null } },
        orderBy: { user: { name: "asc" } },
        select: { userId: true, role: true, user: { select: { name: true } } },
      }),
      prisma.project.findMany({
        where: {
          workspaceId,
          status: { not: "ARCHIVED" },
          ...teamScopeFilter(hidden),
        },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
    ]);
  return {
    funds,
    centres,
    accounts: accounts.map((a) => ({
      ...a,
      openingOn: a.openingOn.toISOString().slice(0, 10),
      reconciledUpTo: a.reconciledUpTo?.toISOString().slice(0, 10) ?? null,
    })),
    categories,
    budgets,
    members: members.map((m) => ({
      id: m.userId,
      name: m.user.name ?? "Former member",
      role: m.role,
    })),
    projects,
  };
}
export type FinancePickers = Awaited<ReturnType<typeof financePickers>>;

export async function reportEntries(actor: FinanceActor, query: FinanceQuery) {
  const access = await financeAccess(actor);
  const p = toolPeriod(actor, query);
  const where: Prisma.LedgerEntryWhereInput = {
    workspaceId: actor.workspace.id,
    voidedAt: null,
    currency: p.currency,
    occurredOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
    ...(query.centre ? { costCentreId: query.centre } : {}),
    privatePayroll: false,
    ...(query.q
      ? {
          OR: [
            {
              description: {
                contains: query.q.slice(0, 120),
                mode: "insensitive",
              },
            },
            {
              counterparty: {
                contains: query.q.slice(0, 120),
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };
  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
    take: 20001,
    include: {
      category: { select: { name: true } },
      costCentre: { select: { name: true } },
      fund: { select: { name: true } },
      account: { select: { name: true } },
      receiptFile: { select: { id: true, filename: true, deletedAt: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (entries.length > 20000)
    throw new FinanceError(
      "This period has more than 20,000 entries. Choose a shorter period.",
    );
  const payments = await prisma.financeBillPayment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      id: {
        in: entries
          .filter((e) => e.sourceType === "finance_bill_payment")
          .map((e) => e.sourceId!),
      },
    },
    select: { id: true, billId: true },
  });
  const billId = new Map(payments.map((p) => [p.id, p.billId]));
  const [attachments, purchases, claims] = await Promise.all([
    prisma.financeAttachment.findMany({
      where: {
        workspaceId: actor.workspace.id,
        OR: [
          { recordType: "LEDGER", recordId: { in: entries.map((e) => e.id) } },
          {
            recordType: "BILL",
            recordId: { in: payments.map((p) => p.billId) },
          },
          {
            recordType: "DISBURSEMENT",
            recordId: {
              in: entries
                .filter((e) => e.sourceType === "finance_disbursement")
                .map((e) => e.sourceId!),
            },
          },
        ],
        file: { deletedAt: null },
      },
      select: {
        recordType: true,
        recordId: true,
        file: { select: { id: true, filename: true, contentType: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: {
          in: entries
            .filter((e) => e.sourceType === "purchase_request")
            .map((e) => e.sourceId!),
        },
      },
      select: { id: true, fileIds: true, requesterId: true },
    }),
    prisma.reimbursement.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: {
          in: entries
            .filter((e) => e.sourceType === "reimbursement")
            .map((e) => e.sourceId!),
        },
      },
      select: { id: true, receiptFileIds: true, claimantId: true },
    }),
  ]);
  const sourceFiles = new Map([
    ...purchases.map(
      (r) => [r.id, { owner: r.requesterId, ids: r.fileIds }] as const,
    ),
    ...claims.map(
      (r) => [r.id, { owner: r.claimantId, ids: r.receiptFileIds }] as const,
    ),
  ]);
  const extraFiles = await prisma.fileObject.findMany({
    where: {
      workspaceId: actor.workspace.id,
      id: { in: [...sourceFiles.values()].flatMap((r) => r.ids) },
      deletedAt: null,
    },
    select: { id: true, filename: true, contentType: true },
  });
  const extraById = new Map(extraFiles.map((f) => [f.id, f]));
  const byRecord = new Map<string, typeof extraFiles>();
  for (const a of attachments) {
    const key = `${a.recordType}:${a.recordId}`,
      files = byRecord.get(key) ?? [];
    files.push(a.file);
    byRecord.set(key, files);
  }
  const controlProofs = await prisma.moneyControlAttachment.findMany({where:{workspaceId:actor.workspace.id,recordId:{in:entries.filter(e=>["cash_voucher","asset_disposal"].includes(e.sourceType??"")).map(e=>e.sourceId!)},file:{deletedAt:null},record:{payroll:false}},select:{recordId:true,file:{select:{id:true,filename:true,contentType:true}}}});
  const receiptsFor = (e: (typeof entries)[number]) => {
    const files = [
      ...(canManageFinance(access.member) && ["cash_voucher","asset_disposal"].includes(e.sourceType??"") ? controlProofs.filter(f=>f.recordId===e.sourceId).map(f=>f.file) : []),
      ...(byRecord.get(`LEDGER:${e.id}`) ?? []),
      ...(e.sourceType === "finance_bill_payment"
        ? (byRecord.get(`BILL:${billId.get(e.sourceId!)}`) ?? [])
        : []),
      ...(e.sourceType === "finance_disbursement"
        ? (byRecord.get(`DISBURSEMENT:${e.sourceId}`) ?? [])
        : []),
    ];
    const source = e.sourceId ? sourceFiles.get(e.sourceId) : null;
    const allowed =
      !source ||
      access.member.role === "ADMIN" ||
      access.member.role === "OWNER" ||
      source.owner === actor.user.id;
    if (source && allowed)
      for (const id of source.ids) {
        const file = extraById.get(id);
        if (file) files.push(file);
      }
    if (
      allowed &&
      e.receiptFile &&
      !e.receiptFile.deletedAt &&
      !files.some((f) => f.id === e.receiptFile!.id)
    )
      files.push({ ...e.receiptFile, contentType: "application/pdf" });
    return [...new Map(files.map((f) => [f.id, f])).values()];
  };
  return {
    access,
    period: p,
    entries: entries.map((e) => ({ ...e, hasControlProof: ["cash_voucher","asset_disposal"].includes(e.sourceType??"") && controlProofs.some(f=>f.recordId===e.sourceId), receipts: receiptsFor(e) })),
  };
}
export function groupMoney<T extends { kind: string; amountMinor: number }>(
  entries: T[],
  key: (entry: T) => string,
): Array<{
  name: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  count: number;
}>;
export function groupMoney<T extends { kind: string; amountMinor: number }>(
  entries: T[],
  key: (entry: T) => string,
) {
  const groups = new Map<
    string,
    {
      name: string;
      incomeMinor: number;
      expenseMinor: number;
      netMinor: number;
      count: number;
    }
  >();
  for (const e of entries) {
    const name = key(e);
    const g = groups.get(name) ?? {
      name,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      count: 0,
    };
    if (e.kind === "INCOME") g.incomeMinor += e.amountMinor;
    else g.expenseMinor += e.amountMinor;
    g.count++;
    g.netMinor = g.incomeMinor - g.expenseMinor;
    groups.set(name, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.expenseMinor + b.incomeMinor - (a.expenseMinor + a.incomeMinor),
  );
}
export async function financeReports(actor: FinanceActor, query: FinanceQuery) {
  const { entries, period } = await reportEntries(actor, query);
  const budgets = await prisma.budget.findMany({
    where: {
      workspaceId: actor.workspace.id,
      currency: period.currency,
      periodStart: { lte: dateOnly(period.to) },
      periodEnd: { gte: dateOnly(period.from) },
      ...(query.centre ? { costCentreId: query.centre } : {}),
    },
    orderBy: { name: "asc" },
  });
  const budgetRows = await Promise.all(
    budgets.map(async (b) => ({
      ...b,
      actualMinor: await budgetActual(prisma, b),
    })),
  );
  return {
    period,
    entries,
    incomeBySource: groupMoney(
      entries.filter((e) => e.kind === "INCOME"),
      (e) => e.incomeSource,
    ),
    incomeByFunder: groupMoney(
      entries.filter((e) => e.kind === "INCOME"),
      (e) => e.counterparty ?? "Not recorded",
    ),
    spendingByCategory: groupMoney(
      entries.filter((e) => e.kind === "EXPENSE"),
      (e) => e.category?.name ?? "Uncategorised",
    ),
    spendingByVendor: groupMoney(
      entries.filter((e) => e.kind === "EXPENSE"),
      (e) => e.counterparty ?? "Not recorded",
    ),
    centres: groupMoney(entries, (e) => e.costCentre?.name ?? "No cost centre"),
    monthly: await monthlyCashFlow(actor.workspace.id,period,query.centre),
    budgets: budgetRows,
    disbursementPurposes: groupMoney(
      entries.filter((e) => e.sourceType === "finance_disbursement"),
      (e) => e.purpose ?? e.description,
    ),
    disbursementCentres: groupMoney(
      entries.filter((e) => e.sourceType === "finance_disbursement"),
      (e) => e.costCentre?.name ?? "No cost centre",
    ),
  };
}
export async function spendingReview(actor: FinanceActor, query: FinanceQuery) {
  const selected = toolPeriod(actor, query);
  const period = monthPeriod(selected.month);
  const current = await financeReports(actor, {
    ...query,
    from: period.start,
    to: period.end,
  });
  const previousMonth = monthKeys(`${current.period.month}-01`, 2)[0]!;
  const previous = await reportEntries(actor, {
    month: previousMonth,
    currency: current.period.currency,
    centre: query.centre,
    q: query.q,
  });
  const expenses = current.entries.filter((e) => e.kind === "EXPENSE");
  const rules = await prisma.financeReviewRule.findMany({
    where: {
      workspaceId: actor.workspace.id,
      currency: current.period.currency,
    },
  });
  const review = await prisma.financeMonth.findUnique({
    where: {
      workspaceId_month: {
        workspaceId: actor.workspace.id,
        month: current.period.month,
      },
    },
  });
  // Include seven days before the period for duplicate pairs crossing a month boundary.
  const lookback = new Date(+dateOnly(current.period.from) - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const duplicateEntries = await reportEntries(actor, {
    ...query,
    from: lookback,
    to: current.period.to,
    currency: current.period.currency,
  });
  const duplicates = possibleDuplicates(
    duplicateEntries.entries.filter((e) => e.kind === "EXPENSE"),
  ).filter((pair) => pair.some((id) => expenses.some((e) => e.id === id)));
  return {
    ...current,
    previous: previous.entries.filter((e) => e.kind === "EXPENSE"),
    byPerson: groupMoney(expenses, (e) => e.createdBy?.name ?? "Former member"),
    missingReceipts: expenses.filter((e) => !e.receipts.length && !e.hasControlProof),
    biggest: [...expenses]
      .sort((a, b) => b.amountMinor - a.amountMinor)
      .slice(0, 10),
    duplicates,
    duplicateEntries: duplicateEntries.entries,
    overThreshold: expenses.filter((e) =>
      rules.some(
        (r) =>
          r.categoryId === e.categoryId && e.amountMinor > r.thresholdMinor,
      ),
    ),
    rules,
    review,
  };
}
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
            where: { workspaceId, name: { contains: q, mode: "insensitive" } },
            orderBy: { name: "asc" },
            ...paging,
          })
        : [],
      section === "budgets"
        ? prisma.budget.findMany({
            where: { workspaceId, name: { contains: q, mode: "insensitive" } },
            orderBy: { periodStart: "desc" },
            ...paging,
          })
        : [],
      section === "bills"
        ? prisma.financeBill.findMany({
            where: {
              workspaceId,
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
              ...(query.account ? { accountId: query.account } : {}),
            },
            orderBy: { createdAt: "desc" },
            take: 40,
            include: { account: { select: { name: true, currency: true } } },
          })
        : [],
    ]);
  const actualBudgets = await Promise.all(
    budgets
      .slice(0, FINANCE_PAGE_SIZE)
      .map(async (b) => ({ ...b, actualMinor: await budgetActual(prisma, b) })),
  );
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
export async function payrollData(actor: FinanceActor, query: FinanceQuery) {
  const { payrollManage } = await financeAccess(actor, "PAY_VIEW");
  const p = toolPeriod(actor, query),
    workspaceId = actor.workspace.id;
  return prisma.$transaction(
    async (tx) => {
      await financeAccess(actor, "PAY_VIEW", tx);
      const profiles = await tx.financePayProfile.findMany({
        where: { workspaceId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          userId: true,
          kind: true,
          currency: true,
          rateMinor: true,
          rateBasis: true,
          pfApplicable: true,
          esiApplicable: true,
          ptApplicable: true,
          tdsSection: true,
          costCentreId: true,
          archivedAt: true,
        },
      });
      const runs = await tx.financePayRun.findMany({
        where: { workspaceId, month: p.month },
        include: { profile: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      });
      // Audit every viewed record inside the transaction before returning any salary data.
      for (const profile of profiles)
        await auditPayView(actor, "pay_profile", profile.id, tx);
      for (const run of runs) await auditPayView(actor, "pay_run", run.id, tx);
      return { profiles, runs, manage: payrollManage, period: p };
    },
    { timeout: 30000 },
  );
}
