"use client";

import { Field, Input, Dropdown, Textarea } from "@/components/ui/field";
import type { CalendarData } from "./CalendarScreen";

export function MeetingFields({
  p,
  m,
  when,
  setWhen,
  duration,
  setDuration,
  repeat,
  setRepeat,
  team,
  setTeam,
  attendees,
  setAttendees,
  setAvailability,
}: {
  p: { data: CalendarData; viewerId: string };
  m?: CalendarData["meetings"][number];
  when: string;
  setWhen: (when: string) => void;
  duration: number;
  setDuration: (duration: number) => void;
  repeat: string;
  setRepeat: (repeat: string) => void;
  team: string;
  setTeam: (team: string) => void;
  attendees: string[];
  setAttendees: (attendees: string[]) => void;
  setAvailability: (availability: null) => void;
}) {
  return (
    <>
      <Field label="Title" required>
        <Input name="title" defaultValue={m?.title} maxLength={200} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Start" required>
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field label="Duration (minutes)" required>
          <Input
            type="number"
            min={5}
            max={1440}
            value={duration}
            onChange={(e) => {
              setDuration(Number(e.target.value));
              setAvailability(null);
            }}
          />
        </Field>
      </div>
      {!m && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Repeat">
            <Dropdown
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
            >
              <option value="NONE">Does not repeat</option>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="BIWEEKLY">Every two weeks</option>
              <option value="MONTHLY">Monthly</option>
            </Dropdown>
          </Field>
          {repeat !== "NONE" && (
            <Field
              label="Repeat through"
              helperText="Up to 100 meetings within one year. Invalid month dates are skipped."
              required
            >
              <Input
                name="until"
                type="date"
                min={when.slice(0, 10)}
                defaultValue={when.slice(0, 10)}
              />
            </Field>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Audience">
          <Dropdown
            name="visibility"
            defaultValue={m?.visibility ?? "WORKSPACE"}
            disabled={!!m}
          >
            <option value="WORKSPACE">Workspace</option>
            <option value="TEAM">Team</option>
            <option value="PRIVATE">Private (only you)</option>
          </Dropdown>
        </Field>
        <Field label="Team" optional>
          <Dropdown
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            disabled={!!m}
          >
            <option value="">No team</option>
            {p.data.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Dropdown>
        </Field>
      </div>
      {m && (
        <input type="hidden" name="visibility" value={m.visibility} />
      )}
      <Field label="Project" optional>
        <Dropdown name="projectId" defaultValue={m?.projectId ?? ""}>
          <option value="">No project</option>
          {p.data.projects
            .filter((t) => !team || t.teamId === team)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </Dropdown>
      </Field>
      <fieldset>
        <legend className="text-label">Attendees</legend>
        <div className="max-h-44 overflow-y-auto rounded-md border border-line p-2">
          {p.data.people.map((person) => (
            <label
              key={person.id}
              className="flex min-h-11 items-center gap-2"
            >
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={attendees.includes(person.id)}
                disabled={person.id === p.viewerId}
                onChange={(e) => {
                  setAttendees(
                    e.target.checked
                      ? [...attendees, person.id]
                      : attendees.filter((id) => id !== person.id),
                  );
                  setAvailability(null);
                }}
              />
              {person.name ?? "Member"}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="External guests' emails"
        optional
        helperText="Separate emails with commas. Each guest receives an email invitation."
      >
        <Textarea
          name="emails"
          defaultValue={m?.externalEmails.join(", ")}
          rows={2}
        />
      </Field>
    </>
  );
}
