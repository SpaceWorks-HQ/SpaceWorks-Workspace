import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Chart } from "@/components/analytics/Chart";
import type { ChartKind } from "@/lib/analytics/types";
describe("analytics accessible SVG chart kit", () => {
  it.each([
    "bar",
    "stacked",
    "line",
    "donut",
    "sparkline",
    "funnel",
    "calendar",
  ] as ChartKind[])(
    "offers source links, summary and table fallback for %s",
    (kind) => {
      const html = renderToStaticMarkup(
        createElement(Chart, {
          title: "Recorded hours",
          kind,
          href: "/records?period=month",
          points: [
            { label: "Team A", value: 40, base: 100, count: 2 },
            { label: "Team B", value: 60, base: 100, count: 3 },
          ],
        }),
      );
      expect(html).toContain('role="img"');
      expect(html).toContain("<desc>");
      expect(html).toContain("View chart data");
      expect(html).toContain("<caption");
      expect(html).toContain('scope="col"');
      expect(html).toContain("Team A");
      expect(html).toContain("<a");
      expect(html).not.toContain("NaN");
    },
  );
  it("handles zero, negative, single and empty series without invalid geometry", () => {
    for (const values of [[], [0], [-100, 0, 100]])
      for (const kind of ["line", "bar", "donut"] as ChartKind[]) {
        const html = renderToStaticMarkup(
          createElement(Chart, {
            title: "Closing cash",
            kind,
            href: "/records",
            points: values.map((value, i) => ({
              label: String(i),
              value,
              base: 0,
              count: 1,
            })),
          }),
        );
        expect(html).not.toMatch(/NaN|Infinity/);
      }
  });
});
