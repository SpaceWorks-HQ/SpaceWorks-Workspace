import Link from "next/link";
import "./finance-chart.css";

/**
 * Single-series horizontal bars (one hue, the expense colour), value at the
 * tip in text tokens. Each row is a real list item, so the numbers are
 * readable without hovering and by screen readers.
 */
export function CategoryBars({ items }: { items: Array<{ label: string; value: number; display: string; href?: string }> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const label = <span className="truncate text-body-ui text-ink">{item.label}</span>;
        return (
          <li key={item.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
            {item.href ? (
              <Link href={item.href} className="min-w-0 truncate underline-offset-4 hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="fin-bg-expense block h-4 max-w-[calc(100%-6rem)] rounded-r-[4px]" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
              <span className="shrink-0 text-caption font-semibold tabular-nums text-ink-secondary">{item.display}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
