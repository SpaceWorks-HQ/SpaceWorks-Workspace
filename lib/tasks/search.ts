import "server-only";

import type { DbClient } from "@/lib/db";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { projectUrl, taskReference, taskUrl } from "@/lib/tasks/links";
import { htmlToText } from "@/lib/tasks/sanitize";

/** Keep global search in step with tasks and projects (titles and plain text only). */

type IndexableTask = { id: string; workspaceId: string; number: number; title: string; description: string | null; archivedAt: Date | null; creatorId: string | null };
type IndexableProject = { id: string; key: string; teamId: string | null } | null;

export async function indexTask(client: DbClient, workspaceSlug: string, task: IndexableTask, project: IndexableProject) {
  if (task.archivedAt) {
    await removeSearchDocument("task", task.id, client);
    return;
  }
  await indexSearchDocument(
    {
      workspaceId: task.workspaceId,
      entityType: "task",
      entityId: task.id,
      title: `${taskReference(project?.key, task.number)} ${task.title}`,
      body: htmlToText(task.description),
      url: taskUrl(workspaceSlug, project?.key, task.number),
      projectId: project?.id ?? null,
      teamId: project?.teamId ?? null,
      ownerId: task.creatorId,
    },
    client,
  );
}

export async function indexProject(
  client: DbClient,
  workspaceSlug: string,
  project: { id: string; workspaceId: string; key: string; name: string; description: string | null; status: string; teamId: string | null; ownerId: string | null },
) {
  if (project.status === "ARCHIVED") {
    await removeSearchDocument("project", project.id, client);
    return;
  }
  await indexSearchDocument(
    {
      workspaceId: project.workspaceId,
      entityType: "project",
      entityId: project.id,
      title: `${project.name} (${project.key})`,
      body: project.description ?? "",
      url: projectUrl(workspaceSlug, project.key),
      projectId: project.id,
      teamId: project.teamId,
      ownerId: project.ownerId,
    },
    client,
  );
}
