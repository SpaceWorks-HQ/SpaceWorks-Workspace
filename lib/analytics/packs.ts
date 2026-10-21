import "server-only";
import { cashForecast } from "./forecast";
import { prisma } from "@/lib/db";
import { analyticsAccess, AnalyticsError, type Actor } from "./access";
import { loadMetrics, context } from "./queries";
import { displayValue, displayDay, querySchema, queryString } from "./metrics";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { makeReportPdf } from "@/lib/finance/tools/pdf";
import { recordAuditEvent } from "@/lib/audit";
import type { MetricResult, Section, PackData } from "./types";
export async function packData(
  actor: Actor,
  presetId: string,
  kind: "management" | "board",
  now = new Date(),
): Promise<PackData> {
  const a = await analyticsAccess(actor);
  if (!a.admin)
    throw new AnalyticsError("Ask an admin to prepare a report pack.");
  const preset = await prisma.analyticsPreset.findFirst({
    where: {
      workspaceId: a.workspace.id,
      id: presetId,
      OR: [{ ownerId: a.userId }, { shared: true }],
    },
  });
  if (!preset) throw new AnalyticsError("That report is unavailable.");
  const q = querySchema.parse(preset.query);
  q.currency ??= a.workspace.currency;
  const sections: Section[] =
    kind === "board"
      ? ["home", "funding", "operations"]
      : [
          "home",
          "finance",
          "funding",
          "people",
          "work",
          "operations",
          "marketing",
        ];
  const selected =
    kind === "board"
      ? [
          "income",
          "spending",
          "budgets",
          "donations",
          "campaigns",
          "grant-utilisation",
          "grant-reports",
          "impact-progress",
          "headcount",
          "project-health",
          "compliance",
          "risks",
        ]
      : [
          "income",
          "spending",
          "statement",
          "budgets",
          "document-receivables",
          "payables",
          "fixed-costs",
          "donations",
          "campaigns",
          "grant-pipeline",
          "grant-reports",
          "impact-progress",
          "headcount",
          "attendance",
          "hours",
          "project-health",
          "overdue-tasks",
          "milestones",
          "help-volume",
          "help-sla",
          "uptime",
          "mttr",
          "security",
          "compliance",
          "risks",
          "content",
          "win-rate",
        ];
  const metrics: MetricResult[] = [];
  const included = new Set<string>();
  for (const section of sections) {
    const result = await loadMetrics(
      actor,
      { ...q, section },
      now,
      true,
      selected.filter((id) => !included.has(id)),
    );
    for (const m of result.metrics)
      if (!included.has(m.id)) {
        included.add(m.id);
        metrics.push(m);
      }
  }
  const period = (await context(actor, q, now)).p,
    forecast =
      !q.fund && !q.centre && !q.team && !q.project && !q.programme
        ? await cashForecast(actor, q, now, false)
        : null;
  return {
    period,
    forecast,
    name: a.workspace.name,
    slug: a.workspace.slug,
    kind,
    preset: {
      id: preset.id,
      name: preset.name,
      commentary: preset.commentary,
      ownerId: preset.ownerId,
    },
    q,
    metrics,
    title:
      kind === "board"
        ? "Board and funder report"
        : "Monthly management report",
    print: `/w/${a.workspace.slug}/analytics/print?preset=${preset.id}&kind=${kind}`,
    query: queryString(q),
  };
}
export async function generatePack(
  actor: Actor,
  presetId: string,
  kind: "management" | "board",
): Promise<{ fileId: string }> {
  const data = await packData(actor, presetId, kind),
    currency =
      data.q.currency ?? (await analyticsAccess(actor)).workspace.currency;
  const body = await createPackPdf(data, currency);
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`;
        const a = await analyticsAccess(actor, tx);
        if (!a.admin) throw new AnalyticsError("That report is unavailable.");
        const preset = await tx.analyticsPreset.findFirst({
          where: {
            workspaceId: a.workspace.id,
            id: presetId,
            ownerId: a.userId,
          },
        });
        if (!preset || preset.fileIds.length >= 20)
          throw new AnalyticsError(
            "Save your own report preset, with room for up to twenty PDF snapshots.",
          );
        const uploaded = await uploadWorkspaceFile({
          workspaceId: a.workspace.id,
          uploadedById: a.userId,
          folder: "/analytics/reports",
          file: new File(
            [new Uint8Array(body)],
            `${kind}-report-${new Date().toISOString().slice(0, 10)}.pdf`,
            { type: "application/pdf" },
          ),
          client: tx,
        });
        if (!uploaded.ok) throw new AnalyticsError(uploaded.error);
        storageKey = uploaded.file.storageKey;
        await tx.analyticsPreset.update({
          where: { id: preset.id },
          data: { fileIds: { push: uploaded.file.id } },
        });
        await recordAuditEvent({
          workspaceId: a.workspace.id,
          actorId: a.userId,
          action: "analytics.pack_generated",
          targetType: "analytics_preset",
          targetId: preset.id,
          client: tx,
        });
        return { fileId: uploaded.file.id };
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (storageKey) await deleteObjects([storageKey]).catch(() => undefined);
    throw e;
  }
}

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
