import { Card, CardHeader, Chip } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import type { FinanceReportsView } from "@/lib/finance/tools/views";
import { ToolForm } from "./ToolForm";
import { hidden, currencyField, money } from "./ToolFields";
import { EditPanel } from "./FinanceToolScreen";
import { GroupTable, byName } from "./FinanceReportGroupTable";

type SpendingReview = Extract<FinanceReportsView["data"], { duplicates: unknown }>;

export function FinanceSpendingReview({ review, view, slug, page, exp }: {
  review: SpendingReview;
  view: FinanceReportsView;
  slug: string;
  page: number;
  exp: (kind: string) => string;
}) {
  const { data, pickers: p, manage } = view;
  const c = data.period.currency;
  return (
    <>
      <GroupTable
        title="Spending by person who logged it"
        rows={review.byPerson}
        currency={c}
        previous={byName(
          review.previous,
          (e) => e.createdBy?.name ?? "Former member",
        )}
      />
      <Card>
        <CardHeader title="Biggest expenses" />
        <ol className="divide-y divide-line">
          {review.biggest.map((e) => (
            <li key={e.id} className="py-3">
              {e.description} · {e.counterparty ?? "No vendor"} ·{" "}
              {formatMoney(e.amountMinor, c)}
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <CardHeader
          title={`Missing receipts (${review.missingReceipts.length})`}
          description="Add proof to the entry, or remind the person who logged it."
        />
        {review.missingReceipts
          .slice((page - 1) * 40, page * 40)
          .map((e) => (
            <div
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
              key={e.id}
            >
              <div>
                <p>
                  {e.description} · {formatMoney(e.amountMinor, c)}
                </p>
                <p className="text-ink-muted">
                  {e.createdBy?.name ?? "Former member"}
                </p>
              </div>
              {manage ? (
                <ToolForm
                  slug={slug}
                  operation="remind"
                  fields={[hidden("entryId", e.id)]}
                  button="Send receipt reminder"
                />
              ) : null}
            </div>
          ))}
        {!review.missingReceipts.length ? (
          <p className="text-ink-muted">
            Every expense has proof attached.
          </p>
        ) : null}
        <a
          href={exp("missing-receipts")}
          className={buttonClasses({ variant: "quiet" })}
        >
          Export missing receipts CSV
        </a>
      </Card>
      <Card>
        <CardHeader
          title="Possible duplicates"
          description="A matching invoice number, or the same vendor and amount within seven days, needs a second look."
        />
        {review.duplicates.length ? (
          <ul className="divide-y divide-line">
            {review.duplicates.map((pair) => (
              <li className="py-3" key={pair.join(":")}>
                {pair.map((id) => {
                  const e = review.duplicateEntries.find(
                    (e) => e.id === id,
                  );
                  return (
                    <p key={id}>
                      {e
                        ? `${e.description} · ${e.counterparty ?? "No vendor"} · ${formatMoney(e.amountMinor, c)} · ${formatDay(e.occurredOn)}`
                        : "Earlier entry"}
                    </p>
                  );
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">No possible duplicates found.</p>
        )}
      </Card>
      <Card>
        <CardHeader title="Expenses needing a second look" />
        {review.overThreshold.length ? (
          <ul>
            {review.overThreshold.map((e) => (
              <li key={e.id} className="py-2">
                {e.description} · {formatMoney(e.amountMinor, c)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">
            No expenses above the category thresholds.
          </p>
        )}
        {manage ? (
          <EditPanel title="Set a category review threshold">
            <ToolForm
              slug={slug}
              operation="threshold"
              fields={[
                currencyField(c),
                {
                  name: "categoryId",
                  label: "Expense category",
                  type: "select",
                  required: true,
                  options: p.categories.filter((c) => c.kind === "EXPENSE"),
                },
                money(
                  "thresholdMinor",
                  "Ask for a second look above",
                  "",
                  true,
                ),
              ]}
              button="Save threshold"
            />
          </EditPanel>
        ) : null}
      </Card>
      <Card>
        <CardHeader
          title="Monthly spending sign-off"
          action={
            <Chip
              tone={review.review?.reviewSignedAt ? "success" : "neutral"}
            >
              {review.review?.reviewSignedAt ? "Reviewed" : "To review"}
            </Chip>
          }
        />
        <p className="text-ink-muted">
          Check the category totals, missing receipts, possible duplicates
          and budget warnings before signing.
        </p>
        {review.review?.reviewNotes ? (
          <p className="my-3 whitespace-pre-wrap">
            {review.review.reviewNotes}
          </p>
        ) : null}
        {manage ? (
          <ToolForm
            slug={slug}
            operation="review"
            fields={[
              hidden("month", data.period.month),
              {
                name: "notes",
                label: "Review notes and follow-ups",
                type: "textarea",
                value: review.review?.reviewNotes ?? "",
              },
            ]}
            button="Sign off spending review"
          />
        ) : null}
      </Card>
    </>
  );
}
