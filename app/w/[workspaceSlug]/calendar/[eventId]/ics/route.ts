import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { eventEntry } from "@/lib/community/feeds";
import { buildCalendar, icsFilename } from "@/lib/community/ics";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** One event as an .ics download (members of the workspace only). */
export async function GET(_request: Request, ctx: RouteContext<"/w/[workspaceSlug]/calendar/[eventId]/ics">) {
  const { workspaceSlug, eventId } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || eventId.length > 64) return notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) return notFound();
  const access = await findWorkspaceForUser(workspaceSlug, userId);
  if (!access) return notFound();
  const event = await prisma.communityEvent.findFirst({
    where: { id: eventId, workspaceId: access.workspace.id },
    select: { id: true, title: true, description: true, location: true, kind: true, startsAt: true, endsAt: true, cancelledAt: true, updatedAt: true },
  });
  if (!event) return notFound();
  const reply = await prisma.eventAttendee.findUnique({ where: { eventId_userId: { eventId: event.id, userId } }, select: { status: true } });
  const status = reply && reply.status !== "NOT_GOING" ? reply.status : null;
  const body = buildCalendar({
    name: access.workspace.name,
    timeZone: safeTimeZone(access.workspace.timezone),
    entries: [eventEntry(event, access.workspace.slug, status)],
    now: new Date(),
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFilename(event.title)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
