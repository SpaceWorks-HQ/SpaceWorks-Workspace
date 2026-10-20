import "server-only";
import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/finance/csv";
import { minorToDecimalString } from "@/lib/finance/money";
import { isoDay, dateOnly } from "@/lib/finance/dates";
import { billStatus } from "@/lib/finance/tools-rules";
import { FinanceError, financeAccess, type FinanceActor } from "./access";
import {
  financeReports,
  payrollData,
  spendingReview,
  toolPeriod,
  type FinanceQuery,
} from "./queries";
import { budgetActual } from "./service";

export const EXPORT_KINDS = [
  "entries",
  "bills",
  "funds",
  "budgets",
  "income-sources",
  "income-funders",
  "spending-categories",
  "spending-vendors",
  "centres",
  "cash-flow",
  "missing-receipts",
  "payroll",
  "statutory",
  "disbursements",
  "disbursement-purposes",
  "disbursement-centres",
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
function capped<T>(rows: T[]) {
  if (rows.length > 20000)
    throw new FinanceError(
      "This export has more than 20,000 records. Choose a shorter period.",
    );
  return rows;
}
export async function financeCsv(
  actor: FinanceActor,
  kind: ExportKind,
  query: FinanceQuery,
) {
  const payroll = kind === "payroll" || kind === "statutory";
  await financeAccess(actor, payroll ? "PAY_VIEW" : "VIEW");
  const p = toolPeriod(actor, query),
    workspaceId = actor.workspace.id,
    c = p.currency,
    m = (v: number) => minorToDecimalString(v, c);
  if (payroll) {
    const data = await payrollData(actor, query),
      runs = data.runs.filter((r) => r.currency === c);
    if (kind === "statutory")
      return toCsv([
        ["Month", "Currency", "PF", "ESI", "Professional tax", "TDS"],
        [
          p.month,
          c,
          ...["pfMinor", "esiMinor", "ptMinor", "tdsMinor"].map((k) =>
            m(runs.reduce((n, r) => n + r[k as "pfMinor"], 0)),
          ),
        ],
      ]);
    return toCsv([
      [
        "Month",
        "Person",
        "Status",
        "Currency",
        "Gross",
        "Allowances",
        "PF",
        "ESI",
        "Professional tax",
        "TDS",
        "Advances recovered",
        "Other deductions",
        "Net",
        "Cost centre",
        "Paid date",
        "Payment reference",
        "Posted",
      ],
      ...capped(runs).map((r) => [
        r.month,
        r.profile.name,
        r.status,
        c,
        m(r.grossMinor),
        m(r.allowancesMinor),
        m(r.pfMinor),
        m(r.esiMinor),
        m(r.ptMinor),
        m(r.tdsMinor),
        m(r.advancesMinor),
        m(r.otherMinor),
        m(r.netMinor),
        r.costCentreId,
        r.paidOn ? isoDay(r.paidOn) : "",
        r.reference,
        r.ledgerEntryId ? "Yes" : "No",
      ]),
    ]);
  }
  if (kind === "bills") {
    const bills = capped(
      await prisma.financeBill.findMany({
        where: {
          workspaceId,
          privatePayroll: false,
          currency: c,
          issuedOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
          ...(query.centre ? { costCentreId: query.centre } : {}),
        },
        orderBy: { issuedOn: "asc" },
        take: 20001,
        include: { payments: { orderBy: { paidOn: "asc" } } },
      }),
    );
    return toCsv([
      [
        "Vendor",
        "Bill number",
        "Bill date",
        "Due date",
        "Currency",
        "Amount",
        "Paid",
        "Unpaid",
        "Status",
        "GSTIN or tax ID",
        "Taxable value",
        "CGST",
        "SGST",
        "IGST",
        "TDS",
        "Purpose",
        "Cost centre ID",
        "Fund ID",
        "Payment dates",
        "Payment references",
      ],
      ...bills.map((b) => [
        b.vendor,
        b.number,
        isoDay(b.issuedOn),
        isoDay(b.dueOn),
        c,
        m(b.amountMinor),
        m(b.paidMinor),
        m(b.amountMinor - b.paidMinor),
        billStatus(b.amountMinor, b.paidMinor),
        b.gstin,
        m(b.taxableMinor),
        m(b.cgstMinor),
        m(b.sgstMinor),
        m(b.igstMinor),
        m(b.tdsMinor),
        b.purpose,
        b.costCentreId,
        b.fundId,
        b.payments.map((a) => isoDay(a.paidOn)).join("; "),
        b.payments.map((a) => a.reference).join("; "),
      ]),
    ]);
  }
  if (kind === "funds") {
    const funds = capped(
      await prisma.financeFund.findMany({
        where: { workspaceId, currency: c },
        orderBy: { name: "asc" },
        take: 20001,
      }),
    );
    const rows = await Promise.all(
      funds.map(async (f) => {
        const sum = await prisma.ledgerEntry.groupBy({
          by: ["kind"],
          where: {
            workspaceId,
            fundId: f.id,
            currency: c,
            voidedAt: null,
            occurredOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
          },
          _sum: { amountMinor: true },
        });
        const opening = await prisma.ledgerEntry.groupBy({
          by: ["kind"],
          where: {
            workspaceId,
            fundId: f.id,
            currency: c,
            voidedAt: null,
            occurredOn: { lt: dateOnly(p.from) },
          },
          _sum: { amountMinor: true },
        });
        const net = opening.reduce(
            (n, r) =>
              n + (r.kind === "INCOME" ? 1 : -1) * (r._sum.amountMinor ?? 0),
            0,
          ),
          income = sum.find((r) => r.kind === "INCOME")?._sum.amountMinor ?? 0,
          expense =
            sum.find((r) => r.kind === "EXPENSE")?._sum.amountMinor ?? 0;
        return [
          f.name,
          f.restricted ? "Restricted" : "Unrestricted",
          f.funder,
          c,
          p.from,
          p.to,
          m(net),
          m(income),
          m(expense),
          m(net + income - expense),
        ];
      }),
    );
    return toCsv([
      [
        "Fund",
        "Restriction",
        "Funder",
        "Currency",
        "From",
        "To",
        "Opening",
        "Money in",
        "Money spent",
        "Closing",
      ],
      ...rows,
    ]);
  }
  if (kind === "budgets") {
    const budgets = capped(
      await prisma.budget.findMany({
        where: {
          workspaceId,
          currency: c,
          periodStart: { lte: dateOnly(p.to) },
          periodEnd: { gte: dateOnly(p.from) },
          ...(query.centre ? { costCentreId: query.centre } : {}),
        },
        take: 20001,
        orderBy: { periodStart: "asc" },
      }),
    );
    const rows = await Promise.all(
      budgets.map(async (b) => {
        const actual = await budgetActual(prisma, b);
        return [
          b.name,
          isoDay(b.periodStart),
          isoDay(b.periodEnd),
          c,
          m(b.amountMinor),
          m(actual),
          m(actual - b.amountMinor),
          b.varianceNote,
          b.costCentreId,
          b.categories.join("; "),
        ];
      }),
    );
    return toCsv([
      [
        "Budget line",
        "Period start",
        "Period end",
        "Currency",
        "Budget",
        "Actual",
        "Variance actual minus budget",
        "Note",
        "Cost centre ID",
        "Category IDs",
      ],
      ...rows,
    ]);
  }
  if (kind.startsWith("disbursement")) {
    const rows = capped(
      await prisma.financeDisbursement.findMany({
        where: {
          workspaceId,
          currency: c,
          ...(kind === "disbursements"
            ? {
                OR: [
                  {
                    status: "PAID",
                    paidOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
                  },
                  {
                    status: { not: "PAID" },
                    createdAt: {
                      gte: dateOnly(p.from),
                      lt: new Date(+dateOnly(p.to) + 86400000),
                    },
                  },
                ],
              }
            : {
                status: "PAID",
                paidOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
              }),
          ...(query.centre ? { costCentreId: query.centre } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 20001,
      }),
    );
    if (kind === "disbursements")
      return toCsv([
        [
          "Payee",
          "Purpose",
          "Type",
          "Currency",
          "Total payout",
          "TDS",
          "Status",
          "Cost centre ID",
          "Paid date",
          "Reference",
          "Settled",
          "Unsettled",
        ],
        ...rows.map((r) => [
          r.payee,
          r.purpose,
          r.kind,
          c,
          m(r.amountMinor),
          m(r.tdsMinor),
          r.status,
          r.costCentreId,
          r.paidOn ? isoDay(r.paidOn) : "",
          r.reference,
          m(r.settledMinor),
          r.kind === "ADVANCE" ? m(r.amountMinor - r.settledMinor) : "",
        ]),
      ]);
    const centres = await prisma.financeCostCentre.findMany({
        where: { workspaceId },
        select: { id: true, name: true },
      }),
      groups = new Map<string, number>();
    for (const r of rows) {
      const key =
        kind === "disbursement-purposes"
          ? r.purpose
          : (centres.find((a) => a.id === r.costCentreId)?.name ??
            "No cost centre");
      groups.set(key, (groups.get(key) ?? 0) + r.amountMinor);
    }
    return toCsv([
      [
        kind === "disbursement-purposes" ? "Purpose" : "Programme",
        "Currency",
        "Total",
      ],
      ...[...groups].map(([name, value]) => [name, c, m(value)]),
    ]);
  }
  if (kind === "missing-receipts") {
    const data = await spendingReview(actor, query);
    return toCsv([
      ["Date", "Expense", "Vendor", "Currency", "Amount", "Logged by"],
      ...data.missingReceipts.map((e) => [
        isoDay(e.occurredOn),
        e.description,
        e.counterparty,
        c,
        m(e.amountMinor),
        e.createdBy?.name,
      ]),
    ]);
  }
  const data = await financeReports(actor, query);
  if (kind === "entries")
    return toCsv([
      [
        "Date",
        "Kind",
        "Amount",
        "Currency",
        "Category",
        "Description",
        "Vendor donor or funder",
        "Income source",
        "Purpose",
        "Invoice number",
        "Fund",
        "Cost centre",
        "Account",
        "GSTIN or tax ID",
        "Taxable",
        "CGST",
        "SGST",
        "IGST",
        "TDS",
        "Receipt links",
        "Extraction used",
        "Reconciled",
      ],
      ...data.entries.map((e) => [
        isoDay(e.occurredOn),
        e.kind,
        m(e.amountMinor),
        c,
        e.category?.name,
        e.description,
        e.counterparty,
        e.incomeSource,
        e.purpose,
        e.invoiceNumber,
        e.fund?.name,
        e.costCentre?.name,
        e.account?.name,
        e.gstin,
        m(e.taxableMinor),
        m(e.cgstMinor),
        m(e.sgstMinor),
        m(e.igstMinor),
        m(e.tdsMinor),
        e.receipts.map((f) => `/api/files/${f.id}`).join("; "),
        e.extractionUsed ? "Yes" : "No",
        e.reconciledAt ? "Yes" : "No",
      ]),
    ]);
  const groups = {
    "income-sources": data.incomeBySource,
    "income-funders": data.incomeByFunder,
    "spending-categories": data.spendingByCategory,
    "spending-vendors": data.spendingByVendor,
    centres: data.centres,
    "cash-flow": data.monthly,
  }[kind as "centres"];
  if (!groups) throw new FinanceError("Choose an available report.");
  return toCsv([
    [
      "Name",
      "From",
      "To",
      "Currency",
      "Money in",
      "Money out",
      "Net",
      "Entries",
    ],
    ...groups.map((r) => [
      r.name,
      p.from,
      p.to,
      c,
      m(r.incomeMinor),
      m(r.expenseMinor),
      m(r.netMinor),
      r.count,
    ]),
  ]);
}
