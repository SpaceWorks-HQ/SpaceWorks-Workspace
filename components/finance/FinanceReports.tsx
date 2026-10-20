import Link from "next/link";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import type { FinanceActor } from "@/lib/finance/tools/access";
import type { FinanceReportsView } from "@/lib/finance/tools/views";
import { INCOME_SOURCES, label } from "@/lib/finance/tools-rules";
import { ToolForm } from "./ToolForm";
import { hidden, currencyField, money, options, tagFields } from "./ToolFields";
import { EditPanel, AttachedFiles } from "./FinanceToolScreen";
import { FilePreviews } from "./FinanceAttachments";
import { FinanceFilters } from "./FinanceFilters";
import { MonthlyChart } from "./MonthlyChart";
import { PrintButton } from "./PrintButton";
import { ReportPdfButton } from "./ReportPdfButton";

export function GroupTable({
  title,
  rows,
  currency,
  previous,
  budget,
}: {
  title: string;
  rows: Array<{
    name: string;
    incomeMinor: number;
    expenseMinor: number;
    netMinor: number;
    count: number;
  }>;
  currency: string;
  previous?: Array<{ name: string; expenseMinor: number }>;
  budget?: Map<string, number>;
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {rows.length ? (
        <Table label={title}>
          <THead>
            <TR>
              <TH scope="col">Name</TH>
              <TH scope="col">Money in</TH>
              <TH scope="col">Money out</TH>
              <TH scope="col">Net</TH>
              {previous ? <TH scope="col">Last month out</TH> : null}
              {budget ? <TH scope="col">Budget</TH> : null}
              <TH scope="col">Entries</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.name}>
                <TD>{label(r.name)}</TD>
                <TD>{formatMoney(r.incomeMinor, currency)}</TD>
                <TD>{formatMoney(r.expenseMinor, currency)}</TD>
                <TD>{formatMoney(r.netMinor, currency)}</TD>
                {previous ? (
                  <TD>
                    {formatMoney(
                      previous.find((p) => p.name === r.name)?.expenseMinor ??
                        0,
                      currency,
                    )}
                  </TD>
                ) : null}
                {budget ? (
                  <TD>{formatMoney(budget.get(r.name) ?? 0, currency)}</TD>
                ) : null}
                <TD>{r.count}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-ink-muted">No entries in this period.</p>
      )}
    </Card>
  );
}
function byName<T extends { amountMinor: number }>(
  rows: T[],
  key: (e: T) => string,
) {
  const m = new Map<string, number>();
  for (const row of rows)
    m.set(key(row), (m.get(key(row)) ?? 0) + row.amountMinor);
  return [...m].map(([name, expenseMinor]) => ({ name, expenseMinor }));
}
const EXPORTS = [
  ["entries", "Ledger with receipts"],
  ["bills", "Bills"],
  ["funds", "Funds"],
  ["budgets", "Budgets"],
  ["income-sources", "Income by source"],
  ["income-funders", "Income by donor or funder"],
  ["spending-categories", "Spending by category"],
  ["spending-vendors", "Spending by vendor"],
  ["centres", "Cost centre statements"],
  ["cash-flow", "Monthly cash flow"],
  ["disbursements", "Disbursements"],
  ["disbursement-purposes", "Disbursements by purpose"],
  ["disbursement-centres", "Disbursements by programme"],
] as const;
export function FinanceReportsScreen({
  actor,
  query,
  view,
  spending = false,
  print = false,
}: {
  actor: FinanceActor;
  query: FinanceQuery;
  view: FinanceReportsView;
  spending?: boolean;
  print?: boolean;
}) {
  const { data, pickers: p, manage, files } = view;
  // Only the spending review carries duplicate pairs.
  const review = "duplicates" in data ? data : null;
  const slug = actor.workspace.slug,
    base = `/w/${slug}/finance`,
    c = data.period.currency;
  const params = new URLSearchParams({
    from: data.period.from,
    to: data.period.to,
    currency: c,
    ...(query.centre ? { centre: query.centre } : {}),
  });
  const exp = (kind: string) => `${base}/export/${kind}?${params}`;
  const budgetCentre = new Map<string, number>(),
    budgetCategory = new Map<string, number>();
  for (const b of data.budgets.filter(
    (b) =>
      b.periodStart.toISOString().slice(0, 10) === data.period.from &&
      b.periodEnd.toISOString().slice(0, 10) === data.period.to,
  )) {
    const centre =
      p.centres.find((a) => a.id === b.costCentreId)?.name ?? "No cost centre";
    budgetCentre.set(centre, (budgetCentre.get(centre) ?? 0) + b.amountMinor);
    for (const id of b.categories) {
      const category =
        p.categories.find((a) => a.id === id)?.name ?? "Uncategorised";
      budgetCategory.set(
        category,
        (budgetCategory.get(category) ?? 0) + b.amountMinor,
      );
    }
  }
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1),
    entries = print
      ? data.entries
      : data.entries.slice((page - 1) * 40, page * 40);
  const income = data.entries.reduce(
      (n, e) => n + (e.kind === "INCOME" ? e.amountMinor : 0),
      0,
    ),
    expense = data.entries.reduce(
      (n, e) => n + (e.kind === "EXPENSE" ? e.amountMinor : 0),
      0,
    );
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-h2">
          {spending
            ? "Review spending"
            : print
              ? `${actor.workspace.name} finance report`
              : "Reports and accountant export"}
        </h2>
        <p className="text-ink-muted">
          {data.period.from} to {data.period.to} · {c}. Payroll details stay in
          the pay register.
        </p>
      </div>
      {!print ? (
        <FinanceFilters
          query={{
            ...query,
            month: data.period.month,
            from: data.period.from,
            to: data.period.to,
          }}
          month
          period={!spending}
          centres={p.centres}
          currency={c}
        />
      ) : null}
      {!data.entries.length ? (
        <EmptyState
          patch
          title="No entries in this period. Record the next receipt."
          action={
            <Link
              href={manage ? `${base}/receipt` : `/w/${slug}/requests`}
              className={buttonClasses({ variant: "secondary" })}
            >
              {manage ? "Add an entry" : "Open requests"}
            </Link>
          }
        />
      ) : null}
      <Card>
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            ["Money in", income],
            ["Money out", expense],
            ["Net", income - expense],
          ].map(([name, amount]) => (
            <div key={name}>
              <dt className="text-ink-muted">{name}</dt>
              <dd className="text-h2 tabular-nums">
                {formatMoney(Number(amount), c)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      {!print ? (
        <Card className="print:hidden">
          <CardHeader
            title="Share with your accountant"
            description="CSV files open in Excel. Amounts use decimal major units and an explicit currency."
          />
          <div className="flex flex-wrap gap-2">
            {EXPORTS.map(([kind, name]) => (
              <a
                key={kind}
                href={exp(kind)}
                className={buttonClasses({ variant: "secondary" })}
              >
                {name} CSV
              </a>
            ))}
            <Link
              href={`${base}/reports/print?${params}`}
              className={buttonClasses({ variant: "secondary" })}
            >
              Printable report
            </Link>
            {manage ? (
              <ReportPdfButton
                slug={slug}
                query={{
                  from: data.period.from,
                  to: data.period.to,
                  currency: c,
                  centre: query.centre,
                }}
              />
            ) : null}
          </div>
        </Card>
      ) : (
        <div className="print:hidden">
          <PrintButton />
        </div>
      )}
      <GroupTable
        title="Income by source"
        rows={data.incomeBySource}
        currency={c}
      />
      <GroupTable
        title="Income by donor or funder"
        rows={data.incomeByFunder}
        currency={c}
      />
      <GroupTable
        title={
          review
            ? "Category spending: this month, last month and budget"
            : "Spending by category"
        }
        rows={data.spendingByCategory}
        currency={c}
        budget={budgetCategory.size ? budgetCategory : undefined}
        previous={
          review
            ? byName(
                review.previous,
                (e) => e.category?.name ?? "Uncategorised",
              )
            : undefined
        }
      />
      <GroupTable
        title="Paid disbursements by purpose"
        rows={data.disbursementPurposes}
        currency={c}
      />
      <GroupTable
        title="Paid disbursements by programme"
        rows={data.disbursementCentres}
        currency={c}
      />
      <GroupTable
        title="Spending by vendor"
        rows={data.spendingByVendor}
        currency={c}
      />
      <GroupTable
        title="Event, programme, project and team statements"
        rows={data.centres}
        currency={c}
        budget={budgetCentre.size ? budgetCentre : undefined}
        previous={
          review
            ? byName(
                review.previous,
                (e) => e.costCentre?.name ?? "No cost centre",
              )
            : undefined
        }
      />
      <Card>
        <CardHeader title="Monthly cash flow" description="Cash received and paid, including aggregate payroll, loan principal and deposits. Internal transfers are excluded. Income and spending tables retain their expense basis." />
        {data.monthly.length ? (
          <MonthlyChart
            currency={c}
            data={data.monthly.map((m) => ({
              month: m.name,
              label: m.name,
              incomeMinor: m.incomeMinor,
              expenseMinor: m.expenseMinor,
            }))}
          />
        ) : (
          <p className="text-ink-muted">No cash movements in this period.</p>
        )}
      </Card>
      {data.budgets.length ? (
        <Card>
          <CardHeader
            title="Budget against actual"
            description="Each line uses its full budget period; category and cost centre lines include matching ledger entries."
          />
          <Table label="Budget against actual">
            <THead>
              <TR>
                <TH>Line and period</TH>
                <TH>Budget</TH>
                <TH>Actual</TH>
                <TH>Variance (actual minus budget)</TH>
                <TH>Note</TH>
              </TR>
            </THead>
            <TBody>
              {data.budgets.map((b) => (
                <TR key={b.id}>
                  <TD>
                    {b.name}
                    <br />
                    {formatDay(b.periodStart)} to {formatDay(b.periodEnd)}
                  </TD>
                  <TD>{formatMoney(b.amountMinor, c)}</TD>
                  <TD>{formatMoney(b.actualMinor, c)}</TD>
                  <TD>{formatMoney(b.actualMinor - b.amountMinor, c)}</TD>
                  <TD>{b.varianceNote ?? "No note"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
      {review ? (
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
      ) : null}
      <Card>
        <CardHeader
          title="Entries and receipts"
          description={
            !print
              ? `Page ${page}. Payroll records are in the pay register.`
              : undefined
          }
        />
        <div className="flex flex-col gap-4">
          {entries.map((e) => (
            <article
              key={e.id}
              className="break-inside-avoid rounded-lg border border-line p-4"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{e.description}</strong>
                <Chip tone={e.kind === "INCOME" ? "success" : "neutral"}>
                  {label(e.kind)} · {formatMoney(e.amountMinor, c)}
                </Chip>
              </div>
              <p className="mt-1 text-ink-muted">
                {formatDay(e.occurredOn)} ·{" "}
                {e.counterparty ?? "No vendor or funder"} ·{" "}
                {e.category?.name ?? "Uncategorised"} ·{" "}
                {e.costCentre?.name ?? "No cost centre"}
              </p>
              {e.purpose ? <p>{e.purpose}</p> : null}
              <FilePreviews files={e.receipts} />
              {manage && spending ? (
                <div className="mt-4">
                  <EditPanel title="Receipts and bookkeeping">
                    <AttachedFiles
                      slug={slug}
                      files={files}
                      type="LEDGER"
                      id={e.id}
                      editable
                    />
                    <div className="mt-4">
                      <ToolForm
                        slug={slug}
                        operation="tags"
                        fields={[
                          hidden("entryId", e.id),
                          ...tagFields(p, e),
                          {
                            name: "incomeSource",
                            label: "Income source",
                            type: "select",
                            options: options(INCOME_SOURCES),
                            value: e.incomeSource,
                          },
                          {
                            name: "invoiceNumber",
                            label: "Invoice number",
                            value: e.invoiceNumber ?? "",
                          },
                        ]}
                        button="Save bookkeeping"
                      />
                    </div>
                  </EditPanel>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </Card>
      {!print ? (
        <nav
          className="flex flex-wrap justify-between gap-3"
          aria-label="Entry pages"
        >
          {page > 1 ? (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`?${params}&page=${page - 1}`}
            >
              Previous entries
            </Link>
          ) : (
            <span />
          )}
          {page * 40 < data.entries.length ? (
            <Link
              className={buttonClasses({ variant: "secondary" })}
              href={`?${params}&page=${page + 1}`}
            >
              Next entries
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
