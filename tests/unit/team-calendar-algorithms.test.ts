import { describe, it, expect } from "vitest";
import {
  expandRecurrence,
  mergeBusy,
  findTimes,
  layerAllowed,
  csvCell,
} from "@/lib/calendar/algorithms";
import { meetingInvitation } from "@/lib/calendar/ics";
import { canScheduleMeetings, canManageCalendarDeadlines } from "@/lib/roles";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
describe("team calendar recurrence", () => {
  it("preserves local wall time through spring DST", () => {
    const starts = expandRecurrence(
      new Date("2026-03-01T14:00Z"),
      "WEEKLY",
      new Date("2026-03-23T00:00Z"),
      "America/New_York",
    );
    expect(starts.map((d) => d.toISOString())).toEqual([
      "2026-03-01T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-15T13:00:00.000Z",
      "2026-03-22T13:00:00.000Z",
    ]);
  });
  it("preserves local wall time through autumn DST", () => {
    const starts = expandRecurrence(
      new Date("2026-10-25T13:00Z"),
      "WEEKLY",
      new Date("2026-11-10T00:00Z"),
      "America/New_York",
    );
    expect(
      starts.map((d) =>
        zonedDatetimeLocalValue(d, "America/New_York").slice(11),
      ),
    ).toEqual(["09:00", "09:00", "09:00"]);
  });
  it("skips month ends without overflowing into the next month", () => {
    expect(
      expandRecurrence(
        new Date("2026-01-31T04:30Z"),
        "MONTHLY",
        new Date("2026-06-01T00:00Z"),
        "Asia/Kolkata",
      ).map((d) => d.toISOString().slice(0, 10)),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });
  it("skips nonexistent local times on a DST transition", () => {
    const starts = expandRecurrence(
      new Date("2026-03-07T07:30Z"),
      "DAILY",
      new Date("2026-03-10T00:00Z"),
      "America/New_York",
    );
    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2026-03-07",
      "2026-03-09",
    ]);
  });
  it("includes the end boundary and supports biweekly and nonrecurring dates", () => {
    const start = new Date("2026-10-01T09:00Z"),
      end = new Date("2026-10-29T09:00Z");
    expect(expandRecurrence(start, "BIWEEKLY", end, "UTC")).toHaveLength(3);
    expect(expandRecurrence(start, "NONE", end, "UTC")).toEqual([start]);
  });
});
describe("availability", () => {
  it("merges overlapping and touching busy blocks without mutating input", () => {
    const input = [
      { start: "2026-10-20T10:00Z", end: "2026-10-20T11:00Z" },
      { start: "2026-10-20T09:00Z", end: "2026-10-20T10:30Z" },
      { start: "2026-10-20T11:00Z", end: "2026-10-20T12:00Z" },
    ];
    expect(mergeBusy(input)).toEqual([
      { start: "2026-10-20T09:00Z", end: "2026-10-20T12:00:00.000Z" },
    ]);
    expect(input[0].end).toBe("2026-10-20T11:00Z");
  });
  it("finds weekday slots within working hours and allows touching boundaries", () => {
    const slots = findTimes(
      [{ start: "2026-10-19T09:00Z", end: "2026-10-19T10:00Z" }],
      new Date("2026-10-17T09:00Z"),
      60,
      "UTC",
      9,
      12,
    );
    expect(slots[0]).toEqual({
      start: "2026-10-19T10:00:00.000Z",
      end: "2026-10-19T11:00:00.000Z",
    });
    expect(
      slots.every(
        (s) =>
          new Date(s.start).getUTCDay() !== 0 &&
          new Date(s.start).getUTCDay() !== 6,
      ),
    ).toBe(true);
  });
  it("returns no slots for a blocked fortnight", () => {
    expect(
      findTimes(
        [{ start: "2026-10-01T00:00Z", end: "2026-11-01T00:00Z" }],
        new Date("2026-10-01T00:00Z"),
        60,
        "UTC",
      ),
    ).toEqual([]);
  });
});
describe("calendar invitations and permissions", () => {
  const input = {
    id: "a",
    title: "Planning, notes; decisions\nNext",
    startsAt: new Date("2026-10-20T09:00Z"),
    endsAt: new Date("2026-10-20T10:00Z"),
    sequence: 2,
    cancelled: false,
    organizer: "owner@example.test",
    attendee: "guest@example.test",
  };
  it("uses stable UID, sequence and escaped RFC text", () => {
    const text = meetingInvitation(input);
    expect(text).toContain("METHOD:REQUEST\r\n");
    expect(text).toContain("UID:meeting-a@spaceworks-workspace\r\nSEQUENCE:2");
    expect(text).toContain("SUMMARY:Planning\\, notes\\; decisions\\nNext");
    expect(text).toContain("ATTENDEE;RSVP=TRUE:mailto:guest@example.test");
  });
  it("cancels the same UID with an increased revision", () => {
    const text = meetingInvitation({ ...input, cancelled: true, sequence: 3 });
    expect(text).toContain("METHOD:CANCEL");
    expect(text).toContain("STATUS:CANCELLED");
    expect(text).toContain("UID:meeting-a@spaceworks-workspace");
    expect(text).toContain("SEQUENCE:3");
  });
  it("does not allow header injection through email values", () => {
    expect(
      meetingInvitation({
        ...input,
        attendee: "a@example.test\r\nBEGIN:VEVENT",
      }),
    ).not.toContain("\r\nBEGIN:VEVENT\r\nEND:VEVENT");
  });
  it("keeps guests limited to records they participate in", () => {
    expect(layerAllowed("meeting", true, false)).toBe(false);
    expect(layerAllowed("meeting", true, true)).toBe(true);
    expect(layerAllowed("renewal", true, true)).toBe(false);
    expect(layerAllowed("deadline", false, false)).toBe(true);
  });
  it("allows member scheduling and admin statutory deadlines", () => {
    expect(canScheduleMeetings({ role: "GUEST" })).toBe(false);
    expect(canScheduleMeetings({ role: "MEMBER" })).toBe(true);
    expect(canManageCalendarDeadlines({ role: "MEMBER" })).toBe(false);
    expect(canManageCalendarDeadlines({ role: "ADMIN" })).toBe(true);
  });
  it("escapes CSV formulas, quotes and commas", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});
