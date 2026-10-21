import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { MoneyRecordForm } from "./MoneyRecordForm";
import { currencyField, hidden, money, options, tagFields } from "./ToolFields";
import { disbursementKinds, label } from "@/lib/finance/tools-rules";
import { formatDay } from "@/lib/finance/dates";
import { minorToDecimalString } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format/money";
import { AttachedFiles, EditPanel, Empty } from "./FinanceToolPanels";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceDisbursementsSection({ context }: { context: FinanceToolContext }) {
  const { data, p, files, slug, today, currency, manage, selectMember } = context;
  return (
    <>
      <p className="text-body-ui text-ink-muted">
        Team members submit their own expense claims in{" "}
        <Link href={`/w/${slug}/requests`} className="underline">
          Requests
        </Link>
        . Use this register for other payouts and staff advances.
      </p>
      {!data.disbursements.length ? (
        <Empty
          text="No disbursements yet. Record the next payout."
          add={manage ? "Add a disbursement" : "Open requests"}
          href={manage ? "#add-record" : `/w/${slug}/requests`}
        />
      ) : null}
      {data.disbursements.map((d) => (
        <Card key={d.id} id={d.id}>
          <CardHeader
            title={d.payee}
            description={`${label(d.kind)} · ${d.purpose}`}
            action={
              <Chip tone={d.status === "PAID" ? "success" : "neutral"}>
                {label(d.status)}
              </Chip>
            }
          />
          <p className="text-title">
            {formatMoney(d.amountMinor, d.currency)}
            {d.tdsMinor
              ? ` · TDS ${formatMoney(d.tdsMinor, d.currency)}`
              : ""}
          </p>
          <p className="text-ink-muted">
            {d.paidOn
              ? `Paid ${formatDay(d.paidOn)} · ${d.reference}`
              : d.dueOn
                ? `Due ${formatDay(d.dueOn)}`
                : "Not paid"}
          </p>
          {d.kind === "ADVANCE" ? (
            <p className="mt-2">
              {d.settledMinor >= d.amountMinor ? "Settled" : "Unsettled"} ·{" "}
              {formatMoney(d.amountMinor - d.settledMinor, d.currency)} to
              settle
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-ink-muted">{d.notes}</p>
          <div className="mt-4">
            <AttachedFiles
              slug={slug}
              files={files}
              type="DISBURSEMENT"
              id={d.id}
              editable={manage}
            />
          </div>
          {manage && d.status !== "PAID" ? (
            <div className="mt-4 flex flex-col gap-3">
              <ToolForm
                slug={slug}
                operation="disbursementTransition"
                fields={[
                  hidden("id", d.id),
                  hidden("transition", "REQUEST_APPROVAL"),
                ]}
                button={
                  d.approvalId
                    ? "Refresh or request approval again"
                    : "Request approval"
                }
              />
              <Link
                href={`/w/${slug}/approvals`}
                className={buttonClasses({ variant: "quiet" })}
              >
                Open approvals
              </Link>
              <EditPanel title="Record approved payment">
                <ToolForm
                  slug={slug}
                  operation="disbursementTransition"
                  fields={[
                    hidden("id", d.id),
                    hidden("transition", "PAY"),
                    hidden("currency", d.currency),
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
                  button="Record payment and post expense"
                />
              </EditPanel>
            </div>
          ) : null}
          {manage &&
          d.status === "PAID" &&
          d.kind === "ADVANCE" &&
          d.settledMinor < d.amountMinor ? (
            <div className="mt-4">
              <EditPanel title="Settle advance">
                <ToolForm
                  slug={slug}
                  operation="disbursementTransition"
                  fields={[
                    hidden("id", d.id),
                    hidden("transition", "SETTLE"),
                    hidden("currency", d.currency),
                    money(
                      "settledMinor",
                      "Total settled so far",
                      minorToDecimalString(d.amountMinor, d.currency),
                      true,
                    ),
                    {
                      name: "paidOn",
                      label: "Settlement date",
                      type: "date",
                      value: today,
                      required: true,
                    },
                  ]}
                  button="Save settlement"
                />
              </EditPanel>
            </div>
          ) : null}
        </Card>
      ))}
      {manage ? (
        <div id="add-record">
          <EditPanel title="Add a disbursement">
            <MoneyRecordForm
              slug={slug}
              operation="disbursement"
              fields={[
                { name: "payee", label: "Payee", required: true },
                { name: "purpose", label: "Purpose", required: true },
                {
                  name: "kind",
                  label: "Payout type",
                  type: "select",
                  options: options(disbursementKinds),
                  value: "OTHER",
                  required: true,
                },
                currencyField(currency),
                money("amountMinor", "Payout amount after TDS", "", true),
                money("tdsMinor", "TDS withheld"),
                ...tagFields(p).filter((f) => f.name !== "purpose"),
                selectMember(),
                { name: "dueOn", label: "Due date", type: "date" },
                { name: "notes", label: "Notes", type: "textarea" },
              ]}
              button="Save disbursement"
            />
          </EditPanel>
        </div>
      ) : null}
    </>
  );
}
