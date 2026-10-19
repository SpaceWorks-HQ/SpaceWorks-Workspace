import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { createTask } from "@/lib/tasks/service";
import { createProject } from "@/lib/projects/service";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { removeSearchDocument } from "@/lib/search/documents";
import {
  type Actor,
  assertActor,
  ensure,
  id,
  optionalId,
  title,
  text,
  changed,
  serial,
  admin,
} from "@/lib/meetings/core";
import { mergedVoterIds } from "./merge";

export const ideaCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    title,
    bodyMd: text,
    tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  }),
  z.object({ op: z.literal("vote"), ideaId: id }),
  z.object({
    op: z.literal("comment"),
    ideaId: id,
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({
    op: z.literal("edit"),
    ideaId: id,
    title,
    bodyMd: text,
    tags: z.array(z.string().trim().min(1).max(40)).max(15).default([]),
  }),
  z.object({
    op: z.literal("status"),
    ideaId: id,
    status: z.enum(["NEW", "UNDER_REVIEW", "PLANNED", "DONE", "DECLINED"]),
  }),
  z.object({ op: z.literal("merge"), ideaId: id, targetId: id }),
  z.object({
    op: z.literal("convert"),
    ideaId: id,
    type: z.enum(["task", "project"]),
    key: z.string().max(10).optional(),
    projectId: optionalId,
  }),
]);

export async function mutateIdea(actor: Actor, input: unknown) {
  const data = ideaCommand.parse(input);
  await assertActor(actor);
  if (data.op === "convert") {
    ensure(admin(actor));
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspace.id}), hashtext(${`idea:${data.ideaId}`}))`;
        const idea = await tx.idea.findFirst({
          where: { workspaceId: actor.workspace.id, id: data.ideaId },
        });
        ensure(idea);
        if (idea.convertedId) {
          ensure(
            idea.convertedType !== "idea",
            "Open the merged idea to convert it.",
          );
          return { id: idea.convertedId, type: idea.convertedType };
        }
        const result =
          data.type === "task"
            ? await createTask(actor, {
                title: idea.title,
                description: idea.bodyMd,
                projectId: data.projectId,
              })
            : await createProject(actor, {
                name: idea.title,
                key: data.key,
                description: idea.bodyMd?.slice(0, 2000),
              });
        ensure(result.ok, result.ok ? "" : result.error);
        await tx.idea.updateMany({
          where: { workspaceId: actor.workspace.id, id: idea.id },
          data: {
            status: "PLANNED",
            convertedType: data.type,
            convertedId: result.data!.id,
          },
        });
        await changed(
          tx,
          actor,
          "idea",
          idea.id,
          idea.title,
          `ideas/${idea.id}`,
          "converted",
          idea.bodyMd ?? "",
        );
        return { id: result.data!.id, type: data.type };
      },
      { timeout: 20_000 },
    );
  }
  return serial(async (tx) => {
    await assertActor(actor, tx);
    if (data.op === "create") {
      const idea = await tx.idea.create({
        data: {
          workspaceId: actor.workspace.id,
          title: data.title,
          bodyMd: data.bodyMd,
          authorId: actor.user.id,
          tags: data.tags,
        },
      });
      await changed(
        tx,
        actor,
        "idea",
        idea.id,
        idea.title,
        `ideas/${idea.id}`,
        "created",
        data.bodyMd,
      );
      return { id: idea.id };
    }
    const idea = await tx.idea.findFirst({
      where: { workspaceId: actor.workspace.id, id: data.ideaId },
    });
    ensure(idea);
    ensure(
      idea.convertedType !== "idea",
      "This idea was merged. Open the destination idea to continue.",
    );
    if (data.op === "edit") {
      ensure(
        !idea.convertedId && (admin(actor) || idea.authorId === actor.user.id),
        "Only the author or an admin can edit an unconverted idea.",
      );
      await tx.idea.updateMany({
        where: { workspaceId: actor.workspace.id, id: idea.id },
        data: { title: data.title, bodyMd: data.bodyMd, tags: data.tags },
      });
      await changed(
        tx,
        actor,
        "idea",
        idea.id,
        data.title,
        `ideas/${idea.id}`,
        "updated",
        data.bodyMd,
      );
      return { id: idea.id };
    } else if (data.op === "vote") {
      const exists = await tx.ideaVote.findFirst({
        where: {
          ideaId: idea.id,
          userId: actor.user.id,
          idea: { workspaceId: actor.workspace.id },
        },
      });
      if (exists)
        await tx.ideaVote.deleteMany({
          where: {
            ideaId: idea.id,
            userId: actor.user.id,
            idea: { workspaceId: actor.workspace.id },
          },
        });
      else
        await tx.ideaVote.create({
          data: { ideaId: idea.id, userId: actor.user.id },
        });
    } else if (data.op === "comment") {
      await recordActivity(
        {
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          entityType: "idea_comment",
          entityId: idea.id,
          verb: "commented",
          summary: "Commented on an idea",
          data: { body: data.body },
        },
        tx,
      );
    } else {
      ensure(admin(actor));
      if (data.op === "status")
        await tx.idea.updateMany({
          where: { workspaceId: actor.workspace.id, id: idea.id },
          data: { status: data.status },
        });
      else {
        ensure(data.targetId !== idea.id, "Choose another idea.");
        const target = await tx.idea.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: data.targetId,
            convertedId: null,
          },
          include: { votes: { select: { userId: true } } },
        });
        ensure(
          target && !idea.convertedId,
          "Only unconverted ideas can be merged.",
        );
        const sourceVotes = await tx.ideaVote.findMany({
          where: { ideaId: idea.id, idea: { workspaceId: actor.workspace.id } },
          select: { userId: true },
        });
        await tx.ideaVote.createMany({
          data: mergedVoterIds(
            target.votes.map((v) => v.userId),
            sourceVotes.map((v) => v.userId),
          ).map((userId) => ({ ideaId: target.id, userId })),
          skipDuplicates: true,
        });
        await tx.ideaVote.deleteMany({
          where: { ideaId: idea.id, idea: { workspaceId: actor.workspace.id } },
        });
        await tx.idea.updateMany({
          where: { workspaceId: actor.workspace.id, id: idea.id },
          data: {
            status: "DECLINED",
            convertedType: "idea",
            convertedId: target.id,
          },
        });
        await tx.recordLink.create({
          data: {
            workspaceId: actor.workspace.id,
            fromType: "idea",
            fromId: idea.id,
            toType: "idea",
            toId: target.id,
            label: "Merged duplicate",
            createdById: actor.user.id,
          },
        });
        await removeSearchDocument("idea", idea.id, tx);
        await recordAuditEvent({
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          action: "idea.merged",
          targetType: "Idea",
          targetId: idea.id,
          metadata: { targetId: target.id },
          client: tx,
        });
        await recordActivity(
          {
            workspaceId: actor.workspace.id,
            actorId: actor.user.id,
            entityType: "idea",
            entityId: target.id,
            verb: "merged",
            summary: `Merged a duplicate into ${target.title}`,
          },
          tx,
        );
      }
    }
    if (data.op !== "merge")
      await changed(
        tx,
        actor,
        "idea",
        idea.id,
        idea.title,
        `ideas/${idea.id}`,
        data.op,
        idea.bodyMd ?? "",
      );
    return { id: data.op === "merge" ? data.targetId : idea.id };
  });
}
