import type { ChartKind, Point, Unit } from "@/lib/analytics/types";
import { displayValue } from "@/lib/analytics/metrics";
export function Chart({
  title,
  points,
  kind = "bar",
  unit = "count",
  currency = "INR",
  href,
  compact = false,
  basisUnit = "count",
  dimension = "group",
  openTable = false,
}: {
  title: string;
  points: Point[];
  kind?: ChartKind;
  unit?: Unit;
  currency?: string;
  href: string;
  compact?: boolean;
  basisUnit?: Unit;
  dimension?: "group" | "bucket";
  openTable?: boolean;
}) {
  const data = points,
    display = data.slice(0, 40),
    width = 640,
    height = compact ? 64 : 200,
    pad = 12,
    max = Math.max(
      unit === "percent" ? 100 : 1,
      ...display.map((p) => p.value),
    ),
    min = Math.min(0, ...display.map((p) => p.value)),
    x = (i: number) =>
      pad + (i * (width - pad * 2)) / Math.max(1, display.length - 1),
    y = (v: number) =>
      height - pad - (height - pad * 2) * ((v - min) / (max - min)),
    fmt = (v: number) => displayValue(v, unit, currency),
    link = (label: string) =>
      `${href}${href.includes("?") ? "&" : "?"}${dimension}=${encodeURIComponent(label)}`;
  const summary = display.length
    ? `${title}. ${data.length} groups. ${display.map((p) => `${p.label}: ${fmt(p.value)}`).join(". ")}.`
    : `${title}. No matching records.`;
  const line = display
    .map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p.value)}`)
    .join(" ");
  const radial = kind === "donut",
    total = display.reduce((s, p) => s + Math.max(0, p.value), 0);
  let offset = 0;
  return (
    <figure className="min-w-0" aria-label={title}>
      {display.length ? (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={summary}
          className="w-full overflow-visible"
        >
          <title>{title}</title>
          <desc>{summary}</desc>
          <line
            x1={pad}
            y1={y(0)}
            x2={width - pad}
            y2={y(0)}
            className="stroke-line"
          />
          {kind === "line" || kind === "sparkline" ? (
            <>
              <path
                d={line}
                className="stroke-primary"
                strokeWidth={compact ? 3 : 2}
                fill="none"
              />
              {display.map((p, i) => (
                <a
                  key={p.label}
                  href={link(p.label)}
                  aria-label={`${p.label}: ${fmt(p.value)}. Open records.`}
                >
                  <circle
                    cx={x(i)}
                    cy={y(p.value)}
                    r={compact ? 5 : 7}
                    className="fill-primary stroke-panel focus:stroke-ink"
                    strokeWidth="2"
                  >
                    <title>
                      {p.label}: {fmt(p.value)}
                    </title>
                  </circle>
                </a>
              ))}
            </>
          ) : radial ? (
            display.map((p, i) => {
              const length =
                  total > 0 ? (Math.max(0, p.value) / total) * 100 : 0,
                at = offset;
              offset += length;
              return (
                <a
                  key={p.label}
                  href={link(p.label)}
                  aria-label={`${p.label}: ${fmt(p.value)}. Open records.`}
                >
                  <circle
                    cx={width / 2}
                    cy={height / 2}
                    r="68"
                    fill="none"
                    strokeWidth="24"
                    pathLength="100"
                    strokeDasharray={`${length} ${100 - length}`}
                    strokeDashoffset={-at}
                    transform={`rotate(-90 ${width / 2} ${height / 2})`}
                    className={
                      [
                        "stroke-primary",
                        "stroke-info-fg",
                        "stroke-ink-secondary",
                        "stroke-ink-muted",
                      ][i % 4]
                    }
                  >
                    <title>
                      {p.label}: {fmt(p.value)}
                    </title>
                  </circle>
                </a>
              );
            })
          ) : kind === "funnel" ? (
            display.map((p, i) => {
              const row = (height - pad * 2) / display.length,
                w = ((width - 200) * Math.max(0, p.value)) / max;
              return (
                <a
                  key={p.label}
                  href={link(p.label)}
                  aria-label={`${p.label}: ${fmt(p.value)}. Open records.`}
                >
                  <text
                    x={pad}
                    y={pad + i * row + row * 0.65}
                    className="fill-ink"
                    fontSize={Math.min(14, row * 0.65)}
                  >
                    {p.label.slice(0, 24)}
                  </text>
                  <rect
                    x={180}
                    y={pad + i * row}
                    width={Math.max(2, w)}
                    height={Math.max(2, row - 5)}
                    rx="3"
                    className="fill-primary"
                  >
                    <title>
                      {p.label}: {fmt(p.value)}
                    </title>
                  </rect>
                </a>
              );
            })
          ) : kind === "calendar" ? (
            display.map((p, i) => (
              <a
                key={p.label}
                href={link(p.label)}
                aria-label={`${p.label}: ${fmt(p.value)}. Open records.`}
              >
                <rect
                  x={pad + (i % 14) * 44}
                  y={pad + Math.floor(i / 14) * 50}
                  width="38"
                  height="38"
                  rx="5"
                  className={
                    p.value >= 90
                      ? "fill-primary"
                      : p.value >= 50
                        ? "fill-warning-solid"
                        : "fill-danger-solid"
                  }
                >
                  <title>
                    {p.label}: {fmt(p.value)}
                  </title>
                </rect>
              </a>
            ))
          ) : (
            display.map((p, i) => {
              const bar = (width - pad * 2) / display.length,
                bh = Math.max(2, Math.abs(y(p.value) - y(0)));
              return (
                <a
                  key={p.label}
                  href={link(p.label)}
                  aria-label={`${p.label}: ${fmt(p.value)}. Open records.`}
                >
                  {kind === "stacked" ? (
                    <rect
                      x={pad + i * bar}
                      y={pad}
                      width={Math.max(2, bar - 4)}
                      height={height - pad * 2}
                      rx="3"
                      className="fill-track"
                    />
                  ) : null}
                  <rect
                    x={pad + i * bar}
                    y={Math.min(y(0), y(p.value))}
                    width={Math.max(2, bar - 4)}
                    height={bh}
                    rx="3"
                    className={
                      p.value < 0 ? "fill-danger-solid" : "fill-primary"
                    }
                  >
                    <title>
                      {p.label}: {fmt(p.value)}
                    </title>
                  </rect>
                </a>
              );
            })
          )}
        </svg>
      ) : (
        <p className="py-6 text-ink-muted">No matching records.</p>
      )}
      <details
        open={openTable}
        className={compact ? "sr-only focus-within:not-sr-only" : "mt-3"}
      >
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          View chart data ({data.length} groups)
        </summary>
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <caption className="sr-only">{title} data</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="p-2">
                  Group
                </th>
                <th scope="col" className="p-2">
                  Value
                </th>
                <th scope="col" className="p-2">
                  Records
                </th>
                {unit === "percent" ? (
                  <>
                    <th scope="col" className="p-2">
                      Numerator
                    </th>
                    <th scope="col" className="p-2">
                      Denominator
                    </th>
                    {basisUnit === "money" ? (
                      <th scope="col" className="p-2">
                        Remaining
                      </th>
                    ) : null}
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.label} className="border-b border-line">
                  <th scope="row" className="p-2 font-normal">
                    <a
                      className="text-accent-text underline"
                      href={link(p.label)}
                    >
                      {p.label}
                    </a>
                  </th>
                  <td className="p-2 tabular-nums">
                    <a href={link(p.label)}>{fmt(p.value)}</a>
                  </td>
                  <td className="p-2">
                    <a href={link(p.label)}>{p.count}</a>
                  </td>
                  {unit === "percent" ? (
                    <>
                      <td className="p-2">
                        {displayValue(p.numerator ?? 0, basisUnit, currency)}
                      </td>
                      <td className="p-2">
                        {displayValue(p.base, basisUnit, currency)}
                      </td>
                      {basisUnit === "money" ? (
                        <td className="p-2">
                          {displayValue(
                            p.base - (p.numerator ?? 0),
                            basisUnit,
                            currency,
                          )}
                        </td>
                      ) : null}
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length > 40 ? (
          <p className="text-ink-muted">
            The chart shows the first 40 groups. The table and CSV include every
            group.
          </p>
        ) : null}
      </details>
    </figure>
  );
}
