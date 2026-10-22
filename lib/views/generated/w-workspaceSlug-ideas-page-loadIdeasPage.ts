// Generated from app/w/[workspaceSlug]/ideas/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadIdeasPage({
  params,
}: PageProps<"/w/[workspaceSlug]/ideas">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const ideas = await prisma.idea.findMany({
    where: {
      workspaceId: actor.workspace.id,
      OR: [{ convertedType: null }, { convertedType: { not: "idea" } }],
    },
    orderBy: [{ votes: { _count: "desc" } }, { createdAt: "desc" }],
    include: { _count: { select: { votes: true } } },
    take: 200,
  });
return viewDto({ ideas } as const);
}
