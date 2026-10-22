import type { Meeting, DocVisibility } from "@prisma/client";
import { meetingAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import { Disclosure, Section } from "@/components/meetings/Structure";

export function MeetingNotes({
  meeting,
  workspaceSlug,
  meetingId,
  manage,
  docs,
  doc,
  optionalChoice,
  options,
}: {
  meeting: Meeting;
  workspaceSlug: string;
  meetingId: string;
  manage: boolean;
  docs: { id: string; title: string; visibility: DocVisibility }[];
  doc: { id: string; title: string } | null | undefined;
  optionalChoice: (label?: string) => { value: string; label: string };
  options: (values: string[]) => { value: string; label: string }[];
}) {
  return (
    <>
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
                  ...docs
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
    </>
  );
}
