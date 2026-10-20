// Generated from app/w/[workspaceSlug]/ideas/[ideaId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadIdeaPage({
  params,
}: PageProps<"/w/[workspaceSlug]/ideas/[ideaId]">) {
const { workspaceSlug, ideaId } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canContribute(actor.membership)) notFound();
const idea = await prisma.idea.findFirst({
    where: { workspaceId: actor.workspace.id, id: ideaId },
    include: {
      _count: { select: { votes: true } },
      votes: { where: { userId: actor.user.id }, select: { userId: true } },
    },
  });
if (!idea) notFound();
const [choices, comments, alternatives, merged] = await Promise.all([
    collaborationChoices(actor),
    prisma.activityEvent.findMany({
      where: {
        workspaceId: actor.workspace.id,
        entityType: "idea_comment",
        entityId: idea.id,
      },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    prisma.idea.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: { not: ideaId },
        convertedId: null,
      },
      select: { id: true, title: true },
      take: 200,
    }),
    prisma.idea.findMany({
      where: {
        workspaceId: actor.workspace.id,
        convertedType: "idea",
        convertedId: idea.id,
      },
      select: { id: true, title: true },
    }),
  ]);
const isMerged = idea.convertedType === "idea";
return viewDto({ actor, idea, choices, comments, alternatives, merged, isMerged } as const);
}
