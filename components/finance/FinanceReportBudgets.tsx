import { Card, CardHeader } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import type { FinanceReportsView } from "@/lib/finance/tools/views";

export function FinanceReportBudgets({ data }: { data: FinanceReportsView["data"] }) {
  const c = data.period.currency;
  return (
    <>
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
    </>
  );
}
