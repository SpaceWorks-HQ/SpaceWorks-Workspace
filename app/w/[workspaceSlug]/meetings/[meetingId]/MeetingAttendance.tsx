import type { Prisma } from "@prisma/client";
import { formatDayTime } from "@/lib/format/datetime";
import { meetingAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import { Disclosure, Section } from "@/components/meetings/Structure";

type MeetingWithAttendees = Prisma.MeetingGetPayload<{
  include: {
    attendees: {
      include: { user: { select: { id: true; name: true } } };
    };
  };
}>;

export function MeetingAttendance({
  meeting,
  workspaceSlug,
  meetingId,
  members,
  manage,
  viewerId,
  timezone,
  destinations,
}: {
  meeting: MeetingWithAttendees;
  workspaceSlug: string;
  meetingId: string;
  members: { value: string; label: string }[];
  manage: boolean;
  viewerId: string;
  timezone: string;
  destinations: { id: string; name: string }[];
}) {
  return (
    <>
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
        {meeting.attendees.some((a) => a.userId === viewerId) ? (
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
                  options: members,
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
                  timezone,
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
    </>
  );
}
