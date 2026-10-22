import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import Link from "next/link";
import { RecurringForm } from "./Forms";
import { hidden, pretty as date } from "./Screen";
import type { LeaseFinanceView } from "@/lib/finance/recurring/queries";
import { formatMoney } from "@/lib/format/money";
import { FilePreviews } from "@/components/finance/FinanceAttachments";
export function LeaseLedger({
  slug,
  leaseId,
  view,
}: {
  slug: string;
  leaseId: string;
  view: LeaseFinanceView;
}) {
  const schedule = view.rows.find((s) => s.leaseId === leaseId),
    deposit = view.deposits.find((d) => d.id === schedule?.depositId);
  return (
    <section
      className="mt-5 space-y-4"
      aria-label="Rent ledger and security deposit"
    >
      {schedule ? (
        <>
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/w/${slug}/finance/recurring?edit=${schedule.id}`}
              className="inline-flex min-h-11 items-center text-accent-text underline"
            >
              Review rent schedule
            </Link>
            <p className="py-3">
              Renewal {date(schedule.renewalOn)} · Proposed escalation{" "}
              {schedule.escalationPercent}%
            </p>
          </div>
          <div
            role="region"
            aria-label="Monthly rent ledger"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <Table className="w-full text-left text-sm">
              <caption className="sr-only">
                Dated rent bills and payments
              </caption>
              <THead>
                <TR>
                  {[
                    "Due",
                    "Amount",
                    "Paid on",
                    "TDS deducted",
                    "Outstanding",
                    "Receipt",
                  ].map((t) => (
                    <TH
                      key={t}
                      className="whitespace-nowrap border-b border-line p-3"
                      scope="col"
                    >
                      {t}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {schedule.dues.map((d) => (
                  <TR key={d.id}>
                    <TD className="p-3">{date(d.dueOn)}</TD>
                    <TD className="p-3">
                      {formatMoney(d.bill.amountMinor, d.bill.currency)}
                    </TD>
                    <TD className="p-3">
                      {d.bill.payments.length
                        ? d.bill.payments.map((p) => date(p.paidOn)).join(", ")
                        : "Unpaid"}
                    </TD>
                    <TD className="p-3">
                      {formatMoney(
                        d.bill.paidMinor >= d.bill.amountMinor
                          ? d.bill.tdsMinor
                          : 0,
                        d.bill.currency,
                      )}
                    </TD>
                    <TD className="p-3">
                      {formatMoney(
                        d.bill.amountMinor - d.bill.paidMinor,
                        d.bill.currency,
                      )}
                    </TD>
                    <TD className="min-w-48 p-3">
                      <FilePreviews files={view.files[d.billId] ?? []} />
                      {!view.files[d.billId]?.length ? "No receipt yet" : null}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {!schedule.dues.length ? (
            <p>
              No rent bills yet. The scheduled job creates them before the due
              date.
            </p>
          ) : null}
        </>
      ) : (
        <RecurringForm
          slug={slug}
          operation="source"
          fields={[hidden("source", "LEASE"), hidden("sourceId", leaseId)]}
          button="Create rent schedule"
        />
      )}
      {deposit ? (
        <div className="rounded-lg border border-line p-4">
          <h3 className="font-semibold">Security deposit</h3>
          <p className="mt-2">
            {formatMoney(deposit.amountMinor, deposit.currency)} ·{" "}
            {deposit.movements.some((m) => m.amountMinor < 0)
              ? `Paid ${date(deposit.occurredOn)}`
              : "Not paid yet"}{" "}
            ·{" "}
            {(deposit.details as Record<string, unknown>).refundable === "NO"
              ? "Non-refundable"
              : "Refundable"}
          </p>
          <p className="mt-2">
            Refund received{" "}
            {formatMoney(deposit.settledMinor, deposit.currency)} · Outstanding{" "}
            {formatMoney(
              deposit.amountMinor - deposit.settledMinor,
              deposit.currency,
            )}
          </p>
          <ul className="mt-2">
            {deposit.movements
              .filter((m) => m.amountMinor > 0)
              .map((m) => (
                <li key={m.id}>
                  Refund {date(m.occurredOn)} ·{" "}
                  {formatMoney(m.amountMinor, m.currency)} · {m.reference}
                </li>
              ))}
          </ul>
          <Link
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`/w/${slug}/money-controls/cash?edit=${deposit.id}`}
          >
            Record refund or review deposit proof
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-secondary">
          Record the security deposit in{" "}
          <Link
            className="text-accent-text underline"
            href={`/w/${slug}/money-controls/cash`}
          >
            Money controls
          </Link>
          , then link it in the rent schedule.
        </p>
      )}
    </section>
  );
}
