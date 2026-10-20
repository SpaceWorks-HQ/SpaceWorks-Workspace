// Generated from app/w/[workspaceSlug]/cycles/[cycleId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cycleWhere } from "@/lib/cycles/service";

export async function loadCyclePage({
  params,
}: PageProps<"/w/[workspaceSlug]/cycles/[cycleId]">) {
const { workspaceSlug, cycleId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const cycle = await prisma.cycle.findFirst({
    where: { ...(await cycleWhere(actor)), id: cycleId },
    include: {
      tasks: {
        where: { workspaceId: actor.workspace.id },
        orderBy: { number: "asc" },
      },
      project: true,
    },
  });
if (!cycle) notFound();
const [tasks, next, review] = await Promise.all([
    prisma.task.findMany({
      where: {
        workspaceId: actor.workspace.id,
        projectId: cycle.projectId,
        cycleId: null,
        archivedAt: null,
        completedAt: null,
      },
      select: { id: true, title: true, number: true },
      take: 300,
    }),
    prisma.cycle.findMany({
      where: {
        ...(await cycleWhere(actor)),
        projectId: cycle.projectId,
        id: { not: cycle.id },
        status: { not: "COMPLETED" },
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.activityEvent.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "cycle_review",
        entityId: cycle.id,
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
const parsedSnapshot = z
    .object({
      review: z.string(),
      tasks: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          createdAt: z.coerce.date(),
          completedAt: z.coerce.date().nullable(),
          archivedAt: z.coerce.date().nullable(),
        }),
      ),
    })
    .safeParse(review?.data);
const snapshot = parsedSnapshot.success ? { success: true as const, data: parsedSnapshot.data } : { success: false as const };
const chartTasks = snapshot.success ? snapshot.data.tasks : cycle.tasks;
const done = chartTasks.filter((t) => t.completedAt).length;
return viewDto({ actor, cycle, tasks, next, review, snapshot, chartTasks, done } as const);
}
