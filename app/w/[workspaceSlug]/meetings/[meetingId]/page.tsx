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
        {meeting.calendarEvent
          ? ` · Calendar: ${meeting.calendarEvent.title}`
          : ""}
      </p>
      {manage ? (
        <Disclosure title="Edit meeting and link notes">
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{
              op: "details",
              meetingId,
              startsAt: meeting.startsAt.toISOString(),
              endsAt: (
                meeting.endsAt ?? new Date(meeting.startsAt.getTime() + 3600000)
              ).toISOString(),
            }}
            label="Save meeting"
            fields={[
              {
                name: "title",
                label: "Title",
                value: meeting.title,
                required: true,
              },
              {
                name: "startsAt",
                label: "Starts at",
                type: "datetime-local",
                help: "Leave blank to keep the current time. New times use your device’s time zone.",
              },
              {
                name: "endsAt",
                label: "Ends at",
                type: "datetime-local",
                help: "Leave blank to keep the current end time.",
              },
              {
                name: "location",
                label: "Location",
                value: meeting.location ?? "",
              },
              {
                name: "notesDocId",
                label: "Notes document",
                type: "select",
                value: meeting.notesDocId ?? "",
                options: [
                  optionalChoice(),
                  ...choices.docs
                    .filter((d) => d.visibility === "WORKSPACE")
                    .map((d) => ({ value: d.id, label: d.title })),
                ],
              },
              {
                name: "status",
                label: "Status",
                type: "select",
                value: meeting.status,
                options: options([
                  "SCHEDULED",
                  "IN_PROGRESS",
                  "DONE",
                  "CANCELLED",
                ]),
                required: true,
              },
            ]}
          />
        </Disclosure>
      ) : null}
      <Section title="Notes">
        {doc ? (
          <a
            className="inline-flex min-h-11 items-center text-accent-text underline"
            href={`/w/${workspaceSlug}/docs/${doc.id}`}
          >
            {doc.title}
          </a>
        ) : (
          <p className="text-ink-muted">
            No notes document linked. The facilitator can link one above.
          </p>
        )}
      </Section>
      <Section
        title={`Agenda · ${meeting.agenda.reduce((n, a) => n + (a.durationMin ?? 0), 0)} minutes`}
      >
        {!meeting.agenda.length ? (
          <p className="text-ink-muted">
            No agenda items yet. Add the first topic below.
          </p>
        ) : (
          <ol className="space-y-5">
            {meeting.agenda.map((item, index) => (
              <li key={item.id} className="space-y-3 border-b border-line pb-4">
                <h3 className="text-title">
                  {index + 1}. {item.title}
                </h3>
                <p className="text-caption text-ink-muted">
                  {name(item.ownerId)} · {item.durationMin ?? 0} min ·{" "}
                  {item.status.toLowerCase().replaceAll("_", " ")}
                </p>
                <TextBody>{item.notesMd}</TextBody>
                {manage ? (
                  <>
                    <div className="flex flex-wrap gap-3">
                      {index > 0 ? (
                        <ActionForm
                          slug={workspaceSlug}
                          action={meetingAction}
                          hidden={{
                            op: "reorder",
                            meetingId,
                            agendaIds: agendaIds.toSpliced(
                              index - 1,
                              2,
                              item.id,
                              agendaIds[index - 1],
                            ),
                          }}
                          label={`Move topic ${index + 1} up`}
                        />
                      ) : null}
                      {index < agendaIds.length - 1 ? (
                        <ActionForm
                          slug={workspaceSlug}
                          action={meetingAction}
                          hidden={{
                            op: "reorder",
                            meetingId,
                            agendaIds: agendaIds.toSpliced(
                              index,
                              2,
                              agendaIds[index + 1],
                              item.id,
                            ),
                          }}
                          label={`Move topic ${index + 1} down`}
                        />
                      ) : null}
                    </div>
                    <details>
                      <summary className="min-h-11 cursor-pointer text-accent-text">
                        Edit topic {index + 1}
                      </summary>
                      <ActionForm
                        slug={workspaceSlug}
                        action={meetingAction}
                        hidden={{
                          op: "agendaUpdate",
                          meetingId,
                          agendaId: item.id,
                        }}
                        label="Save topic"
                        fields={[
                          {
                            name: "title",
                            label: "Topic",
                            value: item.title,
                            required: true,
                          },
                          {
                            name: "ownerId",
                            label: "Owner",
                            type: "select",
                            value: item.ownerId ?? "",
                            options: [optionalChoice(), ...choices.members],
                          },
                          {
                            name: "durationMin",
                            label: "Time box in minutes",
                            type: "number",
                            value: item.durationMin ?? 10,
                            min: 1,
                            max: 480,
                            required: true,
                          },
                          {
                            name: "notesMd",
                            label: "Topic notes",
                            type: "textarea",
                            value: item.notesMd ?? "",
                          },
                          {
                            name: "status",
                            label: "Status",
                            type: "select",
                            value: item.status,
                            options: options([
                              "OPEN",
                              "DISCUSSED",
                              "CARRIED_OVER",
                            ]),
                          },
                        ]}
                      />
                    </details>
                  </>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>
      {canContribute(actor.membership) ? (
        <Disclosure title="Add an agenda topic">
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{ op: "agenda", meetingId }}
            label="Add topic"
            reset
            fields={[
              { name: "title", label: "Topic", required: true },
              {
                name: "ownerId",
                label: "Owner",
                type: "select",
                options: [optionalChoice(), ...choices.members],
              },
              {
                name: "durationMin",
                label: "Time box in minutes",
                type: "number",
                value: 10,
                min: 1,
                max: 480,
                required: true,
              },
              { name: "notesMd", label: "Notes", type: "textarea" },
            ]}
          />
        </Disclosure>
      ) : null}
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
      <Section title="Attendees">
        <ul>
          {meeting.attendees.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3"
            >
              <span>
                {a.user?.name ?? "Former member"} · {a.rsvp.toLowerCase()}
                {a.attended === true
                  ? " · Attended"
                  : a.attended === false
                    ? " · Absent"
                    : ""}
              </span>
              {manage && a.userId ? (
                <ActionForm
                  slug={workspaceSlug}
                  action={meetingAction}
                  hidden={{
                    op: "attendance",
                    meetingId,
                    userId: a.userId,
                    attended: !a.attended,
                  }}
                  label={a.attended ? "Mark absent" : "Mark attended"}
                />
              ) : null}
            </li>
          ))}
        </ul>
        {meeting.attendees.some((a) => a.userId === actor.user.id) ? (
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{ op: "rsvp", meetingId }}
            label="Save your RSVP"
            fields={[
              {
                name: "rsvp",
                label: "Your response",
                type: "select",
                options: [
                  { value: "YES", label: "Going" },
                  { value: "MAYBE", label: "Maybe" },
                  { value: "NO", label: "Not going" },
                ],
              },
            ]}
          />
        ) : null}
      </Section>
      {manage ? (
        <>
          <Disclosure title="Add an attendee">
            <ActionForm
              slug={workspaceSlug}
              action={meetingAction}
              hidden={{ op: "attendee", meetingId }}
              label="Add attendee"
              fields={[
                {
                  name: "userId",
                  label: "Member",
                  type: "select",
                  options: choices.members,
                  required: true,
                },
              ]}
            />
          </Disclosure>
          <Disclosure
            title={meeting.summaryPublishedAt ? "Notes sent" : "Send notes to"}
          >
            {meeting.summaryPublishedAt ? (
              <p className="text-ink-muted">
                Notes were sent on{" "}
                {formatDayTime(
                  meeting.summaryPublishedAt,
                  actor.workspace.timezone,
                )}
                .
              </p>
            ) : (
              <ActionForm
                slug={workspaceSlug}
                action={meetingAction}
                hidden={{ op: "publish", meetingId }}
                label="Send notes"
                fields={
                  meeting.visibility === "WORKSPACE" && !meeting.teamId
                    ? [
                        {
                          name: "destinationIds",
                          label: "Send to",
                          type: "multi",
                          options: destinations.map((d) => ({
                            value: d.id,
                            label: d.name,
                          })),
                          help: "Attendees also receive a personal notification.",
                        },
                      ]
                    : []
                }
              />
            )}
          </Disclosure>
        </>
      ) : null}
    </CollaborationShell>
  );
}
