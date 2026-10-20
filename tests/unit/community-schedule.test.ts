import { describe, expect, it } from "vitest";
import { announcementDedupeKey, announcementStatus, dayKey, startOfDay, parseDayKey, addDays } from "@/lib/community/schedule";
import { zonedInputToIso } from "@/lib/timeZone";


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

describe("workspace time zone days", () => {
  it("puts a late-evening IST shift on the IST day, not the UTC one", () => {
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

describe("internal date inputs", () => {
  it("rejects impossible dates and shifts day keys across months", () => {
    expect(parseDayKey("2026-02-28")).toBe("2026-02-28");
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-2-3")).toBeNull();
    expect(parseDayKey(undefined)).toBeNull();
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});
