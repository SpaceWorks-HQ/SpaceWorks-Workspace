import "server-only";

export function groupMoney<T extends { kind: string; amountMinor: number }>(
  entries: T[],
  key: (entry: T) => string,
): Array<{
  name: string;
  incomeMinor: number;
  expenseMinor: number;
  netMinor: number;
  count: number;
}>;
export function groupMoney<T extends { kind: string; amountMinor: number }>(
  entries: T[],
  key: (entry: T) => string,
) {
  const groups = new Map<
    string,
    {
      name: string;
      incomeMinor: number;
      expenseMinor: number;
      netMinor: number;
      count: number;
    }
  >();
  for (const e of entries) {
    const name = key(e);
    const g = groups.get(name) ?? {
      name,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      count: 0,
    };
    if (e.kind === "INCOME") g.incomeMinor += e.amountMinor;
    else g.expenseMinor += e.amountMinor;
    g.count++;
    g.netMinor = g.incomeMinor - g.expenseMinor;
    groups.set(name, g);
  }
  return [...groups.values()].sort(
    (a, b) => b.expenseMinor + b.incomeMinor - (a.expenseMinor + a.incomeMinor),
  );
}
