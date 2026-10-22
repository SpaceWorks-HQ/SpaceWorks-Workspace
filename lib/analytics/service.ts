import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { analyticsAccess, AnalyticsError, type Actor } from "./access";
import type { AdjustmentView } from "./types";
import { dateSchema } from "./metrics";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { lock, audit } from "./service/mutation-access";
export { presetSchema, savePreset, removePreset } from "./service/presets";
export const adjustmentSchema = z.object({
  id: z.string().max(64).optional(),
  title: z.string().trim().min(1).max(140),
  dueOn: dateSchema,
  amountMinor: z
    .number()
    .int()
    .min(-2147483647)
    .max(2147483647)
    .refine((n) => n !== 0),
  currency: z.string().regex(/^[A-Z]{3}$/),
  fundId: z.string().max(64).nullable().default(null),
  costCentreId: z.string().max(64).nullable().default(null),
  notes: z.string().trim().max(4000).default(""),
});
export async function saveAdjustment(
  actor: Actor,
  raw: unknown,
): Promise<string> {
  const v = adjustmentSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const a = await lock(actor, tx);
    if (!a.admin)
      throw new AnalyticsError("Ask an admin to change the forecast.");
    if (
      !v.id &&
      (await tx.analyticsAdjustment.count({
        where: { workspaceId: a.workspace.id, currency: v.currency },
      })) >= 200
    )
      throw new AnalyticsError(
        "Keep up to 200 adjustments per currency. Remove an obsolete assumption first.",
      );
    const where = { workspaceId: a.workspace.id, id: v.id };
    if (v.id && !(await tx.analyticsAdjustment.count({ where })))
      throw new AnalyticsError("That adjustment is unavailable.");
    if (
      v.fundId &&
      !(await tx.financeFund.count({
        where: {
          workspaceId: a.workspace.id,
          id: v.fundId,
          currency: v.currency,
          archivedAt: null,
        },
      }))
    )
      throw new AnalyticsError(
        "Choose a fund in this workspace with the same currency.",
      );
    if (
      v.costCentreId &&
      !(await tx.financeCostCentre.count({
        where: {
          workspaceId: a.workspace.id,
          id: v.costCentreId,
          archivedAt: null,
        },
      }))
    )
      throw new AnalyticsError("Choose a cost centre in this workspace.");
    const { id, ...values } = v;
    const data = { ...values, dueOn: new Date(v.dueOn) };
    const row = id
      ? await tx.analyticsAdjustment.update({ where: { id }, data })
      : await tx.analyticsAdjustment.create({
          data: { ...data, workspaceId: a.workspace.id, createdById: a.userId },
        });
    await audit(actor, tx, row.id, "adjustment_saved");
    await indexSearchDocument(
      {
        workspaceId: a.workspace.id,
        entityType: "analytics_adjustment",
        entityId: row.id,
        title: row.title,
        url: `/w/${a.workspace.slug}/analytics?section=finance#adjustments`,
        visibility: "PRIVATE",
        ownerId: a.userId,
      },
      tx,
    );
    return row.id;
  });
}
export async function removeAdjustment(
  actor: Actor,
  id: string,
): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const a = await lock(actor, tx);
    if (!a.admin)
      throw new AnalyticsError("Ask an admin to change the forecast.");
    const r = await tx.analyticsAdjustment.deleteMany({
      where: { workspaceId: a.workspace.id, id },
    });
    if (!r.count) throw new AnalyticsError("That adjustment is unavailable.");
    await audit(actor, tx, id, "adjustment_removed");
    await removeSearchDocument("analytics_adjustment", id, tx);
  });
}
export async function attachAdjustmentFiles(
  actor: Actor,
  id: string,
  files: File[],
): Promise<string[]> {
  const keys: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        const a = await lock(actor, tx);
        if (!a.admin) throw new AnalyticsError("Ask an admin to attach proof.");
        const row = await tx.analyticsAdjustment.findFirst({
          where: { workspaceId: a.workspace.id, id },
        });
        if (!row) throw new AnalyticsError("That adjustment is unavailable.");
        if (
          !files.length ||
          files.length > 10 ||
          files.reduce((s, f) => s + f.size, 0) > 24 * 1024 * 1024 ||
          row.fileIds.length + files.length > 20
        )
          throw new AnalyticsError(
            "Choose up to ten files, 24 MB combined, and twenty per adjustment.",
          );
        const ids: string[] = [];
        for (const file of files) {
          const r = await uploadWorkspaceFile({
            workspaceId: a.workspace.id,
            uploadedById: a.userId,
            file,
            folder: "/analytics/adjustments",
            allowedTypes: new Set([
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/heic",
              "application/pdf",
            ]),
            maxBytes: 10 * 1024 * 1024,
            client: tx,
          });
          if (!r.ok) throw new AnalyticsError(r.error);
          keys.push(r.file.storageKey);
          ids.push(r.file.id);
        }
        await tx.analyticsAdjustment.update({
          where: { id: row.id },
          data: { fileIds: { push: ids } },
        });
        await audit(actor, tx, id, "proof_attached");
        return ids;
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (keys.length) await deleteObjects(keys).catch(() => undefined);
    throw e;
  }
}
export async function adjustmentList(
  actor: Actor,
  currency: string,
): Promise<AdjustmentView[]> {
  const a = await analyticsAccess(actor);
  if (!a.admin) throw new AnalyticsError("That forecast is unavailable.");
  const rows = await prisma.analyticsAdjustment.findMany({
    where: { workspaceId: a.workspace.id, currency },
    orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    take: 201,
  });
  if (rows.length > 200)
    throw new AnalyticsError(
      "Remove old adjustments to keep up to 200 active forecast assumptions.",
    );
  const files = await prisma.fileObject.findMany({
    where: {
      workspaceId: a.workspace.id,
      id: { in: rows.flatMap((r) => r.fileIds) },
      deletedAt: null,
    },
    select: { id: true, filename: true, contentType: true },
  });
  return rows.map((r) => ({
    ...r,
    dueOn: r.dueOn.toISOString().slice(0, 10),
    files: files.filter((f) => r.fileIds.includes(f.id)),
  }));
}
