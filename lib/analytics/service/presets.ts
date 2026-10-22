import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AnalyticsError, type Actor } from "../access";
import { querySchema } from "../metrics";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { lock, audit } from "./mutation-access";
export const presetSchema = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(100),
  query: querySchema,
  shared: z.boolean().default(false),
  pinned: z.boolean().default(false),
  commentary: z.string().trim().max(12000).default(""),
});
export async function savePreset(actor: Actor, raw: unknown): Promise<string> {
  const v = presetSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    const a = await lock(actor, tx);
    if (v.shared && !a.admin)
      throw new AnalyticsError("Ask an admin to share a report.");
    if (v.query.monthlyEmail) {
      if (
        !a.admin ||
        !v.shared ||
        v.query.period !== "last-month" ||
        !v.query.emailTo.length
      )
        throw new AnalyticsError(
          "Choose last month, share with admins, and select monthly email recipients.",
        );
      const ids = [...new Set(v.query.emailTo)];
      if (
        (await tx.membership.count({
          where: {
            workspaceId: a.workspace.id,
            userId: { in: ids },
            status: "ACTIVE",
            role: { in: ["OWNER", "ADMIN"] },
            user: { disabledAt: null },
          },
        })) !== ids.length
      )
        throw new AnalyticsError("Choose current admins in this workspace.");
    }
    if (
      v.id &&
      !(await tx.analyticsPreset.count({
        where: { id: v.id, workspaceId: a.workspace.id, ownerId: a.userId },
      }))
    )
      throw new AnalyticsError(
        "That report is unavailable. Refresh and try again.",
      );
    if (
      !v.id &&
      (await tx.analyticsPreset.count({
        where: { workspaceId: a.workspace.id, ownerId: a.userId },
      })) >= 100
    )
      throw new AnalyticsError(
        "Keep up to 100 saved reports. Remove one first.",
      );
    const data = {
      name: v.name,
      query: v.query,
      section: v.query.section,
      shared: v.shared,
      pinned: v.pinned,
      commentary: v.commentary,
    };
    const row = v.id
      ? await tx.analyticsPreset.update({ where: { id: v.id }, data })
      : await tx.analyticsPreset.create({
          data: { ...data, workspaceId: a.workspace.id, ownerId: a.userId },
        });
    await audit(actor, tx, row.id, "preset_saved");
    await recordActivity(
      {
        workspaceId: a.workspace.id,
        actorId: a.userId,
        verb: "saved",
        entityType: "analytics_preset",
        entityId: row.id,
        summary: "Saved an analytics report preset.",
        visibility: "PRIVATE",
      },
      tx,
    );
    await indexSearchDocument(
      {
        workspaceId: a.workspace.id,
        entityType: "analytics_preset",
        entityId: row.id,
        title: row.name,
        url: `/w/${a.workspace.slug}/analytics?preset=${row.id}`,
        visibility: "PRIVATE",
        ownerId: a.userId,
      },
      tx,
    );
    return row.id;
  });
}
export async function removePreset(actor: Actor, id: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const a = await lock(actor, tx);
    const r = await tx.analyticsPreset.deleteMany({
      where: { workspaceId: a.workspace.id, id, ownerId: a.userId },
    });
    if (!r.count)
      throw new AnalyticsError(
        "That report is unavailable. Refresh and try again.",
      );
    await audit(actor, tx, id, "preset_removed");
    await removeSearchDocument("analytics_preset", id, tx);
  });
}
