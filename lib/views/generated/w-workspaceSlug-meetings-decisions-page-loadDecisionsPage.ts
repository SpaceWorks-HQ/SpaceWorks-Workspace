// Generated from app/w/[workspaceSlug]/meetings/decisions/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { decisionWhere } from "@/lib/meetings/service";

export async function loadDecisionsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/meetings/decisions">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const q = String((await searchParams).q ?? "").slice(0, 200);
const decisions = await prisma.decision.findMany({
    where: {
      AND: [
        await decisionWhere(actor),
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { contextMd: { contains: q, mode: "insensitive" } },
                { decisionMd: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    orderBy: { decidedAt: "desc" },
    take: 200,
    include: { meeting: { select: { title: true } } },
  });
const owners = await prisma.membership.findMany({
    where: { workspaceId: actor.workspace.id, status: "ACTIVE" },
    select: { user: { select: { id: true, name: true } } },
  });
return viewDto({ actor, q, decisions, owners } as const);
}
