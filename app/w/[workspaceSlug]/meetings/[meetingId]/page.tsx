import { MeetingNotes } from "./MeetingNotes";
import { MeetingAgenda } from "./MeetingAgenda";
import { MeetingAttendance } from "./MeetingAttendance";
import { notFound } from "next/navigation";
import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { meetingWhere, managesMeeting } from "@/lib/meetings/service";
import { visibleTaskWhere } from "@/lib/tasks/access";
import { listPickableDestinations } from "@/lib/notify/scopedRules";
import {
  collaborationChoices,
  optionalChoice,
  options,
} from "@/lib/meetings/choices";
import { formatDayTime, formatTimeRange } from "@/lib/format/datetime";
import { meetingAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  Section,
  TextBody,
} from "@/components/meetings/Structure";
import { MeetLink } from "@/components/calendar/MeetLink";
import { Chip } from "@/components/ui/display";
export const metadata = { title: "Meeting" };
export default async function MeetingPage({
  params,
}: PageProps<"/w/[workspaceSlug]/meetings/[meetingId]">) {
  const { workspaceSlug, meetingId } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const meeting = await prisma.meeting.findFirst({
    where: { ...(await meetingWhere(actor)), id: meetingId },
    include: {
      calendarSyncs: { where: { userId: actor.user.id }, select: { lastError: true } },
      agenda: { orderBy: { sortOrder: "asc" } },
      decisions: {
        where: { workspaceId: actor.workspace.id },
        orderBy: { decidedAt: "asc" },
      },
      attendees: { include: { user: { select: { id: true, name: true } } } },
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
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title={meeting.title}
      description={`${formatDayTime(meeting.startsAt, actor.workspace.timezone)}${meeting.endsAt ? ` · ${formatTimeRange(meeting.startsAt, meeting.endsAt, actor.workspace.timezone)}` : ""}`}
    >
      <div className="flex flex-wrap gap-3">
        <Chip>{meeting.status.toLowerCase().replaceAll("_", " ")}</Chip>
        <Chip>{meeting.visibility.toLowerCase()} visibility</Chip>
        {meeting.seriesId ? <Chip>Recurring series</Chip> : null}
      </div>
      <p className="break-words text-body-ui text-ink-muted">
        {meeting.location || "No location set"} · Facilitated by{" "}
        {name(meeting.facilitatorId)}
      </p>
      <MeetLink url={meeting.videoUrl} pending={meeting.meetPending} error={meeting.calendarSyncs[0]?.lastError} />
      <MeetingNotes
        meeting={meeting}
        workspaceSlug={workspaceSlug}
        meetingId={meetingId}
        manage={manage}
        docs={choices.docs}
        doc={doc}
        optionalChoice={optionalChoice}
        options={options}
      />
      <MeetingAgenda
        agenda={meeting.agenda}
        agendaIds={agendaIds}
        workspaceSlug={workspaceSlug}
        meetingId={meetingId}
        members={choices.members}
        manage={manage}
        contribute={canContribute(actor.membership)}
        optionalChoice={optionalChoice}
        options={options}
      />
      <Section title="Decisions">
        {meeting.decisions.length ? (
          meeting.decisions.map((d) => (
            <article key={d.id} className="space-y-2 border-b border-line pb-4">
              <h3 className="text-title">{d.title}</h3>
              <p className="text-caption text-ink-muted">
                Owner: {d.deciderIds.map((id) => name(id)).join(", ")}
              </p>
              <TextBody>{d.contextMd}</TextBody>
              <TextBody>{d.decisionMd}</TextBody>
            </article>
          ))
        ) : (
          <p className="text-ink-muted">
            No decisions recorded. The facilitator can add the outcome below.
          </p>
        )}
      </Section>
      {manage ? (
        <Disclosure title="Record a decision">
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{ op: "decision", meetingId }}
            label="Record decision"
            reset
            fields={[
              { name: "title", label: "Decision", required: true },
              { name: "contextMd", label: "Context", type: "textarea" },
              {
                name: "decisionMd",
                label: "Outcome",
                type: "textarea",
                required: true,
              },
              {
                name: "ownerId",
                label: "Owner",
                type: "select",
                options: [optionalChoice("You"), ...choices.members],
              },
            ]}
          />
        </Disclosure>
      ) : null}
      <Section title="Action items">
        {tasks.length ? (
          <ul>
            {tasks.map((t) => (
              <li key={t.id} className="border-b border-line py-3">
                <a
                  className="text-accent-text underline"
                  href={
                    t.project
                      ? `/w/${workspaceSlug}/projects/${t.project.key}/${t.number}`
                      : `/w/${workspaceSlug}/t/${t.number}`
                  }
                >
                  #{t.number} {t.title}
                </a>
                <p className="text-caption text-ink-muted">
                  {t.completedAt ? "Done" : "Open"} ·{" "}
                  {t.assignees.map((a) => a.user.name).join(", ") ||
                    "Unassigned"}
                  {t.dueAt
                    ? ` · Due ${formatDayTime(t.dueAt, actor.workspace.timezone)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">
            No action items yet. Turn the next step into a task.
          </p>
        )}
      </Section>
      {manage && meeting.visibility !== "PRIVATE" ? (
        <Disclosure title="Create an action item">
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{ op: "action", meetingId }}
            label="Create task"
            reset
            fields={[
              { name: "title", label: "Action", required: true },
              {
                name: "projectId",
                label: "Project",
                type: "select",
                options: [
                  optionalChoice("No project"),
                  ...choices.projects
                    .filter(
                      (p) => !meeting.teamId || p.teamId === meeting.teamId,
                    )
                    .map((p) => ({ value: p.id, label: p.name })),
                ],
                help: meeting.teamId
                  ? "Choose a private project in the meeting's team."
                  : "Without a project, the task appears in My tasks.",
              },
              {
                name: "assigneeId",
                label: "Assignee",
                type: "select",
                options: [optionalChoice(), ...choices.members],
              },
              {
                name: "dueAt",
                label: "Due at",
                type: "datetime-local",
                help: "Enter the time in your device's time zone.",
              },
            ]}
          />
        </Disclosure>
      ) : null}
      <MeetingAttendance
        meeting={meeting}
        workspaceSlug={workspaceSlug}
        meetingId={meetingId}
        members={choices.members}
        manage={manage}
        viewerId={actor.user.id}
        timezone={actor.workspace.timezone}
        destinations={destinations}
      />
    </CollaborationShell>
  );
}
