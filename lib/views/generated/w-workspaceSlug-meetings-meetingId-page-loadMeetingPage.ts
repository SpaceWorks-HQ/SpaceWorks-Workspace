// Generated from app/w/[workspaceSlug]/meetings/[meetingId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { meetingWhere, managesMeeting } from "@/lib/meetings/service";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import { collaborationChoices } from "@/lib/meetings/choices";

export async function loadMeetingPage({
  params,
}: PageProps<"/w/[workspaceSlug]/meetings/[meetingId]">) {
const { workspaceSlug, meetingId } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const meeting = await prisma.meeting.findFirst({
    where: { ...(await meetingWhere(actor)), id: meetingId },
    include: {
      agenda: { orderBy: { sortOrder: "asc" } },
      decisions: {
        where: { workspaceId: actor.workspace.id },
        orderBy: { decidedAt: "asc" },
      },
      attendees: { include: { user: { select: { id: true, name: true } } } },
      calendarEvent: { select: { title: true } },
    },
  });
if (!meeting) notFound();
const [choices, tasks, destinations] = await Promise.all([
    collaborationChoices(actor),
    prisma.task.findMany({
      where: {
        AND: [
          await visibleTaskWhere(actor),
          { sourceMeetingId: meeting.id, archivedAt: null },
        ],
      },
      include: {
        project: { select: { key: true } },
        assignees: { include: { user: { select: { name: true } } } },
      },
    }),
    listPickableDestinations(actor.workspace.id, actor.membership.role),
  ]);
const manage =
    canContribute(actor.membership) && managesMeeting(actor, meeting);
const name = (id: string | null) =>
    choices.members.find((m) => m.value === id)?.label ?? "Unassigned";
const doc = meeting.notesDocId
    ? choices.docs.find((d) => d.id === meeting.notesDocId)
    : null;
const agendaIds = meeting.agenda.map((a) => a.id);
return viewDto({ actor, meeting, choices, tasks, destinations, manage, doc, agendaIds } as const);
}
