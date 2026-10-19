import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { buildWorkspaceExport } from "@/lib/shell/export";
import { jsonZip } from "@/lib/shell/zip";
import { parseCsv, mapLinkRows, csvMappingSchema } from "@/lib/shell/csv";
import { purgeWorkspace } from "@/lib/shell/retention";
import { putObject, getObject, deleteObjects } from "@/lib/storage";
import { dispatch } from "@/lib/notify";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordAuditEvent } from "@/lib/audit";
import { hasRoleAtLeast } from "@/lib/roles";
import { PERSONAL_CHANNEL_ADAPTERS } from "@/lib/notify/adapters";
import {
  DM_CHANNEL_PROVIDER,
  availablePersonalChannels,
} from "@/lib/notify/preferences";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import type { PersonalChannel } from "@prisma/client";

export async function processExport(now: Date): Promise<boolean> {
  let afterCommit: (() => Promise<void>) | undefined;
  const processed = await prisma.$transaction(
    async (tx) => {
      const jobs = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          requestedById: string | null;
          scope: unknown;
          format: string;
        }>
      >`SELECT * FROM "ExportJob" WHERE status='QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return false;
      const membership = job.requestedById
        ? await tx.membership.findFirst({
            where: {
              workspaceId: job.workspaceId,
              userId: job.requestedById,
              status: "ACTIVE",
              user: { disabledAt: null },
              workspace: { archivedAt: null },
            },
          })
        : null;
      if (!membership || !hasRoleAtLeast(membership.role, "ADMIN")) {
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            finishedAt: now,
            error: "The requester no longer has access.",
          },
        });
        return true;
      }
      try {
        await tx.exportJob.update({
          where: { id: job.id },
          data: { status: "RUNNING" },
        });
        const bundle = await buildWorkspaceExport(
          job.workspaceId,
          !!(
            job.scope &&
            typeof job.scope === "object" &&
            "includeMessages" in job.scope &&
            job.scope.includeMessages
          ),
          tx,
        );
        const json = JSON.stringify(bundle);
        if (Buffer.byteLength(json) > 50_000_000) throw new Error("too large");
        const key = `workspaces/${job.workspaceId}/exports/${job.id}/${randomUUID()}.${job.format === "JSON" ? "json" : "zip"}`;
        await putObject(
          key,
          job.format === "JSON" ? Buffer.from(json) : jsonZip(json),
          job.format === "JSON" ? "application/json" : "application/zip",
        );
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "SUCCEEDED",
            finishedAt: now,
            expiresAt: new Date(now.getTime() + 7 * 86400000),
            storageKey: key,
          },
        });
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: job.workspaceId },
          select: { slug: true },
        });
        const result = await dispatch(
          job.workspaceId,
          {
            type: "export.ready",
            title: "Your workspace export is ready",
            url: `/w/${workspace.slug}/settings/export`,
            recipients: [membership.userId],
            data: { exportJobId: job.id },
          },
          { tx, now },
        );
        afterCommit = result.afterCommit;
        await recordAuditEvent({
          workspaceId: job.workspaceId,
          action: "shell.export_completed",
          targetId: job.id,
          client: tx,
        });
      } catch {
        await tx.exportJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            error:
              "Couldn't create the export. Request a new export or contact the operator.",
          },
        });
      }
      return true;
    },
    { timeout: 120000, isolationLevel: "RepeatableRead", maxWait: 5000 },
  );
  await afterCommit?.();
  return processed;
}

export async function processImport(now: Date): Promise<boolean> {
  let afterCommit: (() => Promise<void>) | undefined;
  const result = await prisma.$transaction(
    async (tx) => {
      const jobs = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          requestedById: string | null;
          sourceFileId: string;
          mapping: unknown;
          dryRun: boolean;
          entityType: string;
        }>
      >`SELECT * FROM "ImportJob" WHERE status='QUEUED' ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = jobs[0];
      if (!job) return false;
      await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${job.workspaceId} FOR UPDATE`;
      const member = job.requestedById
        ? await tx.membership.findFirst({
            where: {
              workspaceId: job.workspaceId,
              userId: job.requestedById,
              status: "ACTIVE",
              user: { disabledAt: null },
              workspace: { archivedAt: null },
            },
          })
        : null;
      if (!member || !hasRoleAtLeast(member.role, "ADMIN")) {
        await tx.importJob.update({
          where: { id: job.id },
          data: { status: "CANCELLED", finishedAt: now },
        });
        return true;
      }
      const file = await tx.fileObject.findFirst({
        where: {
          id: job.sourceFileId,
          workspaceId: job.workspaceId,
          deletedAt: null,
          size: { lte: 1_000_000 },
        },
        select: { storageKey: true },
      });
      const object = file ? await getObject(file.storageKey) : null;
      const mapping = csvMappingSchema.safeParse(job.mapping);
      if (!object || !mapping.success || job.entityType !== "link") {
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            stats: {
              errors: [
                {
                  row: 0,
                  error: "The source file or column mapping is unavailable.",
                },
              ],
            },
          },
        });
        return true;
      }
      let rows: ReturnType<typeof mapLinkRows>;
      try {
        rows = mapLinkRows(
          parseCsv(Buffer.from(object.body).toString("utf8")),
          mapping.data,
        );
      } catch {
        await tx.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            finishedAt: now,
            stats: {
              errors: [
                {
                  row: 0,
                  error:
                    "The CSV could not be read. Check the file and try again.",
                },
              ],
            },
          },
        });
        return true;
      }
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: job.workspaceId },
        select: { slug: true },
      });
      let created = 0,
        skipped = 0;
      const errors = rows
        .filter((r) => r.error)
        .map((r) => ({ row: r.row, error: r.error }));
      // Invalid files remain a dry run; a commit is all-or-nothing for valid rows.
      if (!job.dryRun && !errors.length) {
        for (const row of rows) {
          if (!row.data) continue;
          if (
            await tx.linkItem.findFirst({
              where: { workspaceId: job.workspaceId, url: row.data.url },
              select: { id: true },
            })
          ) {
            skipped++;
            continue;
          }
          const link = await tx.linkItem.create({
            data: {
              ...row.data,
              workspaceId: job.workspaceId,
              createdById: job.requestedById,
            },
          });
          await indexSearchDocument(
            {
              workspaceId: job.workspaceId,
              entityType: "link",
              entityId: link.id,
              title: link.title,
              body: link.description ?? "",
              url: `/w/${workspace.slug}/links#${link.id}`,
            },
            tx,
          );
          created++;
        }
      }
      await tx.importJob.update({
        where: { id: job.id },
        data: {
          status: errors.length ? "FAILED" : "SUCCEEDED",
          finishedAt: now,
          stats: {
            total: rows.length,
            valid: rows.length - errors.length,
            created,
            updated: 0,
            skipped,
            errors,
          },
        },
      });
      const dispatched = await dispatch(
        job.workspaceId,
        {
          type: "import.finished",
          title: job.dryRun ? "CSV preview is ready" : "CSV import finished",
          url: `/w/${workspace.slug}/settings/import`,
          recipients: [member.userId],
          data: {
            importJobId: job.id,
            created,
            updated: 0,
            skipped,
            errors: errors.length,
          },
        },
        { tx, now },
      );
      afterCommit = dispatched.afterCommit;
      await recordAuditEvent({
        workspaceId: job.workspaceId,
        action: "shell.import_completed",
        targetId: job.id,
        metadata: { created, dryRun: job.dryRun },
        client: tx,
      });
      return true;
    },
    { timeout: 60000 },
  );
  await afterCommit?.();
  return result;
}

export async function flushDigest(now: Date) {
  await prisma.$transaction(
    async (tx) => {
      const first = await tx.notificationDigestItem.findFirst({
        where: { sentAt: null, dueAt: { lte: now } },
        orderBy: { dueAt: "asc" },
      });
      if (!first) return;
      const locked = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM "NotificationDigestItem" WHERE "workspaceId"=${first.workspaceId} AND "userId"=${first.userId} AND channel::text=${first.channel} AND "sentAt" IS NULL AND "dueAt"<=${now} ORDER BY "dueAt" LIMIT 500 FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return;
      const ids = locked.map((r) => r.id);
      const member = await tx.membership.findFirst({
        where: {
          workspaceId: first.workspaceId,
          userId: first.userId,
          status: "ACTIVE",
          user: { disabledAt: null },
          workspace: { archivedAt: null },
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
          workspace: { select: { id: true, name: true, slug: true } },
        },
      });
      if (!member || first.channel === "IN_APP") {
        await tx.notificationDigestItem.updateMany({
          where: { id: { in: ids } },
          data: { sentAt: now },
        });
        return;
      }
      const settings = await tx.notificationUserSettings.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: first.workspaceId,
            userId: first.userId,
          },
        },
      });
      if (
        deliveryTime({
          at: now,
          severity: "info",
          quietHours: parseQuietHours(settings?.quietHours),
          snoozedUntil: settings?.snoozedUntil,
        }).getTime() > now.getTime()
      )
        return;
      const links = await tx.externalIdentityLink.findMany({
        where: {
          workspaceId: first.workspaceId,
          userId: first.userId,
          connection: { workspaceId: first.workspaceId, status: "ACTIVE" },
        },
        include: { connection: true },
      });
      if (
        !availablePersonalChannels(
          member.role,
          links.map((l) => l.provider),
        ).has(first.channel)
      ) {
        await tx.notificationDigestItem.updateMany({
          where: { id: { in: ids } },
          data: { sentAt: now },
        });
        return;
      }
      const channel = first.channel as Exclude<PersonalChannel, "IN_APP">;
      const adapter = PERSONAL_CHANNEL_ADAPTERS[channel];
      if (!adapter.configured) return;
      const identity =
        channel === "EMAIL"
          ? null
          : (links.find((l) => l.provider === DM_CHANNEL_PROVIDER[channel]) ??
            null);
      const sent = await adapter.send({
        deliveryId: first.id,
        event: { id: first.id, type: "digest.ready" },
        message: {
          title: "Your Space Works digest",
          text: `You have ${ids.length} updates. Open your notification centre to catch up.`,
          url: new URL(
            `/w/${member.workspace.slug}/notifications`,
            process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3250",
          ).href,
          severity: "info",
          severityLabel: "Info",
          fields: [],
          actions: [],
          eventType: "digest.ready",
          workspace: member.workspace,
        },
        target: { type: "personal", channel, user: member.user, identity },
        thread: null,
        isTest: false,
      });
      if (sent.ok)
        await tx.notificationDigestItem.updateMany({
          where: {
            id: { in: ids },
            workspaceId: first.workspaceId,
            userId: first.userId,
          },
          data: { sentAt: now },
        });
    },
    { timeout: 60000 },
  );
}

export async function run(now: Date): Promise<void> {
  await processExport(now);
  await processImport(now);
  await flushDigest(now);
  // Expired downloads are denied independently of this object cleanup.
  const expired = await prisma.exportJob.findMany({
    where: {
      expiresAt: { lt: now },
      storageKey: { not: null },
      workspace: { legalHold: false },
    },
    take: 20,
  });
  for (const job of expired)
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ legalHold: boolean }>
      >`SELECT "legalHold" FROM "Workspace" WHERE id=${job.workspaceId} FOR UPDATE`;
      if (rows[0]?.legalHold) return;
      await deleteObjects([job.storageKey!]);
      await tx.exportJob.updateMany({
        where: {
          id: job.id,
          workspaceId: job.workspaceId,
          storageKey: job.storageKey,
        },
        data: { storageKey: null },
      });
    });
  const workspaces = await prisma.workspace.findMany({
    where: { legalHold: false },
    select: { id: true },
  });
  for (const workspace of workspaces) await purgeWorkspace(workspace.id, now);
}
