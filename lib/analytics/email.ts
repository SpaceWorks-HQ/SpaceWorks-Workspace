import "server-only";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects, getObject } from "@/lib/storage";
import { analyticsAccess, AnalyticsError, type Actor } from "./access";
import { packData, createPackPdf } from "./packs";
import { querySchema } from "./metrics";
import { recordAuditEvent } from "@/lib/audit";
import { escapeHtml, type RenderedEmail } from "@/lib/email/templates";
/** A deterministic month claim makes retries/replicas enqueue only one copy per chosen admin. */
export async function queueMonthlyReport(
  actor: Actor,
  presetId: string,
  month: string,
  now = new Date(),
): Promise<number> {
  const data = await packData(actor, presetId, "management", now),
    a = await analyticsAccess(actor);
  if (!a.admin) throw new AnalyticsError("That report is unavailable.");
  const pdf = await createPackPdf(
    data,
    data.q.currency ?? a.workspace.currency,
  );
  let key: string | undefined;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${a.workspace.id} FOR UPDATE`;
        const live = await analyticsAccess(actor, tx);
        if (!live.admin)
          throw new AnalyticsError("That report is unavailable.");
        const preset = await tx.analyticsPreset.findFirst({
          where: {
            workspaceId: a.workspace.id,
            id: presetId,
            ownerId: a.userId,
            shared: true,
          },
        });
        if (!preset) return 0;
        const q = querySchema.parse(preset.query);
        if (!q.monthlyEmail || q.period !== "last-month") return 0;
        if (
          await tx.auditEvent.count({
            where: {
              workspaceId: a.workspace.id,
              action: "analytics.monthly_queued",
              targetId: preset.id,
              metadata: { path: ["month"], equals: month },
            },
          })
        )
          return 0;
        const recipients = await tx.membership.findMany({
          where: {
            workspaceId: a.workspace.id,
            userId: { in: q.emailTo },
            status: "ACTIVE",
            role: { in: ["OWNER", "ADMIN"] },
            user: { disabledAt: null },
          },
          select: { userId: true },
        });
        if (!recipients.length) return 0;
        if (preset.fileIds.length >= 20)
          throw new AnalyticsError(
            "Keep up to twenty report snapshots in one preset. Save a new preset for the next reporting year.",
          );
        const file = await uploadWorkspaceFile({
          workspaceId: a.workspace.id,
          uploadedById: a.userId,
          folder: "/analytics/reports",
          file: new File(
            [new Uint8Array(pdf)],
            `management-${data.period.from}-${data.period.to}.pdf`,
            { type: "application/pdf" },
          ),
          client: tx,
        });
        if (!file.ok) throw new AnalyticsError(file.error);
        key = file.file.storageKey;
        await tx.analyticsPreset.update({
          where: { id: preset.id },
          data: { fileIds: { push: file.file.id } },
        });
        for (const r of recipients)
          await tx.outboxMessage.create({
            data: {
              kind: "analytics.email",
              payload: {
                workspaceId: a.workspace.id,
                presetId: preset.id,
                fileId: file.file.id,
                checksum: file.file.checksum,
                ownerId: a.userId,
                recipientId: r.userId,
                month,
              },
            },
          });
        await recordAuditEvent({
          workspaceId: a.workspace.id,
          actorId: a.userId,
          action: "analytics.monthly_queued",
          targetType: "analytics_preset",
          targetId: preset.id,
          metadata: { month, recipients: recipients.length },
          client: tx,
        });
        return recipients.length;
      },
      { timeout: 60000 },
    );
  } catch (e) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw e;
  }
}
export async function renderAnalyticsEmail(
  raw: unknown,
): Promise<{ to: string; email: RenderedEmail }> {
  const v = z
      .object({
        workspaceId: z.string(),
        presetId: z.string(),
        fileId: z.string(),
        checksum: z.string(),
        ownerId: z.string(),
        recipientId: z.string(),
        month: z.string().regex(/^\d{4}-\d{2}$/),
      })
      .parse(raw),
    workspace = await prisma.workspace.findFirst({
      where: { id: v.workspaceId, archivedAt: null },
    });
  if (!workspace) throw new AnalyticsError("That report is unavailable.");
  const owner = await analyticsAccess({
      workspace,
      user: { id: v.ownerId },
      membership: { role: "GUEST" },
    }),
    recipient = await prisma.membership.findFirst({
      where: {
        workspaceId: workspace.id,
        userId: v.recipientId,
        status: "ACTIVE",
        role: { in: ["OWNER", "ADMIN"] },
        user: { disabledAt: null },
      },
      select: { user: { select: { email: true } } },
    }),
    preset = await prisma.analyticsPreset.findFirst({
      where: {
        workspaceId: workspace.id,
        id: v.presetId,
        ownerId: v.ownerId,
        shared: true,
        fileIds: { has: v.fileId },
      },
    });
  if (!owner.admin || !recipient || !preset)
    throw new AnalyticsError("That report is unavailable.");
  const q = querySchema.parse(preset.query);
  if (!q.monthlyEmail || !q.emailTo.includes(v.recipientId))
    throw new AnalyticsError("Monthly report email is disabled.");
  const file = await prisma.fileObject.findFirst({
    where: {
      workspaceId: workspace.id,
      id: v.fileId,
      deletedAt: null,
      checksum: v.checksum,
      folder: "/analytics/reports",
    },
  });
  if (!file) throw new AnalyticsError("That report is unavailable.");
  const stored = await getObject(file.storageKey);
  if (
    !stored ||
    createHash("sha256").update(stored.body).digest("hex") !== v.checksum
  )
    throw new AnalyticsError("The report checksum does not match.");
  return {
    to: recipient.user.email,
    email: {
      subject: `${workspace.name} · Monthly management report`,
      text: "Your private monthly management report is attached. Review its commentary and source notes before sharing.",
      html: `<p>Your private monthly management report for ${escapeHtml(workspace.name)} is attached.</p><p>Review the commentary and source notes before sharing.</p>`,
      attachments: [
        {
          filename: file.filename,
          content: Buffer.from(stored.body),
          contentType: "application/pdf",
        },
      ],
    },
  };
}
