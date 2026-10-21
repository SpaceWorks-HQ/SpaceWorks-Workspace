import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { serial } from "@/lib/meetings/core";
import { recordActivity } from "@/lib/activity";
import { projectViewerIds } from "@/lib/tasks/access";

export async function transitionCycles(
  workspace: { id: string; slug: string },
  now: Date,
) {
  const cycles = await prisma.cycle.findMany({
    where: {
      workspaceId: workspace.id,
      status: { in: ["UPCOMING", "ACTIVE"] },
      startsAt: { lte: now },
      project: { cyclesEnabled: true, status: { not: "ARCHIVED" } },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });
  for (const candidate of cycles) {
    const notification = await serial(async (tx) => {
      const cycle = await tx.cycle.findFirst({
        where: { workspaceId: workspace.id, id: candidate.id },
        include: {
          tasks: { where: { workspaceId: workspace.id } },
          project: true,
        },
      });
      if (!cycle || cycle.status === "COMPLETED") return null;
      let type: "cycle.started" | "cycle.completed";
      if (cycle.endsAt <= now) {
        const next = await tx.cycle.findFirst({
          where: {
            workspaceId: workspace.id,
            projectId: cycle.projectId,
            id: { not: cycle.id },
            status: { not: "COMPLETED" },
            endsAt: { gt: now },
          },
          orderBy: { startsAt: "asc" },
        });
        await recordActivity(
          {
            workspaceId: workspace.id,
            entityType: "cycle_review",
            entityId: cycle.id,
            verb: "completed",
            summary: `Cycle ${cycle.number} completed`,
            projectId: cycle.projectId,
            teamId: cycle.teamId,
            data: {
              review: "Completed at the scheduled end time.",
              carriedToId: next?.id ?? null,
              tasks: cycle.tasks.map((t) => ({
                id: t.id,
                title: t.title,
                createdAt: t.createdAt.toISOString(),
                completedAt: t.completedAt?.toISOString() ?? null,
                archivedAt: t.archivedAt?.toISOString() ?? null,
              })),
            },
          },
          tx,
        );
        if (next)
          await tx.task.updateMany({
            where: {
              workspaceId: workspace.id,
              cycleId: cycle.id,
              completedAt: null,
              archivedAt: null,
            },
            data: { cycleId: next.id },
          });
        await tx.cycle.updateMany({
          where: {
            workspaceId: workspace.id,
            id: cycle.id,
            status: { not: "COMPLETED" },
          },
          data: { status: "COMPLETED" },
        });
        type = "cycle.completed";
      } else {
        if (
          cycle.status !== "UPCOMING" ||
          (await tx.cycle.findFirst({
            where: {
              workspaceId: workspace.id,
              projectId: cycle.projectId,
              status: "ACTIVE",
            },
          }))
        )
          return null;
        await tx.cycle.updateMany({
          where: {
            workspaceId: workspace.id,
            id: cycle.id,
            status: "UPCOMING",
          },
          data: { status: "ACTIVE" },
        });
        type = "cycle.started";
      }
      return dispatch(
        workspace.id,
        {
          type,
          title:
            type === "cycle.started"
              ? "A project cycle has started"
              : "A project cycle is complete",
          recipients: [
            ...(await projectViewerIds(workspace.id, cycle.project, tx)),
          ],
          useWorkspaceRules: false,
          scope: cycle.projectId ? { projectId: cycle.projectId } : {},
          url: `/w/${workspace.slug}/cycles/${cycle.id}`,
          resource: { type: "cycle", id: cycle.id },
          data: { cycleId: cycle.id, projectId: cycle.projectId },
        },
        { tx, now },
      );
    });
    await notification?.afterCommit();
  }
}
