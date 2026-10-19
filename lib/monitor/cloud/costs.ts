/** Select one non-overlapping spend series per account/currency; balances and forecasts never count as actual usage. */
export function aggregateCosts(rows: Array<{ connectionId: string; currency: string; granularity: string; amount: number; periodStart: Date; periodEnd: Date; isEstimate: boolean }>) {
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = `${row.connectionId}:${row.currency}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  return [...groups.values()].map(group => {
    const daily = group.filter(r => r.granularity === "DAY");
    const latest = (kind: string) => group.filter(r => r.granularity === kind).sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
    const chosen = latest("MTD") ? [latest("MTD")!] : daily.length ? daily : latest("MONTH") ? [latest("MONTH")!] : [];
    return { connectionId: group[0].connectionId, currency: group[0].currency, spentMinor: Math.round(chosen.reduce((sum, row) => sum + row.amount, 0) * 100), isEstimate: chosen.some(r => r.isEstimate), forecastMinor: latest("FORECAST") ? Math.round(latest("FORECAST")!.amount * 100) : null };
  });
}
