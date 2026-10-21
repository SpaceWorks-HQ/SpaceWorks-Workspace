import "server-only";
import { toCsv } from "@/lib/finance/csv";
import { isoDay } from "@/lib/finance/dates";
import { capped, type ExportContext, type ExportKind } from "./context";
import { payrollData } from "../queries";

export async function payrollCsv(context: ExportContext, kind: ExportKind) {
  const { actor, query, p, c, m } = context;
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
