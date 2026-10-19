import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { canContribute } from "@/lib/roles";
import { boardroomMarkdown } from "@/lib/assistant/boardroomPrompts";
import { notFoundResponse, PRIVATE_HEADERS } from "@/lib/assistant/http";

export const dynamic = "force-dynamic";

/** Markdown download of a Boardroom session (members of the workspace only). */
export async function GET(_request: Request, ctx: RouteContext<"/w/[workspaceSlug]/boardroom/[sessionId]/export">) {
  const { workspaceSlug, sessionId } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFoundResponse();
  const access = await findWorkspaceForUser(workspaceSlug, userId);
  if (!access || !canContribute(access.membership)) return notFoundResponse();
  const row = await prisma.boardroomSession.findFirst({
    where: { id: sessionId, workspaceId: access.workspace.id },
    select: {
      title: true,
      question: true,
      summary: true,
      createdAt: true,
      seats: { orderBy: { position: "asc" }, select: { id: true, name: true, persona: true } },
      turns: { orderBy: [{ round: "asc" }, { createdAt: "asc" }], select: { seatId: true, round: true, role: true, content: true } },
    },
  });
  if (!row) return notFoundResponse();
  const names = new Map(row.seats.map((seat) => [seat.id, seat.name]));
  const markdown = boardroomMarkdown({
    title: row.title,
    question: row.question,
    createdAt: row.createdAt,
    seats: row.seats,
    summary: row.summary,
    transcript: row.turns.map((turn) => ({ ...turn, seatName: turn.seatId ? names.get(turn.seatId) ?? "Seat" : "Moderator" })),
  });
  const filename = `boardroom-${row.createdAt.toISOString().slice(0, 10)}.md`;
  return new Response(markdown, {
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
