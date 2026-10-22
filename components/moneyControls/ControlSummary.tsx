import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import {
  Card,
  Callout,
} from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { ToolFields } from "@/components/finance/ToolForm";
import { formatMoney } from "@/lib/format/money";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  words,
} from "@/lib/moneyControls/rules";

export function ControlSummary({ view }: { view: ControlsView }) {
  const { section, summary, data, p } = view;
  return (
    <>
      {summary.balances.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.balances.map((a) => (
            <Card key={a.id}>
              <h2 className="text-label">{a.name}</h2>
              <p className="text-title">
                {formatMoney(a.balanceMinor, a.currency)}
              </p>
              <p className="text-caption text-ink-muted">
                Current balance, including transfers and deposits
              </p>
            </Card>
          ))}
        </div>
      ) : null}
      {section === "assets" ? (
        <Card>
          <h2 className="mb-3 text-title">Fixed-asset schedule</h2>
          <form className="mb-4 flex flex-wrap items-end gap-3">
            <ToolFields
              fields={[
                {
                  name: "fiscalYear",
                  label: "Financial year starting",
                  value: String(data.q.fiscalYear),
                },
              ]}
            />
            <button className={buttonClasses({ variant: "secondary" })}>
              Show year
            </button>
          </form>
          <p className="mb-4 text-caption text-ink-muted">
            Daily-prorated book depreciation. Category rates are captured when
            the schedule is saved. Income-tax block notes are separate.
          </p>
          <div
            role="region"
            aria-label="Fixed asset schedule"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <Table className="w-full text-left text-body-ui">
              <caption className="sr-only">
                Financial year {data.q.fiscalYear} to {data.q.fiscalYear + 1}
              </caption>
              <THead>
                <TR>
                  {[
                    "Asset",
                    "Cost",
                    "Opening value",
                    "Depreciation",
                    "Disposal book value",
                    "Closing value",
                  ].map((h) => (
                    <TH
                      scope="col"
                      key={h}
                      className="whitespace-nowrap border-b border-line p-3"
                    >
                      {h}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {summary.schedules.map((r) => (
                  <TR key={r.id}>
                    <TH
                      scope="row"
                      className="border-b border-line p-3 font-medium"
                    >
                      {r.title}
                    </TH>
                    {[
                      r.costMinor,
                      r.openingMinor,
                      r.depreciationMinor,
                      r.disposalMinor,
                      r.closingMinor,
                    ].map((v, i) => (
                      <TD
                        key={i}
                        className="whitespace-nowrap border-b border-line p-3"
                      >
                        {formatMoney(v, r.currency)}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {!summary.schedules.length ? (
            <p className="mt-3 text-body-ui">
              Confirm a fixed asset to add it to the schedule.
            </p>
          ) : null}
        </Card>
      ) : null}
      {summary.funds.map((f) => (
        <Card key={f.id}>
          <h2 className="text-title">{f.title}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Eligible budget", f.budgetMinor],
              ["Committed and posted", f.committedMinor],
              ["Remaining eligible", f.remainingMinor],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-caption text-ink-muted">{k}</dt>
                <dd className="text-label">
                  {formatMoney(Number(v), f.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="my-3 text-caption text-ink-muted">
            Unpaid bills and unposted pay/disbursement records reserve the
            budget. Their payments replace reservations. Payroll appears only in
            aggregate.
          </p>
          {f.issues.map((s) => (
            <Callout key={s} tone="warning">
              {s}
            </Callout>
          ))}
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer text-label">
              Fund utilisation statement
            </summary>
            <ul className="space-y-2">
              {summary.utilisation
                .filter((r) => r.fundId === f.fundId)
                .map((r, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap justify-between gap-2 border-b border-line py-2"
                  >
                    <span>
                      {words(r.kind)} ·{" "}
                      {p.categories.find((c) => c.id === r.categoryId)?.name ??
                        "Uncategorised"}
                    </span>
                    <span>
                      {formatMoney(r._sum.amountMinor ?? 0, r.currency)}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </Card>
      ))}
    </>
  );
}
