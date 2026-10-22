import { Chip } from "@/components/ui/display";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import type { ChartKind, Point, Unit } from "@/lib/analytics/types";
import { displayValue } from "@/lib/analytics/metrics";

export function ChartDataTable({
  title,
  data,
  kind,
  unit,
  currency,
  href,
  basisUnit,
  dimension,
  openTable,
}: {
  title: string;
  data: Point[];
  kind: ChartKind;
  unit: Unit;
  currency: string;
  href: string;
  basisUnit: Unit;
  dimension: "group" | "bucket";
  openTable: boolean;
}) {
  const fmt = (v: number) => displayValue(v, unit, currency),
    link = (label: string) =>
      `${href}${href.includes("?") ? "&" : "?"}${dimension}=${encodeURIComponent(label)}`;
  return (
    <details open={openTable} className="mt-3">
      <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
        View chart data ({data.length} groups)
      </summary>
      <Table label={`${title} data`}>
        <caption className="sr-only">{title} data</caption>
        <THead>
          <TR>
            <TH scope="col">
              Group
            </TH>
            <TH scope="col">
              Value
            </TH>
            <TH scope="col">
              Records
            </TH>
            {kind === "calendar" ? <TH scope="col">Recorded level</TH> : null}
            {unit === "percent" ? (
              <>
                <TH scope="col">
                  Numerator
                </TH>
                <TH scope="col">
                  Denominator
                </TH>
                {basisUnit === "money" ? (
                  <TH scope="col">
                    Remaining
                  </TH>
                ) : null}
              </>
            ) : null}
          </TR>
        </THead>
        <TBody>
          {data.map((p) => (
            <TR key={p.label}>
              <TH scope="row" className="whitespace-normal break-words font-normal">
                <a
                  className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                  href={link(p.label)}
                >
                  {p.label}
                </a>
              </TH>
              <TD className="tabular-nums">
                <a className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline" href={link(p.label)}>{fmt(p.value)}</a>
              </TD>
              <TD>
                <a className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline" href={link(p.label)}>{p.count}</a>
              </TD>
              {kind === "calendar" ? (
                <TD>
                  <Chip tone={p.value >= 90 ? "success" : p.value >= 50 ? "warning" : "danger"}>
                    {p.value >= 90 ? "High" : p.value >= 50 ? "Medium" : "Low"}
                  </Chip>
                </TD>
              ) : null}
              {unit === "percent" ? (
                <>
                  <TD>
                    {displayValue(p.numerator ?? 0, basisUnit, currency)}
                  </TD>
                  <TD>
                    {displayValue(p.base, basisUnit, currency)}
                  </TD>
                  {basisUnit === "money" ? (
                    <TD>
                      {displayValue(
                        p.base - (p.numerator ?? 0),
                        basisUnit,
                        currency,
                      )}
                    </TD>
                  ) : null}
                </>
              ) : null}
            </TR>
          ))}
        </TBody>
      </Table>
      {data.length > 40 ? (
        <p className="text-ink-muted">
          The chart shows the first 40 groups. The table and CSV include every
          group.
        </p>
      ) : null}
    </details>
  );
}
