"use client";

import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatTimeRange } from "@/lib/format/datetime";
import type { Busy } from "@/lib/calendar/algorithms";
import type { availabilityFor } from "@/lib/calendar/availability";
import type { CalendarData } from "./CalendarScreen";

export function MeetingAvailability({
  p,
  zone,
  pending,
  startHour,
  setStartHour,
  endHour,
  setEndHour,
  availability,
  choose,
  onCheck,
}: {
  p: { data: CalendarData };
  zone: string;
  pending: boolean;
  startHour: number;
  setStartHour: (hour: number) => void;
  endHour: number;
  setEndHour: (hour: number) => void;
  availability: Awaited<ReturnType<typeof availabilityFor>> | null;
  choose: (slot: Busy) => void;
  onCheck: () => void;
}) {
  return (
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
        onClick={onCheck}
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
  );
}
