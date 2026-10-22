import "server-only";
import type { Meeting } from "@prisma/client";
import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { visibleProjectWhere, assignableMembers } from "@/lib/tasks/access";
import { nextWorkspaceSequence } from "@/lib/counters";
import { type Actor, ensure, changed } from "../core";
import type { meetingCommand } from "./validation";

export async function addAction(
  tx: Tx,
  actor: Actor,
  meeting: Meeting,
  data: Extract<z.infer<typeof meetingCommand>, { op: "action" }>,
) {
  // A task inherits project visibility; it must never broaden the meeting's audience.
  ensure(
    meeting.visibility !== "PRIVATE",
    "Private meeting actions stay in notes. Use a team meeting to create shared tasks.",
  );
  const existing = await tx.recordLink.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      fromType: "meeting_action",
      fromId: `${meeting.id}:${data.requestId}`,
      toType: "task",
    },
  });
  if (existing) return { id: existing.toId, notification: null };
  const project = data.projectId
    ? await tx.project.findFirst({
        where: {
          AND: [
            await visibleProjectWhere(actor, tx),
            { id: data.projectId, status: { not: "ARCHIVED" } },
          ],
        },
      })
    : null;
  if (data.projectId) ensure(project);
  if (meeting.teamId || meeting.visibility === "TEAM") {
    const team = project?.teamId
      ? await tx.team.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: project.teamId,
            visibility: "PRIVATE",
          },
        })
      : null;
    ensure(
      team && project?.teamId === meeting.teamId,
      "Choose a private-team project with the same audience as this meeting.",
    );
  }
  if (data.assigneeId)
    ensure(
      (await assignableMembers(actor.workspace.id, project, tx)).some(
        (m) => m.id === data.assigneeId,
      ),
      "Choose a member who can see this project.",
    );
  const column = project
    ? await tx.boardColumn.findFirst({
        where: {
          projectId: project.id,
          project: { workspaceId: actor.workspace.id },
          category: "TODO",
        },
        orderBy: { position: "asc" },
      })
    : null;
  const number = await nextWorkspaceSequence(tx, actor.workspace.id, "task");
  const task = await tx.task.create({
    data: {
      workspaceId: actor.workspace.id,
      sourceMeetingId: meeting.id,
      title: data.title,
      number,
      creatorId: actor.user.id,
      projectId: project?.id,
      columnId: column?.id,
      dueAt: data.dueAt,
      assignees: data.assigneeId
        ? { create: { userId: data.assigneeId } }
        : undefined,
    },
  });
  await tx.meetingActionItem.create({
    data: { meetingId: meeting.id, taskId: task.id },
  });
  await tx.recordLink.create({
    data: {
      workspaceId: actor.workspace.id,
      fromType: "meeting_action",
      fromId: `${meeting.id}:${data.requestId}`,
      toType: "task",
      toId: task.id,
      createdById: actor.user.id,
    },
  });
  const url = project ? `projects/${project.key}/${number}` : `t/${number}`;
  await changed(tx, actor, "task", task.id, task.title, url, "created", "", {
    teamId: project?.teamId,
    projectId: project?.id,
  });
  const notification = data.assigneeId
    ? await dispatch(
        actor.workspace.id,
        {
          type: "task.assigned",
          title: `You have a meeting action: ${task.title}`.slice(0, 150),
          actorId: actor.user.id,
          recipients: [data.assigneeId],
          useWorkspaceRules: !meeting.teamId,
          resource: { type: "task", id: task.id },
          scope: {
            taskId: task.id,
            ...(project ? { projectId: project.id } : {}),
          },
          url: `/w/${actor.workspace.slug}/${url}`,
          data: {
            taskId: task.id,
            taskNumber: number,
            projectId: project?.id ?? null,
          },
        },
        { tx },
      )
    : null;
  return { id: task.id, notification };
}
