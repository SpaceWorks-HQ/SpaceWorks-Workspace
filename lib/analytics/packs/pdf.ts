import "server-only";
import { displayValue, displayDay } from "../metrics";
import { makeReportPdf } from "@/lib/finance/tools/pdf";
import { AnalyticsError } from "../access";
import type { MetricResult, PackData } from "../types";
export async function createPackPdf(
  data: PackData,
  currency: string,
): Promise<Buffer> {
  const format = (value: number | null, unit: MetricResult["unit"]) =>
    displayValue(value, unit, currency, true);
  const sections: Array<{
    title: string;
    rows: string[][];
    chart?: { label: string; value: number }[];
  }> = [
    {
      title: "Management commentary",
      rows: [
        [
          data.preset.commentary ||
            "No commentary added. Review before sharing outside the team.",
        ],
      ],
    },
    {
      title: "Reading this report",
      rows: [
        [
          "Private internal report. Values reflect source records available at export time. Payroll, donor rankings, private meetings and confidential help requests are excluded.",
        ],
        [
          "Current-state metrics are labelled and have no historical comparison. A blank baseline means no comparable records.",
        ],
      ],
    },
  ];
  if (data.forecast) {
    const f = data.forecast;
    if (!f.openingKnown)
      sections.push({
        title: "Cash-flow forecast",
        rows: [
          [
            "Opening cash has not been recorded. Add a finance account before using projected closing cash.",
          ],
          ...f.warnings.map((w) => [w]),
        ],
      });
    else
      sections.push({
        title: `Cash-flow forecast · as of ${displayDay(f.asOf)}`,
        chart: f.weekly.map((b) => ({
          label: displayDay(b.label),
          value: b.closingMinor,
        })),
        rows: [
          ["Opening cash", format(f.openingMinor, "money")],
          ["Low-balance threshold", format(f.thresholdMinor, "money")],
          ["Chart shows the first eight weeks; this table retains all twelve."],
          ...f.weekly.map((b) => [
            displayDay(b.label),
            `In ${format(b.incomeMinor, "money")}`,
            `Out ${format(b.expenseMinor, "money")}`,
            `Closing ${format(b.closingMinor, "money")}`,
            b.low ? "Below threshold" : "Above threshold",
          ]),
          ["Next six months"],
          ...f.monthly.map((b) => [
            displayDay(b.label),
            `Closing ${format(b.closingMinor, "money")}`,
            b.low ? "Below threshold" : "Above threshold",
          ]),
          ...f.warnings.map((w) => [w]),
        ],
      });
  }
  const basis: Record<string, [string, string, string]> = {
    budgets: ["Spent", "Budget", "Remaining"],
    campaigns: ["Raised", "Goal", "Still to raise"],
    "grant-utilisation": ["Spent", "Income", "Remaining"],
    bom: ["Estimated cost", "Awarded", "Award minus estimate"],
    "bom-received": ["Estimated cost", "Received", "Received minus estimate"],
  };
  for (const m of data.metrics) {
    const labels = basis[m.id];
    sections.push({
      title: m.title,
      chart: m.groups.map((p) => ({ label: p.label, value: p.value })),
      rows: [
        [
          format(m.value, m.unit),
          "Previous: " + format(m.previous, m.unit),
          "Last year: " + format(m.lastYear, m.unit),
        ],
        [m.description],
        ...m.groups.map((p) => [
          p.label,
          format(p.value, m.id === "win-rate" ? "count" : m.unit),
          `${p.count} record${p.count === 1 ? "" : "s"}`,
          ...(labels
            ? [
                `${labels[0]} ${format(p.numerator ?? 0, "money")}`,
                `${labels[1]} ${format(p.base, "money")}`,
                `${labels[2]} ${format(p.base - (p.numerator ?? 0), "money")}`,
              ]
            : []),
        ]),
      ],
    });
  }
  try {
    return await makeReportPdf({
      workspaceName: data.name,
      title: data.title,
      footerLabel: "Private internal report",
      strictText: true,
      subtitle: `${displayDay(data.period.from)} to ${displayDay(data.period.to)} | ${currency}`,
      sections,
    });
  } catch {
    throw new AnalyticsError(
      "Could not prepare the PDF. If the report includes characters outside the report font, use the print page to preserve them.",
    );
  }
}
