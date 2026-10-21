import "server-only";
import type { RecurringCostSchedule } from "@prisma/client";
import { monthlyEquivalent } from "../rules";

export const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? "";
export function scheduleCsvRow(s: RecurringCostSchedule) {
  return [
    s.title,
    s.kind,
    s.payee,
    s.status,
    s.currency,
    s.amountMinor,
    s.estimated ? "Estimate" : "Fixed",
    s.frequency,
    monthlyEquivalent(s.amountMinor, s.frequency),
    iso(s.nextDueOn),
    s.fundId,
    s.costCentreId,
    s.gstPercent,
    s.tdsSection,
    s.tdsPercent,
    s.notes,
  ];
}
