import { PageHeader } from "@/components/ui/display";
import { Patch } from "@/components/brand/Patch";
import { displayValue, queryString, displayDay } from "@/lib/analytics/metrics";
import type { DrillData } from "@/lib/analytics/types";
import { formatMoney } from "@/lib/format/money";
export function Drill({
  data,
  slug,
  metric,
}: {
  data: DrillData;
  slug: string;
  metric: string;
}) {
  const base = `/w/${slug}/analytics`;
  return (
    <div className="min-w-0 space-y-5">
      <a
        className="inline-flex min-h-11 items-center text-accent-text underline"
        href={`${base}?${queryString(data.q)}`}
      >
        Back to analytics
      </a>
      <PageHeader title={data.title} description={data.description} />
      <p>
        {displayDay(data.period.from)} to {displayDay(data.period.to)}
        {data.q.group ? ` · ${data.q.group}` : ""}
      </p>
      <a
        className="inline-flex min-h-11 items-center text-accent-text underline"
        href={`${base}/export?${queryString(data.q, { metric })}`}
      >
        Export these records as CSV
      </a>
      {!data.rows.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-panel p-6">
          <Patch size={90} />
          <p>No matching records. Try a wider period.</p>
          <a href={base} className="min-h-11 py-3 text-accent-text underline">
            Reset filters
          </a>
        </div>
      ) : (
        <div className="max-w-full overflow-x-auto rounded-xl border border-line bg-panel">
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">
              Underlying records for {data.title}
            </caption>
            <thead className="bg-surface text-accent-text">
              <tr>
                {["Date", "Record", "Group", "Value", "Denominator"].map(
                  (h) => (
                    <th scope="col" key={h} className="p-3">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={`${r.id}:${i}`} className="border-t border-line">
                  <td className="whitespace-nowrap p-3">
                    {displayDay(r.date)}
                  </td>
                  <th scope="row" className="min-w-40 p-3 font-normal">
                    <a
                      className="inline-flex min-h-11 items-center text-accent-text underline"
                      href={r.path}
                    >
                      {r.title}
                    </a>
                  </th>
                  <td className="p-3">{r.label}</td>
                  <td className="p-3 tabular-nums">
                    {data.basisUnit === "money"
                      ? formatMoney(r.value, data.q.currency ?? "INR")
                      : displayValue(
                          r.value,
                          data.basisUnit,
                          data.q.currency ?? "INR",
                        )}
                  </td>
                  <td className="p-3 tabular-nums">
                    {data.unit === "percent" && data.basisUnit === "money"
                      ? formatMoney(r.base, data.q.currency ?? "INR")
                      : r.base || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <nav aria-label="Record pages" className="flex gap-4">
        {data.page > 1 ? (
          <a
            className="min-h-11 py-3 text-accent-text underline"
            href={`?${queryString(data.q, { page: String(data.page - 1) })}`}
          >
            Previous page
          </a>
        ) : null}
        {data.more ? (
          <a
            className="min-h-11 py-3 text-accent-text underline"
            href={`?${queryString(data.q, { page: String(data.page + 1) })}`}
          >
            Next page
          </a>
        ) : null}
      </nav>
    </div>
  );
}
