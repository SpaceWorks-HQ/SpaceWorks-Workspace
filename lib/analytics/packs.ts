import "server-only";
import { createPackPdf } from "./packs/pdf";
import { cashForecast } from "./forecast";
import { prisma } from "@/lib/db";
import { analyticsAccess, AnalyticsError, type Actor } from "./access";
import { loadMetrics, context } from "./queries";
import { querySchema, queryString } from "./metrics";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
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
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
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

export { createPackPdf } from "./packs/pdf";
