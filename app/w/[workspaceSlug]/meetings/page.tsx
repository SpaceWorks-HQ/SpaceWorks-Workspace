import { requireWorkspace, canContribute } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { meetingWhere } from "@/lib/meetings/service";
import { templateWhere } from "@/lib/templates/service";
import {
  collaborationChoices,
  optionalChoice,
  options,
} from "@/lib/meetings/choices";
import { formatDayTime } from "@/lib/format/datetime";
import { meetingAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import {
  CollaborationShell,
  Disclosure,
  EntryLink,
} from "@/components/meetings/Structure";
import { Chip, EmptyState } from "@/components/ui/display";
export const metadata = { title: "Meetings" };
export default async function MeetingsPage({
  params,
}: PageProps<"/w/[workspaceSlug]/meetings">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "GUEST");
  const [meetings, choices, templates] = await Promise.all([
    prisma.meeting.findMany({
      where: await meetingWhere(actor),
      orderBy: { startsAt: "desc" },
      take: 200,
      include: { _count: { select: { agenda: true, decisions: true } } },
    }),
    collaborationChoices(actor),
    prisma.template.findMany({
      where: { ...(await templateWhere(actor)), kind: "MEETING" },
      select: { id: true, name: true },
    }),
  ]);
  return (
    <CollaborationShell
      slug={workspaceSlug}
      title="Meetings"
      description={`Make time together useful, from the agenda to the next action. Dates shown in ${actor.workspace.timezone}.`}
    >
      <a
        className="inline-flex min-h-11 items-center text-accent-text underline"
        href={`/w/${workspaceSlug}/meetings/decisions`}
      >
        Search the decisions log
      </a>
      {canContribute(actor.membership) ? (
        <Disclosure title="Schedule a meeting" open={!meetings.length}>
          <ActionForm
            slug={workspaceSlug}
            action={meetingAction}
            hidden={{ op: "create" }}
            label="Schedule meeting"
            primary
            navigateTo={`/w/${workspaceSlug}/meetings/`}
            fields={[
              { name: "title", label: "Meeting title", required: true },
              {
                name: "startsAt",
                label: "Starts at",
                type: "datetime-local",
                required: true,
                help: "Enter times in your device's time zone.",
              },
              {
                name: "endsAt",
                label: "Ends at",
                type: "datetime-local",
                required: true,
              },
              { name: "location", label: "Location or call link" },
              {
                name: "visibility",
                label: "Who can open it",
                type: "select",
                options: [
                  { value: "WORKSPACE", label: "Workspace members" },
                  { value: "TEAM", label: "Team members and admins" },
                  { value: "PRIVATE", label: "Only you and admins" },
                ],
                required: true,
              },
              {
                name: "teamId",
                label: "Team",
                type: "select",
                options: [optionalChoice(), ...choices.teams],
              },
              {
                name: "facilitatorId",
                label: "Facilitator",
                type: "select",
                options: choices.members,
                value: actor.user.id,
              },
              {
                name: "attendeeIds",
                label: "Attendees",
                type: "multi",
                options: choices.members,
              },
              {
                name: "templateId",
                label: "Agenda template",
                type: "select",
                options: [
                  optionalChoice(),
                  ...templates.map((t) => ({ value: t.id, label: t.name })),
                ],
              },
              {
                name: "repeat",
                label: "Repeat",
                type: "select",
                options: options(["NONE", "WEEKLY", "FORTNIGHTLY", "MONTHLY"]),
              },
              {
                name: "occurrences",
                label: "Number of meetings",
                type: "number",
                value: 1,
                min: 1,
                max: 24,
                required: true,
                help: "Up to 24 occurrences. Dates repeat at the same UTC time; review local times across daylight saving changes.",
              },
            ]}
          />
        </Disclosure>
      ) : null}
      {!meetings.length ? (
        <EmptyState patch title="No meetings yet. Schedule time for the next conversation." />
      ) : (
        <ul className="space-y-3">
          {meetings.map((m) => (
            <EntryLink
              key={m.id}
              href={`/w/${workspaceSlug}/meetings/${m.id}`}
              title={m.title}
              meta={
                <>
                  <Chip>{m.status.toLowerCase().replaceAll("_", " ")}</Chip>
                  <span>
                    {formatDayTime(m.startsAt, actor.workspace.timezone)} ·{" "}
                    {m._count.agenda} agenda items · {m._count.decisions}{" "}
                    decisions{m.seriesId ? " · Recurring series" : ""}
                  </span>
                </>
              }
            />
          ))}
        </ul>
      )}
    </CollaborationShell>
  );
}
