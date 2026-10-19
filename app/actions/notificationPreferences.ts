"use server";
import { Prisma, DigestFrequency, PersonalChannel } from "@prisma/client";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { publishToUser } from "@/lib/realtime";
import { shellContext } from "@/lib/shell/context";
import { notificationCentre } from "@/lib/shell/notifications";
import { NOTIFY_CATEGORIES } from "@/lib/notify/events";
import { availablePersonalChannels } from "@/lib/notify/preferences";
import { parseQuietHours } from "@/lib/notify/quietHours";
import { actionError, type ActionResult } from "@/lib/actionResult";
const changeSchema = z.object({
  operation: z.enum(["read", "all", "archive", "unread"]),
  ids: z.array(z.string().min(1).max(64)).max(100).default([]),
});
export async function notificationStateAction(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx)
    return actionError(
      "Couldn't update notifications. Sign in or try again in a minute.",
    );
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success)
    return actionError("Choose notifications and try again.");
  const { operation, ids } = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.notification.updateMany({
        where: {
          workspaceId: ctx.workspace.id,
          userId: ctx.user.id,
          archivedAt: null,
          ...(operation === "all" ? {} : { id: { in: ids } }),
        },
        data:
          operation === "archive"
            ? { archivedAt: new Date(), readAt: new Date() }
            : { readAt: operation === "unread" ? null : new Date() },
      });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: `shell.notifications_${operation}`,
        client: tx,
      });
    });
    await publishToUser(ctx.workspace.id, ctx.user.id, {
      type: "notification.updated",
    });
    revalidatePath(`/w/${slug}`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't update notifications. Try again.");
  }
}
export async function notificationSummaryAction(slug: string) {
  const ctx = await shellContext(slug, "GUEST", "search");
  if (!ctx) return null;
  const data = await notificationCentre(ctx.workspace.id, ctx.user.id);
  return {
    unread: data.unread,
    items: data.items
      .slice(0, 6)
      .map((n) => ({ id: n.id, title: n.title, read: !!n.readAt })),
  };
}
const prefSchema = z.object({
  category: z
    .string()
    .refine((value) => Object.hasOwn(NOTIFY_CATEGORIES, value)),
  channels: z.array(z.enum(PersonalChannel)).max(7),
  digestFrequency: z.enum(DigestFrequency),
});
export async function saveNotificationPreference(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx)
    return actionError(
      "Couldn't save preferences. Sign in or try again in a minute.",
    );
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success)
    return actionError("Check your preferences and try again.");
  const links = await prisma.externalIdentityLink.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
      verifiedAt: { lte: new Date() },
      connection: { workspaceId: ctx.workspace.id, status: "ACTIVE" },
    },
    select: { provider: true },
  });
  const available = availablePersonalChannels(
    ctx.membership.role,
    links.map((l) => l.provider),
  );
  if (parsed.data.channels.some((c) => !available.has(c)))
    return actionError(
      "Link your messaging account before choosing that channel.",
    );
  const data = {
    channels: [
      ...new Set<PersonalChannel>(["IN_APP", ...parsed.data.channels]),
    ],
    digestFrequency: parsed.data.digestFrequency,
  };
  try {
    await prisma.$transaction(async (tx) => {
      const key = {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        category: parsed.data.category,
      };
      await tx.notificationPreference.upsert({
        where: { workspaceId_userId_category: key },
        create: { ...key, ...data },
        update: data,
      });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.preferences_updated",
        metadata: { category: key.category },
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/notifications/preferences`);
    return { ok: true };
  } catch {
    return actionError("Couldn't save preferences. Try again.");
  }
}
const settingsSchema = z.object({
  quietHours: z.unknown().optional(),
  criticalBypassesQuiet: z.boolean(),
  snoozeMinutes: z.number().int().min(0).max(10080).optional(),
});
export async function saveNotificationSettings(
  slug: string,
  input: unknown,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx)
    return actionError(
      "Couldn't save settings. Sign in or try again in a minute.",
    );
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return actionError("Check the times and try again.");
  const quiet =
    parsed.data.quietHours == null
      ? null
      : parseQuietHours(parsed.data.quietHours);
  if (parsed.data.quietHours != null && !quiet)
    return actionError("Enter valid quiet hours and a time zone.");
  const data = {
    quietHours: quiet ? { ...quiet } : Prisma.DbNull,
    criticalBypassesQuiet: parsed.data.criticalBypassesQuiet,
    ...(parsed.data.snoozeMinutes === undefined
      ? {}
      : {
          snoozedUntil: parsed.data.snoozeMinutes
            ? new Date(Date.now() + parsed.data.snoozeMinutes * 60000)
            : null,
        }),
  };
  try {
    await prisma.$transaction(async (tx) => {
      const key = { workspaceId: ctx.workspace.id, userId: ctx.user.id };
      await tx.notificationUserSettings.upsert({
        where: { workspaceId_userId: key },
        create: { ...key, ...data },
        update: data,
      });
      await recordAuditEvent({
        workspaceId: key.workspaceId,
        actorId: key.userId,
        action: "shell.notification_settings_updated",
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/notifications`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't save settings. Try again.");
  }
}
export async function removeNotificationMute(
  slug: string,
  id: string,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx || !z.string().min(1).max(64).safeParse(id).success)
    return actionError("Couldn't unmute. Try again.");
  await prisma.notificationMute.deleteMany({
    where: { id, workspaceId: ctx.workspace.id, userId: ctx.user.id },
  });
  await recordAuditEvent({
    workspaceId: ctx.workspace.id,
    actorId: ctx.user.id,
    action: "shell.resource_unmuted",
  });
  revalidatePath(`/w/${slug}/notifications/preferences`);
  return { ok: true };
}

export async function muteNotificationResource(
  slug: string,
  notificationId: string,
): Promise<ActionResult> {
  const ctx = await shellContext(slug);
  if (!ctx || !z.string().min(1).max(64).safeParse(notificationId).success)
    return actionError("Couldn't mute these updates. Try again.");
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      workspaceId: ctx.workspace.id,
      userId: ctx.user.id,
    },
    include: { event: { select: { payload: true } } },
  });
  const payload = notification?.event?.payload;
  const raw =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "resource" in payload
      ? payload.resource
      : null;
  const resource = z
    .object({
      type: z.enum(["project", "channel", "thread", "monitor", "task"]),
      id: z.string().min(1).max(64),
    })
    .safeParse(raw);
  if (!resource.success)
    return actionError("These updates don't have a resource to mute.");
  const { canAccessResource } = await import("@/lib/search/query");
  const actor = {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    role: ctx.membership.role,
  };
  if (
    !(await canAccessResource(
      actor,
      resource.data.type === "thread" ? "message" : resource.data.type,
      resource.data.id,
    ))
  )
    return actionError("This resource is unavailable.");
  try {
    await prisma.$transaction(async (tx) => {
      const key = {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        resourceType: resource.data.type,
        resourceId: resource.data.id,
      };
      await tx.notificationMute.upsert({
        where: { workspaceId_userId_resourceType_resourceId: key },
        create: key,
        update: { until: null },
      });
      await recordAuditEvent({
        workspaceId: ctx.workspace.id,
        actorId: ctx.user.id,
        action: "shell.resource_muted",
        targetId: resource.data.id,
        client: tx,
      });
    });
    revalidatePath(`/w/${slug}/notifications`, "layout");
    return { ok: true };
  } catch {
    return actionError("Couldn't mute these updates. Try again.");
  }
}
