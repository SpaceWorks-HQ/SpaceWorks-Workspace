// Generated from app/w/[workspaceSlug]/cycles/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { cycleWhere } from "@/lib/cycles/service";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadCyclesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/cycles">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const [cycles, choices] = await Promise.all([
    prisma.cycle.findMany({
      where: await cycleWhere(actor),
      orderBy: { startsAt: "desc" },
      include: {
        project: { select: { name: true } },
        _count: { select: { tasks: true } },
      },
      take: 200,
    }),
    collaborationChoices(actor),
  ]);
const projects = choices.projects.filter((p) => p.cyclesEnabled);
return viewDto({ actor, cycles, projects } as const);
}
