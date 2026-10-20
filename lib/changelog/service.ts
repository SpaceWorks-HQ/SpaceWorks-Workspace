import "server-only";
import { z } from "zod";
import { dispatch } from "@/lib/notify";
import {
  type Actor,
  assertActor,
  ensure,
  id,
  title,
  date,
  changed,
  serial,
  admin,
} from "@/lib/meetings/core";
import { pickDestinations } from "@/lib/meetings/destinations";
import { fromDateInputValue } from "@/lib/tasks/localDate";

export const changelogCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title,
    bodyMd: z.string().trim().min(1).max(50_000),
    version: z.string().trim().max(50).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
    audience: z.enum(["INTERNAL", "PUBLIC"]).default("INTERNAL"),
  }),
  z.object({
    op: z.literal("edit"),
    entryId: id,
    title,
    bodyMd: z.string().trim().min(1).max(50_000),
    version: z.string().trim().max(50),
    tags: z.array(z.string().trim().min(1).max(40)).max(15),
  }),
  z.object({
    op: z.literal("publish"),
    entryId: id,
    publishedAt: date,
    destinationIds: z.array(id).max(50).default([]),
  }),
]);

export async function mutateChangelog(actor: Actor, input: unknown) {
  const raw: Record<string, unknown> =
    input && typeof input === "object"
      ? { ...(input as Record<string, unknown>) }
      : {};
  if (
    raw &&
    typeof raw === "object" &&
    typeof raw.publishedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.publishedAt)
  ) {
    const local = fromDateInputValue(raw.publishedAt, actor.workspace.timezone);
    ensure(local, "Choose a valid date.");
    raw.publishedAt = local;
  }
  const data = changelogCommand.parse(raw);
  const result = await serial(async (tx) => {
    await assertActor(actor, tx);
    ensure(admin(actor));
    if (data.op === "create") {
      const entry = await tx.changelogEntry.create({
        data: {
          workspaceId: actor.workspace.id,
          title: data.title,
          bodyMd: data.bodyMd,
          version: data.version,
          tags: data.tags,
          audience: data.audience,
          createdById: actor.user.id,
        },
      });
      await changed(
        tx,
        actor,
        "changelog",
        entry.id,
        entry.title,
        "changelog",
        "created",
        "",
        { visibility: "PRIVATE" },
      );
      return { id: entry.id, notification: null };
    }
    const entry = await tx.changelogEntry.findFirst({
      where: { workspaceId: actor.workspace.id, id: data.entryId },
    });
    ensure(entry);
    ensure(
      !entry.publishedAt,
      "Published entries are kept as a record. Create a correction entry.",
    );
    if (data.op === "edit") {
      await tx.changelogEntry.updateMany({
        where: { workspaceId: actor.workspace.id, id: entry.id },
        data: {
          title: data.title,
          bodyMd: data.bodyMd,
          version: data.version,
          tags: data.tags,
        },
      });
      await changed(
        tx,
        actor,
        "changelog",
        entry.id,
        data.title,
        "changelog",
        "updated",
        "",
        { visibility: "PRIVATE" },
      );
      return { id: entry.id, notification: null };
    }
    ensure(
      data.publishedAt <= new Date(),
      "Choose today or an earlier date to publish.",
    );
    const destinationIds = await pickDestinations(
      actor,
      data.destinationIds,
      tx,
    );
    await tx.changelogEntry.updateMany({
      where: { workspaceId: actor.workspace.id, id: entry.id },
      data: { publishedAt: data.publishedAt },
    });
    // The shared event catalogue has no release event. A changelog is a custom digest.
    const notification = destinationIds.length
      ? await dispatch(
          actor.workspace.id,
          {
            type: "digest.ready",
            title: entry.title.slice(0, 150),
            body: entry.bodyMd.slice(0, 3500),
            url: `/w/${actor.workspace.slug}/changelog`,
            actorId: actor.user.id,
            useWorkspaceRules: false,
            resource: { type: "changelog", id: entry.id },
            data: { frequency: "custom", jobId: null },
          },
          { tx, onlyDestinationIds: destinationIds },
        )
      : null;
    if (destinationIds.length)
      await tx.recordLink.createMany({
        data: destinationIds.map((destinationId) => ({
          workspaceId: actor.workspace.id,
          fromType: "changelog",
          fromId: entry.id,
          toType: "notification_destination",
          toId: destinationId,
          label: "Published to",
          createdById: actor.user.id,
        })),
        skipDuplicates: true,
      });
    await changed(
      tx,
      actor,
      "changelog",
      entry.id,
      entry.title,
      "changelog",
      "published",
      entry.bodyMd,
    );
    return { id: entry.id, notification };
  });
  await result.notification?.afterCommit();
  return { id: result.id };
}
