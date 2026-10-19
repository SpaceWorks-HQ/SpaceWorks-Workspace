export type MetricRow = { date: Date | string; query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };
export function summariseMetrics(rows: MetricRow[]) {
  const totals = rows.filter(r => !r.query && !r.page);
  const aggregate = (items: MetricRow[]) => {
    const clicks = items.reduce((n, r) => n + r.clicks, 0);
    const impressions = items.reduce((n, r) => n + r.impressions, 0);
    return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? items.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : 0 };
  };
  const top = (key: "query" | "page") => {
    const groups = new Map<string, MetricRow[]>();
    for (const row of rows) if (row[key] && !row[key === "query" ? "page" : "query"]) groups.set(row[key], [...groups.get(row[key]) ?? [], row]);
    return [...groups].map(([label, values]) => ({ label, ...aggregate(values) })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 25);
  };
  return { totals: aggregate(totals), daily: totals.map(r => ({ date: new Date(r.date).toISOString().slice(0, 10), ...aggregate([r]) })).sort((a, b) => a.date.localeCompare(b.date)), queries: top("query"), pages: top("page") };
}
