import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  announcementDedupeKey,
  announcementStatus,
  dayKey,
  dueReminders,
  effectiveEnd,
  eventDayKeys,
  monthGrid,
  parseDayKey,
  reminderDedupeKey,
  startOfDay,
  viewRange,
  weekDays,
  weekdayIndex,
} from "@/lib/community/schedule";
import { zonedInputToIso } from "@/lib/timeZone";

const HOUR = 60 * 60 * 1000;

describe("announcement status", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  it("is a draft without a publish time, scheduled before it, published after", () => {
    expect(announcementStatus(null, now)).toBe("draft");
    expect(announcementStatus(new Date("2026-10-19T10:01:00Z"), now)).toBe("scheduled");
    expect(announcementStatus(new Date("2026-10-19T10:00:00Z"), now)).toBe("published");
  });

  it("keys a publish by announcement and time, so a reschedule sends again once", () => {
    const first = announcementDedupeKey("a1", new Date("2026-10-20T04:30:00Z"));
    expect(first).toBe("announcement.published:a1:2026-10-20T04:30:00.000Z");
    expect(announcementDedupeKey("a1", new Date("2026-10-21T04:30:00Z"))).not.toBe(first);
  });
});

describe("event reminders", () => {
  const startsAt = new Date("2026-10-24T12:30:00Z");
  const created = new Date("2026-10-01T00:00:00Z");
  const event = { startsAt, createdAt: created, cancelledAt: null };

  it("sends nothing more than a day ahead", () => {
    expect(dueReminders(event, new Date(startsAt.getTime() - 25 * HOUR))).toEqual([]);
  });

  it("sends the day-before reminder from 24 h until 1 h before", () => {
    expect(dueReminders(event, new Date(startsAt.getTime() - 24 * HOUR))).toEqual(["24h"]);
    expect(dueReminders(event, new Date(startsAt.getTime() - 3 * HOUR))).toEqual(["24h"]);
  });

  it("switches to the hour-before reminder in the last hour", () => {
    expect(dueReminders(event, new Date(startsAt.getTime() - 59 * 60 * 1000))).toEqual(["1h"]);
    expect(dueReminders(event, startsAt)).toEqual([]);
  });

  it("skips reminders that were due before the event existed", () => {
    const late = { startsAt, createdAt: new Date(startsAt.getTime() - 5 * HOUR), cancelledAt: null };
    expect(dueReminders(late, new Date(startsAt.getTime() - 4 * HOUR))).toEqual([]);
    expect(dueReminders(late, new Date(startsAt.getTime() - 30 * 60 * 1000))).toEqual(["1h"]);
  });

  it("never reminds about cancelled events", () => {
    expect(dueReminders({ ...event, cancelledAt: created }, new Date(startsAt.getTime() - 2 * HOUR))).toEqual([]);
  });

  it("keys reminders by event, kind and start time", () => {
    expect(reminderDedupeKey("e1", "1h", startsAt)).toBe("event.reminder:e1:1h:2026-10-24T12:30:00.000Z");
  });
});

describe("workspace time zone days", () => {
  it("puts a late-evening IST event on the IST day, not the UTC one", () => {
    const instant = new Date(zonedInputToIso("2026-10-24T23:30", "Asia/Kolkata")!);
    expect(instant.toISOString()).toBe("2026-10-24T18:00:00.000Z");
    expect(dayKey(instant, "Asia/Kolkata")).toBe("2026-10-24");
    expect(dayKey(new Date("2026-10-24T19:00:00Z"), "Asia/Kolkata")).toBe("2026-10-25");
    expect(dayKey(new Date("2026-10-24T19:00:00Z"), "UTC")).toBe("2026-10-24");
  });

  it("finds the start of a day in the zone", () => {
    expect(startOfDay("2026-10-24", "Asia/Kolkata").toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(startOfDay("2026-10-24", "UTC").toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });

  it("handles daylight saving changes", () => {
    // New York springs forward on 8 Mar 2026 (EST −5 → EDT −4).
    expect(startOfDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfDay("2026-03-09", "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    // London falls back on 25 Oct 2026.
    expect(startOfDay("2026-10-25", "Europe/London").toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(startOfDay("2026-10-26", "Europe/London").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(dayKey(new Date("2026-10-24T23:00:00Z"), "Not/AZone")).toBe("2026-10-24");
  });
});

describe("calendar grid", () => {
  it("validates day keys", () => {
    expect(parseDayKey("2026-02-28")).toBe("2026-02-28");
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-2-3")).toBeNull();
    expect(parseDayKey(undefined)).toBeNull();
  });

  it("does key arithmetic across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
  });

  it("starts weeks on Monday", () => {
    expect(weekdayIndex("2026-10-19")).toBe(0); // Monday
    expect(weekdayIndex("2026-10-25")).toBe(6); // Sunday
    expect(weekDays("2026-10-22")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  });

  it("builds a month grid of whole weeks", () => {
    const weeks = monthGrid("2026-10-19");
    expect(weeks[0]![0]).toBe("2026-09-28");
    expect(weeks.at(-1)![6]).toBe("2026-11-01");
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat()).toContain("2026-10-31");
  });

  it("queries the visible month range in the workspace zone", () => {
    const range = viewRange("month", "2026-10-19", "Asia/Kolkata", new Date("2026-10-19T00:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-09-27T18:30:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-01T18:30:00.000Z");
  });

  it("spreads multi-day events across their days and keeps midnight ends on one day", () => {
    const start = new Date(zonedInputToIso("2026-10-24T18:00", "Asia/Kolkata")!);
    const twoDays = new Date(zonedInputToIso("2026-10-25T20:00", "Asia/Kolkata")!);
    expect(eventDayKeys(start, twoDays, "Asia/Kolkata")).toEqual(["2026-10-24", "2026-10-25"]);
    const midnight = new Date(zonedInputToIso("2026-10-25T00:00", "Asia/Kolkata")!);
    expect(eventDayKeys(start, midnight, "Asia/Kolkata")).toEqual(["2026-10-24"]);
  });

  it("gives open-ended events two hours", () => {
    const start = new Date("2026-10-24T12:30:00Z");
    expect(effectiveEnd(start, null).toISOString()).toBe("2026-10-24T14:30:00.000Z");
    expect(effectiveEnd(start, new Date("2026-10-24T12:00:00Z")).toISOString()).toBe("2026-10-24T14:30:00.000Z");
  });
});
