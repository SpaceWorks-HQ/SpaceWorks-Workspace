import "server-only";

import { publish } from "@/lib/realtime";
import { projectAudience } from "@/lib/tasks/access";

/**
 * Realtime nudges for boards and task pages. Events carry ids only;
 * clients refetch through the authorised loaders. Boards listen on
 * `project:<id>`, task pages on `task:<id>`. Private-team projects send to
 * their viewers only.
 */
export async function publishTaskChange(input: {
  workspaceId: string;
  project: { id: string; teamId: string | null } | null;
  taskIds: string[];
  type: "task.changed" | "task.created" | "task.removed" | "board.changed" | "comment.changed";
  actorId: string | null;
}) {
  const audience = await projectAudience(input.workspaceId, input.project).catch(() => undefined);
  const base = { actorId: input.actorId, ...(audience ? { audience } : {}) };
  if (input.project) {
    await publish(input.workspaceId, `project:${input.project.id}`, { ...base, type: input.type, data: { projectId: input.project.id, taskId: input.taskIds[0] ?? null } });
  }
  for (const taskId of input.taskIds.slice(0, 20)) {
    await publish(input.workspaceId, `task:${taskId}`, { ...base, type: input.type, data: { taskId } });
  }
}
