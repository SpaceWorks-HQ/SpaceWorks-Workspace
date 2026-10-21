import "server-only";
import {
  dateOnly,
  localDate,
} from "@/lib/finance/dates";
import {
  monthPeriod,
  monthSchema,
} from "@/lib/finance/tools-rules";
import {
  FinanceError,
  type FinanceActor,
} from "@/lib/finance/tools/access";

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
  record?: string;
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
