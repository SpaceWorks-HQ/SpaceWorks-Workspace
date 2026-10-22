import Link from "next/link";
import { Card, Chip } from "@/components/ui/display";
import { FinanceAttachments } from "@/components/finance/FinanceAttachments";
import type { UpcomingView } from "@/lib/finance/recurring/queries";
import { formatMoney } from "@/lib/format/money";
import { minorToDecimalString } from "@/lib/finance/money";
import { label } from "@/lib/finance/tools-rules";
import { RecurringForm } from "./Forms";
import { hidden, text, pretty } from "./Fields";
import { DueActualForm } from "./DueActualForm";

export function DueRow({
  slug,
  view,
  r,
}: {
  slug: string;
  view: UpcomingView;
  r: UpcomingView["rows"][number];
}) {
  const base = `/w/${slug}/finance`;
  const editable = !r.privatePayroll || view.payrollManage,
    unpaid = r.amountMinor - r.paidMinor;
  return (
    <li key={r.id}>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="max-w-full break-words text-lg font-semibold">
            {r.title}
          </h2>
          <Chip
            tone={
              r.dueOn < view.today && unpaid ? "danger" : "neutral"
            }
          >
            {r.projected
              ? "Projected"
              : r.needsActual
                ? "Needs actual amount"
                : unpaid
                  ? r.dueOn < view.today
                    ? "Overdue"
                    : "Due"
                  : "Paid"}
          </Chip>
        </div>
        <p className="mt-2">
          {label(r.kind)} · Due {pretty(r.dueOn)} ·{" "}
          {formatMoney(unpaid, r.currency)} outstanding
        </p>
        <p className="mt-2 text-sm text-ink-secondary">
          {view.pickers.funds.find((f) => f.id === r.fundId)?.name ??
            "No fund"}{" "}
          ·{" "}
          {view.pickers.centres.find((f) => f.id === r.costCentreId)
            ?.name ?? "No cost centre"}
          {r.paidOn
            ? ` · Last paid ${pretty(r.paidOn)} · ${r.reference}`
            : ""}
        </p>
        {r.projected ? (
          <Link
            href={`${base}/recurring?edit=${r.scheduleId}`}
            className="inline-flex min-h-11 items-center text-accent-text underline"
          >
            Review schedule
          </Link>
        ) : r.kind === "ADVANCE_RECOVERY" ? (
          <Link
            href={`${base}/advances`}
            className="inline-flex min-h-11 items-center text-accent-text underline"
          >
            Record recovery
          </Link>
        ) : (
          <>
            {r.billId && editable && unpaid > 0 ? (
              <>
                {r.scheduleId && r.paidMinor === 0 ? (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                      {r.kind === "EMI"
                        ? "Confirm principal and interest"
                        : r.needsActual
                          ? "Enter actual amount"
                          : "Review this bill’s amount"}
                    </summary>
                    <DueActualForm slug={slug} r={r} />
                  </details>
                ) : null}
                {!r.needsActual &&
                (r.kind !== "EMI" || r.splitConfirmed) ? (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                      Record payment
                    </summary>
                    <RecurringForm
                      slug={slug}
                      operation="pay"
                      fields={[
                        hidden("billId", r.billId),
                        hidden("currency", r.currency),
                        hidden("paymentKey", crypto.randomUUID()),
                        text(
                          "amountMinor",
                          "Cash paid",
                          minorToDecimalString(unpaid, r.currency),
                          "money",
                          true,
                        ),
                        text(
                          "paidOn",
                          "Paid on",
                          view.today,
                          "date",
                          true,
                        ),
                        text(
                          "reference",
                          r.privatePayroll
                            ? "Challan / payment reference"
                            : "Payment reference",
                          "",
                          "text",
                          true,
                        ),
                      ]}
                      button="Record payment and post"
                    />
                  </details>
                ) : null}
                {r.privatePayroll ? (
                  <details className="mt-3">
                    <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                      Change remittance due date
                    </summary>
                    <RecurringForm
                      slug={slug}
                      operation="remittanceDue"
                      fields={[
                        hidden("billId", r.billId),
                        text(
                          "dueOn",
                          "Reviewed due date",
                          r.dueOn,
                          "date",
                          true,
                        ),
                      ]}
                      button="Save due date"
                    />
                  </details>
                ) : null}
              </>
            ) : null}
            {r.billId ? (
              <div className="mt-4">
                <FinanceAttachments
                  slug={slug}
                  type="BILL"
                  recordId={r.billId}
                  initial={view.files[r.billId] ?? []}
                  editable={editable}
                />
              </div>
            ) : null}
          </>
        )}
      </Card>
    </li>
  );
}
