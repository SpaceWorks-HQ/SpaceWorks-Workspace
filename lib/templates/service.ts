import "server-only";
import { prisma, type DbClient } from "@/lib/db";
import { formatDate } from "@/lib/format/datetime";
import { createDoc } from "@/lib/docs/service";
import { createTask } from "@/lib/tasks/service";
import { createProject } from "@/lib/projects/service";
import {
  type Actor,
  assertActor,
  ensure,
  changed,
  checkTeam,
  serial,
  admin,
} from "@/lib/meetings/core";
import { applyTemplate } from "@/lib/templates/application";
import { taskUrl } from "@/lib/tasks/links";
import { removeSearchDocument } from "@/lib/search/documents";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { templateWhere } from "./service/queries";
import { templateCommand } from "./service/validation";

async function createdUrl(
  actor: Actor,
  kind: string,
  entityId: string,
  client: DbClient,
) {
  if (kind === "doc") return `/w/${actor.workspace.slug}/docs/${entityId}`;
  if (kind === "project") {
    const project = await client.project.findFirst({
      where: { workspaceId: actor.workspace.id, id: entityId },
      select: { key: true },
    });
    return project
      ? `/w/${actor.workspace.slug}/projects/${project.key}`
      : undefined;
  }
  const task = await client.task.findFirst({
    where: { workspaceId: actor.workspace.id, id: entityId },
    select: { number: true, project: { select: { key: true } } },
  });
  return task
    ? taskUrl(actor.workspace.slug, task.project?.key, task.number)
    : undefined;
}

export async function mutateTemplate(actor: Actor, input: unknown) {
  const data = templateCommand.parse(input);
  await assertActor(actor);
  if (data.op === "apply") {
    // Delegate cross-area creation to the owning services; no duplicated permission or content rules.
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspace.id}), hashtext(${`template:${data.requestId}`}))`;
        const previous = await tx.recordLink.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            fromType: "template_application",
            fromId: `${actor.user.id}:${data.requestId}`,
          },
        });
        if (previous)
          return {
            id: previous.toId,
            type: previous.toType,
            url: await createdUrl(actor, previous.toType, previous.toId, tx),
          };
        const template = await tx.template.findFirst({
          where: { ...(await templateWhere(actor, tx)), id: data.templateId },
        });
        ensure(template);
        ensure(
          template.kind !== "MEETING",
          "Choose this template when scheduling a meeting.",
        );
        const applied = applyTemplate(template.content, {
          date: formatDate(new Date(), actor.workspace.timezone),
          author: actor.user.name ?? "Member",
          workspace: actor.workspace.name,
        });
        // Content from restricted templates must never be created into a wider audience.
        ensure(
          template.scope === "WORKSPACE" && !template.teamId,
          "Use a workspace template when creating shared work.",
        );
        const created =
          template.kind === "DOC"
            ? await createDoc(actor, {
                templateId: template.id,
                title: applied.title,
              })
            : template.kind === "TASK"
              ? await createTask(actor, {
                  title: applied.title,
                  description: applied.html || applied.text,
                  projectId: data.projectId,
                })
              : await createProject(actor, {
                  name: applied.title,
                  key: data.key,
                  description: applied.text.slice(0, 2000),
                  template: "standard",
                });
        ensure(created.ok, created.ok ? "" : created.error);
        const entityId = created.data!.id;
        await tx.recordLink.create({
          data: {
            workspaceId: actor.workspace.id,
            fromType: "template_application",
            fromId: `${actor.user.id}:${data.requestId}`,
            toType: template.kind.toLowerCase(),
            toId: entityId,
            createdById: actor.user.id,
          },
        });
        await changed(
          tx,
          actor,
          "template",
          template.id,
          template.name,
          "templates",
          "applied",
          template.description ?? "",
          { visibility: template.scope, teamId: template.teamId },
        );
        return {
          id: entityId,
          type: template.kind.toLowerCase(),
          url: await createdUrl(
            actor,
            template.kind.toLowerCase(),
            entityId,
            tx,
          ),
        };
      },
      { timeout: 20_000 },
    );
  }
  return serial(async (tx) => {
    await assertActor(actor, tx);
    if (data.op === "create") {
      await checkTeam(actor, data.teamId, tx);
      ensure(
        data.scope !== "TEAM" || data.teamId,
        "Choose a team for a team template.",
      );
      const template = await tx.template.create({
        data: {
          workspaceId: actor.workspace.id,
          kind: data.kind,
          name: data.name,
          description: data.description,
          teamId: data.teamId,
          scope: data.scope,
          createdById: actor.user.id,
          content:
            data.kind === "MEETING"
              ? {
                  title: data.title,
                  text: data.text,
                  agenda: data.text
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 100),
                }
              : { title: data.title, text: data.text },
        },
      });
      await changed(
        tx,
        actor,
        "template",
        template.id,
        template.name,
        "templates",
        "created",
        data.description,
        { visibility: template.scope, teamId: template.teamId },
      );
      return { id: template.id };
    }
    const template = await tx.template.findFirst({
      where: { ...(await templateWhere(actor, tx)), id: data.templateId },
    });
    ensure(
      template && (admin(actor) || template.createdById === actor.user.id),
    );
    if (data.op === "edit") {
      ensure(["DOC", "PROJECT", "TASK", "MEETING"].includes(template.kind));
      await tx.template.updateMany({
        where: { workspaceId: actor.workspace.id, id: template.id },
        data: {
          name: data.name,
          description: data.description,
          content: {
            title: data.title,
            text: data.text,
            ...(template.kind === "MEETING"
              ? {
                  agenda: data.text
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .slice(0, 100),
                }
              : {}),
          },
        },
      });
      await changed(
        tx,
        actor,
        "template",
        template.id,
        data.name,
        "templates",
        "updated",
        data.description,
        {
          visibility: template.scope,
          teamId: template.teamId,
          ownerId: template.createdById,
        },
      );
      return { id: template.id };
    }
    await tx.template.deleteMany({
      where: { workspaceId: actor.workspace.id, id: template.id },
    });
    await removeSearchDocument("template", template.id, tx);
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "template.deleted",
      targetType: "Template",
      targetId: template.id,
      client: tx,
    });
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        entityType: "template",
        entityId: template.id,
        verb: "deleted",
        summary: `Deleted template ${template.name}`,
        visibility: template.scope,
        teamId: template.teamId,
      },
      tx,
    );
    return { id: template.id };
  });
}

export { templateWhere } from "./service/queries";
export { templateCommand } from "./service/validation";
