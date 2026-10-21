import { Card, CardHeader } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatMoney } from "@/lib/format/money";
import { label } from "@/lib/finance/tools-rules";

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
export function byName<T extends { amountMinor: number }>(
  rows: T[],
  key: (e: T) => string,
) {
  const m = new Map<string, number>();
  for (const row of rows)
    m.set(key(row), (m.get(key(row)) ?? 0) + row.amountMinor);
  return [...m].map(([name, expenseMinor]) => ({ name, expenseMinor }));
}
