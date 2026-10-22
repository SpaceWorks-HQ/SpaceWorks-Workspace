import "server-only";
import type { FinanceActor } from "../access";
import { FinanceError } from "../access";
import type { FinanceQuery, toolPeriod } from "../queries";

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
export function capped<T>(rows: T[]) {
  if (rows.length > 20000)
    throw new FinanceError(
      "This export has more than 20,000 records. Choose a shorter period.",
    );
  return rows;
}

export type ExportContext = {
  actor: FinanceActor;
  query: FinanceQuery;
  p: ReturnType<typeof toolPeriod>;
  workspaceId: string;
  c: string;
  m: (v: number) => string;
};
