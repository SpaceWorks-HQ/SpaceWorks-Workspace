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
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";
import type { Busy } from "@/lib/calendar/algorithms";
import type { CalendarData } from "./CalendarScreen";
import type { availabilityFor } from "@/lib/calendar/availability";
import { MeetingFields } from "./MeetingFields";
import { MeetingAvailability } from "./MeetingAvailability";

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
            <MeetingFields
              p={p}
              m={m}
              when={when}
              setWhen={setWhen}
              duration={duration}
              setDuration={setDuration}
              repeat={repeat}
              setRepeat={setRepeat}
              team={team}
              setTeam={setTeam}
              attendees={attendees}
              setAttendees={setAttendees}
              setAvailability={setAvailability}
            />
            <MeetingAvailability
              p={p}
              zone={zone}
              pending={pending}
              startHour={startHour}
              setStartHour={setStartHour}
              endHour={endHour}
              setEndHour={setEndHour}
              availability={availability}
              choose={choose}
              onCheck={() => {
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
            />
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
                {pending ? "Saving" : m ? "Save meeting" : "Schedule meeting"}
              </Button>
            </div>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
