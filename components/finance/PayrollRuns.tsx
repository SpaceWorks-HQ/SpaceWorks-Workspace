import Link from "next/link";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { PayrollView } from "@/lib/finance/tools/views";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import { label, payTotals } from "@/lib/finance/tools-rules";
import { ToolForm } from "./ToolForm";
import { hidden, tagFields } from "./ToolFields";
import { EditPanel, AttachedFiles } from "./FinanceToolScreen";
import { PayslipButton } from "./PayrollActions";
import { payrollFields } from "./PayrollFields";

export function PayrollRuns({
  slug,
  payroll,
  today,
  currency,
}: {
  slug: string;
  payroll: NonNullable<PayrollView["payroll"]>;
  today: string;
  currency: string;
}) {
  const { data, pickers: p, files } = payroll;
  const runs = data.runs.filter((r) => r.currency === data.period.currency);
  const base = `/w/${slug}/finance`;
  const { payFields } = payrollFields(payroll, currency);
  return (
    <>
      <h3 className="text-h3">{data.period.month} pay runs</h3>
      {!runs.length ? (
        <p className="text-ink-muted">
          No pay runs in this month and currency.
        </p>
      ) : null}
      {runs.map((r) => (
        <Card key={r.id} id={r.id}>
          <CardHeader
            title={r.profile.name}
            description={r.month}
            action={
              <Chip
                tone={
                  r.status === "PAID"
                    ? "success"
                    : r.status === "APPROVED"
                      ? "info"
                      : "neutral"
                }
              >
                {label(r.status)}
              </Chip>
            }
          />
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ["Earnings", payTotals(r).earningsMinor],
              ["Deductions", payTotals(r).deductionsMinor],
              ["Net pay", r.netMinor],
            ].map(([name, n]) => (
              <div key={name}>
                <dt className="text-ink-muted">{name}</dt>
                <dd className="text-title">
                  {formatMoney(Number(n), r.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-body-ui text-ink-muted">
            {r.paidOn
              ? `Paid ${formatDay(r.paidOn)} · ${r.reference}`
              : "Not paid"}{" "}
            · {r.ledgerEntryId ? "Posted to ledger" : "Not posted to ledger"}
          </p>
          <div className="mt-4">
            <AttachedFiles
              slug={slug}
              files={files}
              type="PAY_RUN"
              id={r.id}
              editable={data.manage}
            />
          </div>
          {data.manage ? (
            <div className="mt-4 flex flex-col gap-3">
              {r.status === "DRAFT" ? (
                <>
                  <EditPanel title="Edit draft amounts">
                    <ToolForm
                      slug={slug}
                      operation="payRun"
                      fields={payFields(
                        data.profiles.find((p) => p.id === r.profileId)!,
                        r,
                      )}
                      button="Save draft amounts"
                    />
                  </EditPanel>
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "APPROVE"),
                    ]}
                    button="Approve pay run"
                  />
                </>
              ) : r.status === "APPROVED" ? (
                <>
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "PAY"),
                      {
                        name: "paidOn",
                        label: "Paid date",
                        type: "date",
                        value: today,
                        required: true,
                      },
                      {
                        name: "reference",
                        label: "Payment reference or UTR",
                        required: true,
                      },
                    ]}
                    button="Mark paid"
                  />
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "REOPEN"),
                    ]}
                    button="Return to draft"
                  />
                </>
              ) : !r.ledgerEntryId ? (
                <ToolForm
                  slug={slug}
                  operation="payTransition"
                  fields={[hidden("runId", r.id), hidden("transition", "POST")]}
                  button="Post net payment to ledger"
                />
              ) : null}
            </div>
          ) : null}
          {data.manage && r.status === "PAID" ? (
            <div className="mt-4">
              <EditPanel title="Correct payroll bookkeeping">
                <ToolForm
                  slug={slug}
                  operation="payBookkeeping"
                  fields={[hidden("runId", r.id), ...tagFields(p, r)]}
                  button="Save payroll bookkeeping"
                />
              </EditPanel>
            </div>
          ) : null}
          {r.status === "PAID" ? (
            <div className="mt-4">
              <PayslipButton slug={slug} runId={r.id} />
              <Link
                href={`${base}/payroll/${r.id}/print`}
                className={buttonClasses({ variant: "quiet" })}
              >
                Printable payslip
              </Link>
            </div>
          ) : null}
        </Card>
      ))}
    </>
  );
}
