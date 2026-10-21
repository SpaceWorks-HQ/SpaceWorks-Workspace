import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { formatDay } from "@/lib/finance/dates";
import { formatMoney } from "@/lib/format/money";
import { EditPanel, Empty } from "./FinanceToolPanels";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceBudgetsSection({ context }: { context: FinanceToolContext }) {
  const { data, slug, manage, budgetFields } = context;
  return (
    <>
      {!data.budgets.length ? (
        <Empty
          text="No budgets yet. Plan a month or a year."
          add={manage ? "Add a budget line" : "Open requests"}
          href={manage ? "#add-record" : `/w/${slug}/requests`}
        />
      ) : null}
      {data.budgets.map((b) => (
        <Card key={b.id} id={b.id}>
          <CardHeader
            title={b.name}
            description={`${formatDay(b.periodStart)} to ${formatDay(b.periodEnd)}`}
            action={
              <Chip
                tone={
                  b.actualMinor >= b.amountMinor
                    ? "danger"
                    : b.actualMinor >= b.amountMinor * 0.8
                      ? "warning"
                      : "neutral"
                }
              >
                {b.actualMinor >= b.amountMinor
                  ? "At or over budget"
                  : b.actualMinor >= b.amountMinor * 0.8
                    ? "80% used"
                    : "Within budget"}
              </Chip>
            }
          />
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              ["Budget", b.amountMinor],
              ["Actual", b.actualMinor],
              ["Remaining", b.amountMinor - b.actualMinor],
            ].map(([name, value]) => (
              <div key={name}>
                <dt className="text-ink-muted">{name}</dt>
                <dd className="text-title tabular-nums">
                  {formatMoney(Number(value), b.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 whitespace-pre-wrap text-ink-muted">
            {b.varianceNote ?? "No variance note."}
          </p>
          {manage ? (
            <div className="mt-4">
              <EditPanel title="Edit budget or variance note">
                <ToolForm
                  slug={slug}
                  operation="budget"
                  fields={budgetFields(b)}
                  button="Save budget"
                />
              </EditPanel>
            </div>
          ) : null}
        </Card>
      ))}
      {manage ? (
        <div id="add-record">
          <EditPanel title="Add a budget line">
            <ToolForm
              slug={slug}
              operation="budget"
              fields={budgetFields()}
              button="Add budget line"
              reset
            />
          </EditPanel>
        </div>
      ) : null}
    </>
  );
}
