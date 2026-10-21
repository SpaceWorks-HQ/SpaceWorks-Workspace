import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { isoDay } from "@/lib/finance/dates";
import { type ExportContext, type ExportKind } from "./context";
import { FinanceError } from "../access";
import { financeReports, spendingReview } from "../queries";

export async function reportsCsv(context: ExportContext, kind: ExportKind) {
  const { actor, query, p, c, m } = context;
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
