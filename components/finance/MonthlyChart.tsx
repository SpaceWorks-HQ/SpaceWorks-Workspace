"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatMoney, formatMoneyCompact } from "@/lib/format/money";
import "./finance-chart.css";

export type MonthDatum = { month: string; label: string; incomeMinor: number; expenseMinor: number };

const HEIGHT = 240;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const BAR_MAX = 24;
const GAP = 2;

/** 0 → 1, 2, 5 × 10ⁿ steps so ticks land on clean numbers. */
function niceStep(max: number, ticks: number) {
  const raw = max / ticks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

function barPath(x: number, y: number, width: number, height: number) {
  if (height <= 0) return "";
  const r = Math.min(4, height, width / 2);
  const bottom = y + height;
  return `M${x},${bottom}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${bottom}Z`;
}

/**
 * Money in vs money out per month: grouped columns, one baseline, legend,
 * per-month hover/focus readout and a table view.
 */
export function MonthlyChart({ data, currency }: { data: MonthDatum[]; currency: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry!.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [asTable]);

  const money = (minor: number) => formatMoney(minor, currency);
  const peak = Math.max(0, ...data.flatMap((d) => [d.incomeMinor, d.expenseMinor]));
  const step = peak > 0 ? niceStep(peak, 4) : 1;
  const top = peak > 0 ? Math.ceil(peak / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = plotW / data.length;
  const bar = Math.max(4, Math.min(BAR_MAX, (band - 12 - GAP) / 2));
  const y = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const showEvery = band < 44 ? 2 : 1;
  const current = active === null ? null : data[active];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap items-center gap-4 text-caption text-ink-secondary" aria-label="Legend">
          <li className="flex items-center gap-2"><span aria-hidden className="fin-bg-income inline-block size-3 rounded-sm" />Money in</li>
          <li className="flex items-center gap-2"><span aria-hidden className="fin-bg-expense inline-block size-3 rounded-sm" />Money out</li>
        </ul>
        <Button variant="quiet" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>

      {asTable ? (
        <Table label="Money in and out by month">
          <THead>
            <TR>
              <TH scope="col">Month</TH>
              <TH scope="col" className="text-right">Money in</TH>
              <TH scope="col" className="text-right">Money out</TH>
              <TH scope="col" className="text-right">Net</TH>
            </TR>
          </THead>
          <TBody>
            {data.map((d) => (
              <TR key={d.month}>
                <TD>{d.label}</TD>
                <TD className="text-right tabular-nums">{money(d.incomeMinor)}</TD>
                <TD className="text-right tabular-nums">{money(d.expenseMinor)}</TD>
                <TD className="text-right tabular-nums">{money(d.incomeMinor - d.expenseMinor)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <div ref={frame} className="relative w-full">
          <svg width={width} height={HEIGHT} role="img" aria-label={`Money in and out for the last ${data.length} months. Use the table view for exact values.`} className="block max-w-full overflow-visible">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-xs tabular-nums">
                  {formatMoneyCompact(tick, currency)}
                </text>
              </g>
            ))}
            {data.map((d, index) => {
              const x0 = PAD.left + index * band + (band - (bar * 2 + GAP)) / 2;
              const incomeTop = y(d.incomeMinor);
              const expenseTop = y(d.expenseMinor);
              return (
                <g
                  key={d.month}
                  tabIndex={0}
                  role="img"
                  aria-label={`${d.label}: money in ${money(d.incomeMinor)}, money out ${money(d.expenseMinor)}`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive((a) => (a === index ? null : a))}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive((a) => (a === index ? null : a))}
                  className="group cursor-default outline-none"
                >
                  <rect x={PAD.left + index * band} y={PAD.top} width={band} height={plotH} className={`${active === index ? "fill-subtle" : "fill-transparent"} group-focus-visible:stroke-primary`} strokeWidth={2} rx={6} />
                  <path d={barPath(x0, incomeTop, bar, PAD.top + plotH - incomeTop)} className="fin-fill-income" />
                  <path d={barPath(x0 + bar + GAP, expenseTop, bar, PAD.top + plotH - expenseTop)} className="fin-fill-expense" />
                  {index % showEvery === 0 || index === data.length - 1 ? (
                    <text x={PAD.left + index * band + band / 2} y={HEIGHT - 8} textAnchor="middle" className="fill-ink-muted text-xs">
                      {d.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <line x1={PAD.left} x2={width - PAD.right} y1={y(0)} y2={y(0)} className="stroke-line-strong" strokeWidth={1} />
          </svg>
          {current ? (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-44 rounded-lg border border-line bg-panel px-3 py-2 shadow-float"
              style={{ left: Math.min(Math.max(PAD.left + active! * band + band / 2 - 88, 0), Math.max(0, width - 184)) }}
            >
              <p className="text-caption text-ink-muted">{current.label}</p>
              <p className="mt-1 flex items-center justify-between gap-4 text-body-ui">
                <span className="flex items-center gap-2 text-ink-secondary"><span aria-hidden className="fin-bg-income inline-block h-0.5 w-3" />In</span>
                <strong className="tabular-nums text-ink">{money(current.incomeMinor)}</strong>
              </p>
              <p className="flex items-center justify-between gap-4 text-body-ui">
                <span className="flex items-center gap-2 text-ink-secondary"><span aria-hidden className="fin-bg-expense inline-block h-0.5 w-3" />Out</span>
                <strong className="tabular-nums text-ink">{money(current.expenseMinor)}</strong>
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
