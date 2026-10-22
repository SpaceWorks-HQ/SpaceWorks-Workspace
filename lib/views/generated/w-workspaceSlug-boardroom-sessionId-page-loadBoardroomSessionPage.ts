// Generated from app/w/[workspaceSlug]/boardroom/[sessionId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { hasRoleAtLeast, requireWorkspace } from "@/lib/permissions";

export async function loadBoardroomSessionPage({ params }: PageProps<"/w/[workspaceSlug]/boardroom/[sessionId]">) {
const { workspaceSlug, sessionId } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
const session = await prisma.boardroomSession.findFirst({
    where: { id: sessionId, workspaceId: workspace.id },
    select: {
      id: true,
      title: true,
      question: true,
      status: true,
      rounds: true,
      summary: true,
      createdAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      seats: { orderBy: { position: "asc" }, select: { id: true, name: true, persona: true } },
      turns: { orderBy: [{ round: "asc" }, { createdAt: "asc" }], select: { id: true, seatId: true, round: true, role: true, content: true } },
    },
  });
if (!session) notFound();
const names = new Map(session.seats.map((s) => [s.id, s.name]));
const seatTurns = session.turns.filter((t) => t.role === "SEAT");
const nextIndex = seatTurns.length;
const total = session.seats.length * session.rounds;
const speaking = session.status === "RUNNING" ? (nextIndex < total ? session.seats[nextIndex % session.seats.length]?.name ?? null : "The moderator") : null;
const base = `/w/${workspace.slug}/boardroom`;
const canDelete = session.createdById === user.id || hasRoleAtLeast(membership.role, "ADMIN");
return viewDto({ workspace, session, names, seatTurns, speaking, base, canDelete } as const);
}
