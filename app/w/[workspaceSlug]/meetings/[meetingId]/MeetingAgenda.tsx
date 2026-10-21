import type { AgendaItem } from "@prisma/client";
import { meetingAction } from "@/app/actions/meetings";
import { ActionForm } from "@/components/meetings/ActionForm";
import { Disclosure, Section, TextBody } from "@/components/meetings/Structure";

export function MeetingAgenda({
  agenda,
  agendaIds,
  workspaceSlug,
  meetingId,
  members,
  manage,
  contribute,
  optionalChoice,
  options,
}: {
  agenda: AgendaItem[];
  agendaIds: string[];
  workspaceSlug: string;
  meetingId: string;
  members: { value: string; label: string }[];
  manage: boolean;
  contribute: boolean;
  optionalChoice: (label?: string) => { value: string; label: string };
  options: (values: string[]) => { value: string; label: string }[];
}) {
  const name = (id: string | null) =>
    members.find((m) => m.value === id)?.label ?? "Unassigned";
  return (
    <>
      <Section
        title={`Agenda · ${agenda.reduce((n, a) => n + (a.durationMin ?? 0), 0)} minutes`}
      >
        {!agenda.length ? (
          <p className="text-ink-muted">
            No agenda items yet. Add the first topic below.
          </p>
        ) : (
          <ol className="space-y-5">
            {agenda.map((item, index) => (
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
                            options: [optionalChoice(), ...members],
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
      {contribute ? (
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
                options: [optionalChoice(), ...members],
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
    </>
  );
}
