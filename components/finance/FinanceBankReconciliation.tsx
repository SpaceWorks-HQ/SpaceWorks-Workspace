import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { currencyField, hidden, money } from "./ToolFields";
import { formatDay } from "@/lib/finance/dates";
import { formatMoney } from "@/lib/format/money";
import { EditPanel } from "./FinanceToolPanels";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceBankReconciliation({ context }: { context: FinanceToolContext }) {
  const { data, p, slug, base, currency, manage } = context;
  return (
    <>
      <Card>
        <CardHeader
          title="Bank and cash accounts"
          description="Enter statement closing balances manually. No bank connection is needed."
        />
        {p.accounts.length ? (
          <ul className="divide-y divide-line">
            {p.accounts.map((a) => (
              <li key={a.id} className="py-3">
                <strong>{a.name}</strong>
                <p className="text-ink-muted">
                  Opening {formatMoney(a.openingMinor, a.currency)} on{" "}
                  {a.openingOn} · Reconciled up to{" "}
                  {a.reconciledUpTo ?? "Not yet"}
                </p>
                <Link
                  href={`${base}/close?month=${data.period.month}&account=${a.id}`}
                  className={buttonClasses({ variant: "quiet" })}
                >
                  Show entries
                </Link>
                {manage ? (
                  <EditPanel title={`Compare ${a.name} with a statement`}>
                    <ToolForm
                      slug={slug}
                      operation="reconcile"
                      fields={[
                        hidden("accountId", a.id),
                        hidden("currency", a.currency),
                        {
                          name: "upTo",
                          label: "Statement date",
                          type: "date",
                          value: data.period.to,
                          required: true,
                        },
                        money(
                          "statementMinor",
                          "Statement closing balance",
                          "",
                          true,
                        ),
                        { name: "notes", label: "Notes", type: "textarea" },
                        {
                          name: "signOff",
                          label: "Sign off this reconciliation",
                          type: "checkbox",
                          helper:
                            "The difference must be zero and every entry must be marked reconciled.",
                        },
                      ]}
                      button="Compare or sign off"
                    />
                  </EditPanel>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">
            No accounts yet. Add your bank or cash account below.
          </p>
        )}
      </Card>
      {data.reconciliations.map((r) => (
        <Card key={r.id} id={r.id}>
          <CardHeader
            title={r.account.name}
            description={`Statement up to ${formatDay(r.upTo)}`}
            action={
              <Chip tone={r.signedOffAt ? "success" : "neutral"}>
                {r.signedOffAt ? "Signed off" : "Compared"}
              </Chip>
            }
          />
          <p>
            Statement {formatMoney(r.statementMinor, r.account.currency)} ·
            Ledger {formatMoney(r.ledgerMinor, r.account.currency)}
          </p>
          <p className="text-title">
            Difference{" "}
            {formatMoney(
              r.statementMinor - r.ledgerMinor,
              r.account.currency,
            )}
          </p>
          <p className="text-ink-muted">{r.notes}</p>
        </Card>
      ))}
      <Card>
        <CardHeader
          title="Entries to check"
          description="Choose an account above to narrow this list. Payroll entries require payroll access."
        />
        <div className="flex flex-col gap-3">
          {data.accountEntries.map((e) => (
            <div key={e.id} className="rounded-lg border border-line p-3">
              <p>
                {formatDay(e.occurredOn)} · {e.description} ·{" "}
                {formatMoney(e.amountMinor, e.currency)}
              </p>
              <p className="text-ink-muted">
                {e.account?.name ?? "No account - assign one in Spending"} ·{" "}
                {e.reconciledAt ? "Reconciled" : "Not reconciled"}
              </p>
              {manage && e.accountId ? (
                <ToolForm
                  slug={slug}
                  operation="mark"
                  fields={[
                    hidden("entryId", e.id),
                    hidden("reconciled", e.reconciledAt ? "false" : "true"),
                  ]}
                  button={e.reconciledAt ? "Clear mark" : "Mark reconciled"}
                />
              ) : null}
            </div>
          ))}
          {!data.accountEntries.length ? (
            <p className="text-ink-muted">No entries in this period.</p>
          ) : null}
        </div>
      </Card>
      {manage ? (
        <EditPanel title="Add a bank or cash account">
          <ToolForm
            slug={slug}
            operation="account"
            fields={[
              {
                name: "name",
                label: "Account label",
                required: true,
                helper:
                  "For example, Office bank ending 1234. Never enter a full account number.",
              },
              currencyField(currency),
              money("openingMinor", "Opening balance"),
              {
                name: "openingOn",
                label: "Opening balance date",
                type: "date",
                value: data.period.from,
                required: true,
              },
            ]}
            button="Add account"
            reset
          />
        </EditPanel>
      ) : null}
    </>
  );
}
