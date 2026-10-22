import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Chart } from "@/components/analytics/Chart";
import tokens from "../fixtures/design-tokens.json";
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
      expect(html).toContain('scope="row"');
      expect(html).toContain('role="region" aria-label="Recorded hours data" tabindex="0"');
      expect(html).toContain("h-12");
      // The source controls live in the table; tiny SVG marks are not touch targets.
      expect(html.split("</svg>")[0]).not.toContain("<a ");
      for (const link of html.matchAll(/<a\b[^>]+>/g)) expect(link[0]).toContain("min-h-11");
      expect(html).toContain("Team A");
      expect(html).toContain("<a");
      expect(html).not.toContain("NaN");
    },
  );
  it("gives calendar colours visible words and keeps the compact data control visible", () => {
    const html = renderToStaticMarkup(createElement(Chart, {
      title: "Attendance", kind: "calendar", unit: "percent", compact: true, href: "/records",
      points: [20, 60, 95].map((value) => ({ label: String(value), value, base: 100, count: 1 })),
    }));
    for (const word of ["High:", "Medium:", "Low:", "Recorded level"]) expect(html).toContain(word);
    expect(html.match(/<details[^>]*>/)?.[0]).not.toContain("sr-only");
    expect(html).toContain("fill-success-solid");
    expect(html).toContain("fill-warning-solid");
    expect(html).toContain("fill-danger-solid");
  });

  it.each(["light", "dark"] as const)("uses chart marks with at least 3:1 contrast on the %s panel", (mode) => {
    const p = tokens[mode];
    const luminance = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const colour of ["accent-ink", "success-ink", "warn-ink", "info-ink", "danger"] as const) {
      const [a, b] = [luminance(p[colour]), luminance(p.panel)].sort((a, b) => b - a);
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(3);
    }
    const html = renderToStaticMarkup(createElement(Chart, {
      title: "Groups", kind: "donut", href: "/records",
      points: [1, 2, 3, 4].map((value) => ({ label: `Group ${value}`, value, base: 0, count: 1 })),
    }));
    for (const token of ["accent-text", "success-solid", "warning-solid", "info-solid"]) expect(html).toContain(`stroke-${token}`);
    expect(html).not.toMatch(/(?:fill|stroke)-primary/);
    expect(html).toContain("<figcaption");
  });

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
