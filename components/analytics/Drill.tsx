import { EmptyState, PageHeader } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
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
        className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
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
        className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
        href={`${base}/export?${queryString(data.q, { metric })}`}
      >
        Export these records as CSV
      </a>
      {!data.rows.length ? (
        <EmptyState patch title="No matching records. Try a wider period." action={
          <a href={base} className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline">Reset filters</a>
        } />
      ) : (
        <Table label={`Underlying records for ${data.title}`}>
          <caption className="sr-only">
            Underlying records for {data.title}
          </caption>
          <THead>
            <TR>
              {["Date", "Record", "Group", "Value", "Denominator"].map(
                (h) => (
                  <TH scope="col" key={h}>
                    {h}
                  </TH>
                ),
              )}
            </TR>
          </THead>
          <TBody>
            {data.rows.map((r, i) => (
              <TR key={`${r.id}:${i}`}>
                <TD className="whitespace-nowrap">
                  {displayDay(r.date)}
                </TD>
                <TH scope="row" className="min-w-40 font-normal">
                  <a
                    className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                    href={r.path}
                  >
                    {r.title}
                  </a>
                </TH>
                <TD>{r.label}</TD>
                <TD className="tabular-nums">
                  {data.basisUnit === "money"
                    ? formatMoney(r.value, data.q.currency ?? "INR")
                    : displayValue(
                        r.value,
                        data.basisUnit,
                        data.q.currency ?? "INR",
                      )}
                </TD>
                <TD className="tabular-nums">
                  {data.unit === "percent" && data.basisUnit === "money"
                    ? formatMoney(r.base, data.q.currency ?? "INR")
                    : r.base || "—"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <nav aria-label="Record pages" className="flex gap-4">
        {data.page > 1 ? (
          <a
            className="inline-flex min-h-11 min-w-11 items-center py-3 text-accent-text underline"
            href={`?${queryString(data.q, { page: String(data.page - 1) })}`}
          >
            Previous page
          </a>
        ) : null}
        {data.more ? (
          <a
            className="inline-flex min-h-11 min-w-11 items-center py-3 text-accent-text underline"
            href={`?${queryString(data.q, { page: String(data.page + 1) })}`}
          >
            Next page
          </a>
        ) : null}
      </nav>
    </div>
  );
}
