import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { FinanceFilters } from "./FinanceFilters";
import { options } from "./ToolFields";
import { financeToolContext } from "./financeToolContext";
import type { FinanceQuery, ToolSection } from "@/lib/finance/tools/queries";
import type { FinanceToolView } from "@/lib/finance/tools/views";
import type { FinanceActor } from "@/lib/finance/tools/access";
import { FinanceFundsSection } from "./FinanceFundsSection";
import { FinanceBudgetsSection } from "./FinanceBudgetsSection";
import { FinanceBillsSection } from "./FinanceBillsSection";
import { FinanceCloseSection } from "./FinanceCloseSection";
import { FinanceDisbursementsSection } from "./FinanceDisbursementsSection";

export { EditPanel, AttachedFiles } from "./FinanceToolPanels";

export function FinanceToolScreen({
  actor,
  section,
  query,
  view,
}: {
  actor: FinanceActor;
  section: Extract<
    ToolSection,
    "funds" | "budgets" | "bills" | "close" | "disbursements"
  >;
  query: FinanceQuery;
  view: FinanceToolView;
}) {
  const context = financeToolContext(actor, view);
  const { data, currency } = context;
  const heading = {
    funds: [
      "Funds and cost centres",
      "Keep restricted money and programme spending clear.",
    ],
    budgets: [
      "Budgets",
      "Plan by category and period. Actuals come from the ledger.",
    ],
    bills: ["Supplier bills", "Record bills, due dates and payments."],
    close: [
      "Month-end",
      "Check the month, compare bank balances and sign off.",
    ],
    disbursements: [
      "Disbursements",
      "Record approved payouts and settle staff advances.",
    ],
  }[section];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-h2">{heading[0]}</h2>
        <p className="text-body-ui text-ink-muted">{heading[1]}</p>
      </div>
      <FinanceFilters
        query={{ ...query, month: data.period.month }}
        month={section === "close" || section === "budgets"}
        currency={section === "funds" ? currency : undefined}
        statuses={
          section === "bills"
            ? [
                { id: "unpaid", name: "Unpaid" },
                { id: "partly", name: "Partly paid" },
                { id: "paid", name: "Paid" },
                { id: "overdue", name: "Overdue" },
              ]
            : section === "disbursements"
              ? options(["DRAFT", "PENDING", "PAID"])
              : []
        }
      />
      {section === "funds" ? <FinanceFundsSection context={context} /> : null}
      {section === "budgets" ? <FinanceBudgetsSection context={context} /> : null}
      {section === "bills" ? <FinanceBillsSection context={context} /> : null}
      {section === "close" ? <FinanceCloseSection context={context} /> : null}
      {section === "disbursements" ? <FinanceDisbursementsSection context={context} /> : null}
      <nav
        aria-label="Finance list pages"
        className="flex flex-wrap justify-between gap-3"
      >
        {data.page > 1 ? (
          <Link
            href={`?${new URLSearchParams({ ...query, page: String(data.page - 1) } as Record<string, string>)}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Previous page
          </Link>
        ) : (
          <span />
        )}
        {data.hasNext ? (
          <Link
            href={`?${new URLSearchParams({ ...query, page: String(data.page + 1) } as Record<string, string>)}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Next page
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
