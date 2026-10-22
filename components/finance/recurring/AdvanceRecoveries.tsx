import type { AdvancesView } from "@/lib/finance/recurring/queries";
import { formatMoney } from "@/lib/format/money";
import { minorToDecimalString } from "@/lib/finance/money";
import { RecurringForm } from "./Forms";
import { hidden, select, text, date, pretty } from "./Screen";

export function AdvanceRecoveries({
  slug,
  view,
  r,
  today,
}: {
  slug: string;
  view: AdvancesView;
  r: AdvancesView["rows"][number];
  today: string;
}) {
  return (
    <>
      {r.recoveries.length ? (
        <ul className="mt-4 divide-y divide-line">
          {r.recoveries.map((v) => (
            <li key={v.id} className="py-4">
              <p>
                Instalment {v.instalment} · Due {pretty(v.dueOn)} ·{" "}
                {formatMoney(
                  v.amountMinor - v.recoveredMinor,
                  r.currency,
                )}{" "}
                outstanding
              </p>
              {view.manage && v.recoveredMinor < v.amountMinor ? (
                <details>
                  <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                    Record repayment or pay-run recovery
                  </summary>
                  <RecurringForm
                    slug={slug}
                    operation="recover"
                    fields={[
                      hidden("id", v.id),
                      hidden("operationKey", crypto.randomUUID()),
                      hidden("currency", r.currency),
                      text(
                        "amountMinor",
                        "Amount recovered",
                        minorToDecimalString(
                          v.amountMinor - v.recoveredMinor,
                          r.currency,
                        ),
                        "money",
                        true,
                      ),
                      text(
                        "paidOn",
                        "Recovered on",
                        today,
                        "date",
                        true,
                      ),
                      text(
                        "reference",
                        "Repayment / payroll reference",
                        "",
                        "text",
                        true,
                      ),
                      select(
                        "payRunId",
                        "Paid run (leave blank for cash repayment)",
                        view.runs
                          .filter((p) => p.profileId === r.profileId)
                          .map((p) => ({
                            id: p.id,
                            name: `${p.month} · Paid ${date(p.paidOn)}`,
                          })),
                      ),
                    ]}
                    button="Record recovery"
                  />
                  <p className="mt-2 text-sm text-ink-secondary">
                    A pay-run recovery uses its existing advance
                    deduction. A manual repayment moves cash back to
                    the advance account.
                  </p>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
