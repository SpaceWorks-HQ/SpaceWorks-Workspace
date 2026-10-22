import { randomUUID } from "node:crypto";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { MoneyRecordForm } from "./MoneyRecordForm";
import { hidden, money } from "./ToolFields";
import { billStatus } from "@/lib/finance/tools-rules";
import { formatDay, isoDay } from "@/lib/finance/dates";
import { minorToDecimalString } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format/money";
import { AttachedFiles, EditPanel, Empty } from "./FinanceToolPanels";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceBillsSection({ context }: { context: FinanceToolContext }) {
  const { data, files, slug, today, manage, billFields } = context;
  return (
    <>
      {!data.bills.length ? (
        <Empty
          text="No bills here yet. Log the next supplier bill."
          add={manage ? "Log a bill" : "Open requests"}
          href={manage ? "#add-record" : `/w/${slug}/requests`}
        />
      ) : null}
      {data.bills.map((b) => (
        <Card key={b.id} id={b.id}>
          <CardHeader
            title={`${b.vendor} · ${b.number}`}
            description={`Bill ${formatDay(b.issuedOn)} · Due ${formatDay(b.dueOn)}`}
            action={
              <Chip
                tone={
                  b.paidMinor < b.amountMinor && isoDay(b.dueOn) < today
                    ? "danger"
                    : b.paidMinor >= b.amountMinor
                      ? "success"
                      : "warning"
                }
              >
                {b.paidMinor < b.amountMinor && isoDay(b.dueOn) < today
                  ? "Overdue · "
                  : ""}
                {b.needsActual ? "Needs actual amount" : billStatus(b.amountMinor, b.paidMinor)}
              </Chip>
            }
          />
          {b.needsActual && manage ? <a className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${slug}/finance/dues`}>Enter the actual amount in Upcoming dues</a> : null}
          <p className="text-title">
            {formatMoney(b.amountMinor, b.currency)} total ·{" "}
            {formatMoney(b.amountMinor - b.paidMinor, b.currency)} unpaid
          </p>
          <p className="text-body-ui text-ink-muted">
            {b.purpose}
            {b.gstin ? ` · Tax ID ${b.gstin}` : ""}
            {b.tdsMinor
              ? ` · TDS ${formatMoney(b.tdsMinor, b.currency)}`
              : ""}
          </p>
          <p className="whitespace-pre-wrap text-ink-muted">{b.notes}</p>
          <div className="mt-4">
            <AttachedFiles
              slug={slug}
              files={files}
              type="BILL"
              id={b.id}
              editable={manage}
            />
          </div>
          {b.payments.length ? (
            <ul
              className="mt-4 divide-y divide-line"
              aria-label="Bill payments"
            >
              {b.payments.map((a) => (
                <li key={a.id} className="py-2 text-body-ui">
                  {formatDay(a.paidOn)} ·{" "}
                  {formatMoney(a.amountMinor, b.currency)} · {a.reference} ·{" "}
                  {a.posted ? "Posted to ledger" : "Payment recorded only"}
                </li>
              ))}
            </ul>
          ) : null}
          {manage && b.paidMinor < b.amountMinor ? (
            <div className="mt-4">
              <EditPanel title="Record a payment">
                <ToolForm
                  slug={slug}
                  operation="billPayment"
                  fields={[
                    hidden("billId", b.id),
                    hidden("currency", b.currency),
                    hidden("paymentKey", randomUUID()),
                    money(
                      "amountMinor",
                      "Payment amount",
                      minorToDecimalString(
                        b.amountMinor - b.paidMinor,
                        b.currency,
                      ),
                      true,
                    ),
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
                    {
                      name: "post",
                      label: "Create the ledger expense",
                      type: "checkbox",
                      value: true,
                      helper:
                        "Turn this off only if the payment is already in the ledger.",
                    },
                  ]}
                  button="Record payment"
                />
              </EditPanel>
            </div>
          ) : null}
          {manage && b.paidMinor === 0 ? (
            <div className="mt-3">
              <EditPanel title="Edit bill">
                <ToolForm
                  slug={slug}
                  operation="bill"
                  fields={billFields(b)}
                  button="Save bill"
                />
              </EditPanel>
            </div>
          ) : null}
        </Card>
      ))}
      {manage ? (
        <div id="add-record">
          <EditPanel title="Log a bill">
            <MoneyRecordForm
              slug={slug}
              operation="bill"
              fields={billFields()}
              button="Save bill"
            />
          </EditPanel>
        </div>
      ) : null}
    </>
  );
}
