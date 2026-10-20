// Generated from app/w/[workspaceSlug]/meetings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { meetingWhere } from "@/lib/meetings/service";
import { templateWhere } from "@/lib/templates/service";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadMeetingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/meetings">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const [meetings, choices, events, templates] = await Promise.all([
    prisma.meeting.findMany({
      where: await meetingWhere(actor),
      orderBy: { startsAt: "desc" },
      take: 200,
      include: { _count: { select: { agenda: true, decisions: true } } },
    }),
    collaborationChoices(actor),
    prisma.communityEvent.findMany({
      where: {
        workspaceId: actor.workspace.id,
        cancelledAt: null,
        startsAt: { gte: new Date() },
      },
      select: { id: true, title: true },
      take: 100,
    }),
    prisma.template.findMany({
      where: { ...(await templateWhere(actor)), kind: "MEETING" },
      select: { id: true, name: true },
    }),
  ]);
return viewDto({ actor, meetings, choices, events, templates } as const);
}
