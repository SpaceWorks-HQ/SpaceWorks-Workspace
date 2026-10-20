"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  scheduleMeetingAction,
  calendarAvailabilityAction,
  syncCalendarGoogleAction,
} from "@/app/actions/calendar";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from "@/components/ui/dialog";
import { Field, Input, Dropdown, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import { formatTimeRange } from "@/lib/format/datetime";
import type { Busy } from "@/lib/calendar/algorithms";
import type { CalendarData } from "./CalendarScreen";
import type { availabilityFor } from "@/lib/calendar/availability";
type Props = {
  slug: string;
  zone: string;
  date: string;
  data: CalendarData;
  meeting?: CalendarData["meetings"][number];
  viewerId: string;
  googleConnected: boolean;
  onClose: () => void;
};
export function MeetingForm(p: Props) {
  const m = p.meeting,
    zone = m?.timezone ?? p.zone,
    router = useRouter();
  const [savedId, setSavedId] = useState<string | undefined>(m?.id);
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  const [when, setWhen] = useState(
      m
        ? zonedDatetimeLocalValue(new Date(m.startsAt), zone)
        : `${p.date}T10:00`,
    ),
    [duration, setDuration] = useState(
      m?.endsAt
        ? Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60000)
        : 60,
    ),
    [attendees, setAttendees] = useState<string[]>(
      m?.attendees.flatMap((a) => (a.userId ? [a.userId] : [])) ?? [p.viewerId],
    );
  const [repeat, setRepeat] = useState("NONE"),
    [team, setTeam] = useState(m?.teamId ?? ""),
    [availability, setAvailability] = useState<Awaited<
      ReturnType<typeof availabilityFor>
    > | null>(null),
    [startHour, setStartHour] = useState(9),
    [endHour, setEndHour] = useState(18);
  const choose = (slot: Busy) =>
    setWhen(zonedDatetimeLocalValue(new Date(slot.start), zone));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) p.onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader
          title={m ? "Edit meeting occurrence" : "Schedule meeting"}
          description={`Times in ${zone}. Editing changes this occurrence.`}
        />
        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setError("");
              const startsAt = zonedInputToIso(when, zone),
                until = zonedInputToIso(
                  `${form.get("until") || when.slice(0, 10)}T23:59`,
                  zone,
                );
              if (!startsAt || !until) {
                setError(
                  "Choose a valid local time. This time may be skipped by a clock change.",
                );
                return;
              }
              start(async () => {
                try {
                  const r = await scheduleMeetingAction(p.slug, {
                    id: savedId,
                    title: form.get("title"),
                    startsAt,
                    duration,
                    timezone: zone,
                    repeat,
                    until,
                    attendeeIds: attendees,
                    externalEmails: String(form.get("emails") ?? "")
                      .split(/[\s,;]+/)
                      .filter(Boolean),
                    location: form.get("location"),
                    videoUrl: form.get("videoUrl"),
                    visibility: form.get("visibility"),
                    teamId: team || null,
                    projectId: form.get("projectId") || null,
                    templateId: form.get("templateId") || null,
                    reminderMinutes: form.get("reminderMinutes"),
                  });
                  if (!r.ok) {
                    setError(r.error);
                    return;
                  }
                  setSavedId(r.data?.id);
                  if (form.get("createMeet") && r.data?.id) {
                    const sync = await syncCalendarGoogleAction(
                      p.slug,
                      r.data.id,
                    );
                    if (!sync.ok || sync.data?.failed) {
                      setError(
                        `Meeting saved. ${!sync.ok ? sync.error : "Some Google events could not sync. Try sync again."}`,
                      );
                      router.refresh();
                      return;
                    }
                  }
                  router.refresh();
                  p.onClose();
                } catch {
                  setError("Couldn't save. Try again.");
                }
              });
            }}
          >
            {error && (
              <Callout tone="danger" role="alert">
                {error}
              </Callout>
            )}
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
            <section
              className="space-y-3 rounded-lg border border-line p-3"
              aria-label="Find a time"
            >
              <h3 className="text-label">Find a time in the next two weeks</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Working day starts (hour)">
                  <Input
                    type="number"
                    min={0}
                    max={22}
                    value={startHour}
                    onChange={(e) => setStartHour(Number(e.target.value))}
                  />
                </Field>
                <Field label="Working day ends (hour)">
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={endHour}
                    onChange={(e) => setEndHour(Number(e.target.value))}
                  />
                </Field>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setError("");
                  start(async () => {
                    try {
                      const r = await calendarAvailabilityAction(p.slug, {
                        attendeeIds: attendees,
                        duration,
                        timezone: zone,
                        excludeMeetingId: m?.id,
                        startHour,
                        endHour,
                      });
                      if (r.ok) setAvailability(r.data ?? null);
                      else setError(r.error);
                    } catch {
                      setError("Couldn't check availability. Try again.");
                    }
                  });
                }}
              >
                Check attendee availability
              </Button>
              {availability && (
                <div role="status" className="space-y-2">
                  {availability.unavailable.length > 0 ? (
                    <p>
                      Google availability could not be checked for some
                      attendees. Retry before choosing a time.
                    </p>
                  ) : availability.suggestions.length ? (
                    <ul>
                      {availability.suggestions.map((slot) => (
                        <li key={slot.start}>
                          <Button
                            type="button"
                            variant="quiet"
                            onClick={() => choose(slot)}
                          >
                            {formatTimeRange(slot.start, slot.end, zone)}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>
                      No shared time found. Try a shorter meeting or adjust
                      working hours.
                    </p>
                  )}
                  <details>
                    <summary className="min-h-11 cursor-pointer text-accent-text">
                      Busy intervals ({availability.blocks.length})
                    </summary>
                    <ul className="max-h-48 overflow-y-auto">
                      {availability.blocks.map((b, i) => (
                        <li key={i} className="py-2 text-caption">
                          {p.data.people.find(
                            (person) => person.id === b.userId,
                          )?.name ?? "Member"}{" "}
                          · Busy · {formatTimeRange(b.start, b.end, zone)}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
            </section>
            <Field label="Location" optional>
              <Input
                name="location"
                defaultValue={m?.location ?? ""}
                maxLength={500}
              />
            </Field>
            <Field label="Video link" optional>
              <Input
                name="videoUrl"
                type="url"
                placeholder="https://"
                defaultValue={m?.videoUrl ?? ""}
              />
            </Field>
            {p.googleConnected && !m?.videoUrl && (
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  name="createMeet"
                />
                Create a Google Meet link on my calendar
              </label>
            )}
            {!m && (
              <Field label="Agenda template" optional>
                <Dropdown name="templateId">
                  <option value="">Blank agenda</option>
                  {p.data.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            )}
            <Field label="Remind attendees before (minutes)">
              <Input
                name="reminderMinutes"
                type="number"
                min={0}
                max={10080}
                defaultValue={m?.reminderMinutes ?? 30}
              />
            </Field>
            <p className="text-caption text-ink-muted">
              Attendees receive invitations and reminders through their
              notification preferences. Add agenda topics and notes from the
              meeting page.
            </p>
            <div className="flex flex-wrap justify-end gap-2 pb-3">
              <Button type="button" variant="secondary" onClick={p.onClose}>
                Close
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : m ? "Save meeting" : "Schedule meeting"}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
