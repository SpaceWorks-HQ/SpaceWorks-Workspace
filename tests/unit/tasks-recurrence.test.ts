import { describe, expect, it } from "vitest";
import {
  describeRule,
  formatRRule,
  nextAssignees,
  nextOccurrence,
  parseAssigneeRule,
  parseRRule,
  presetRule,
  type RecurrenceRule,
} from "@/lib/tasks/recurrence";

const IST = "Asia/Kolkata";
/** 09:00 IST on a date. */
const at9 = (date: string) => new Date(`${date}T09:00:00+05:30`);

describe("parseRRule / formatRRule", () => {
  it("round-trips the supported subset", () => {
    for (const value of ["FREQ=DAILY", "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH", "FREQ=MONTHLY;BYMONTHDAY=-1", "FREQ=YEARLY;INTERVAL=3"]) {
      expect(formatRRule(parseRRule(value)!)).toBe(value);
    }
  });
  it("accepts the RRULE: prefix and normalises day order", () => {
    expect(parseRRule("RRULE:FREQ=WEEKLY;BYDAY=FR,MO")).toEqual({ freq: "WEEKLY", interval: 1, byDay: ["MO", "FR"] });
  });
  it("rejects unsupported or malformed rules", () => {
    for (const value of ["", "FREQ=HOURLY", "FREQ=DAILY;INTERVAL=0", "FREQ=DAILY;BYDAY=MO", "FREQ=WEEKLY;BYDAY=XX", "FREQ=MONTHLY;BYMONTHDAY=32", "FREQ=DAILY;COUNT=3", "nonsense"]) {
      expect(parseRRule(value)).toBeNull();
    }
  });
});

describe("describeRule", () => {
  it("reads like a person wrote it", () => {
    expect(describeRule({ freq: "DAILY", interval: 1 })).toBe("Every day");
    expect(describeRule({ freq: "WEEKLY", interval: 1, byDay: ["MO", "TU", "WE", "TH", "FR"] })).toBe("Every weekday");
    expect(describeRule({ freq: "WEEKLY", interval: 2, byDay: ["MO", "TH"] })).toBe("Every 2 weeks on Mon and Thu");
    expect(describeRule({ freq: "MONTHLY", interval: 1, byMonthDay: 1 })).toBe("Every month on the 1st");
    expect(describeRule({ freq: "MONTHLY", interval: 1, byMonthDay: -1 })).toBe("Every month on the last day");
    expect(describeRule({ freq: "YEARLY", interval: 1 })).toBe("Every year");
  });
});

describe("nextOccurrence", () => {
  it("steps daily keeping the local time", () => {
    const rule: RecurrenceRule = { freq: "DAILY", interval: 1 };
    expect(nextOccurrence(rule, at9("2026-10-19"), at9("2026-10-19"), IST)).toEqual(at9("2026-10-20"));
    expect(nextOccurrence({ freq: "DAILY", interval: 3 }, at9("2026-10-19"), at9("2026-10-20"), IST)).toEqual(at9("2026-10-22"));
  });

  it("never returns something before the anchor", () => {
    expect(nextOccurrence({ freq: "DAILY", interval: 1 }, at9("2026-10-19"), new Date("2020-01-01T00:00:00Z"), IST)).toEqual(at9("2026-10-19"));
  });

  it("handles weekly with several days and fortnightly phase", () => {
    // 2026-10-19 is a Monday.
    const rule: RecurrenceRule = { freq: "WEEKLY", interval: 1, byDay: ["MO", "TH"] };
    expect(nextOccurrence(rule, at9("2026-10-19"), at9("2026-10-19"), IST)).toEqual(at9("2026-10-22"));
    expect(nextOccurrence(rule, at9("2026-10-19"), at9("2026-10-22"), IST)).toEqual(at9("2026-10-26"));
    const fortnightly: RecurrenceRule = { freq: "WEEKLY", interval: 2, byDay: ["MO", "TH"] };
    expect(nextOccurrence(fortnightly, at9("2026-10-22"), at9("2026-10-22"), IST)).toEqual(at9("2026-11-02"));
  });

  it("handles monthly days past the end of short months and the last day", () => {
    const rule: RecurrenceRule = { freq: "MONTHLY", interval: 1, byMonthDay: 31 };
    expect(nextOccurrence(rule, at9("2026-01-31"), at9("2026-01-31"), IST)).toEqual(at9("2026-02-28"));
    expect(nextOccurrence(rule, at9("2026-01-31"), at9("2026-02-28"), IST)).toEqual(at9("2026-03-31"));
    expect(nextOccurrence({ freq: "MONTHLY", interval: 1, byMonthDay: -1 }, at9("2026-04-30"), at9("2026-04-30"), IST)).toEqual(at9("2026-05-31"));
  });

  it("handles yearly including leap days", () => {
    expect(nextOccurrence({ freq: "YEARLY", interval: 1 }, at9("2028-02-29"), at9("2028-02-29"), IST)).toEqual(at9("2029-02-28"));
  });

  it("jumps far ahead without walking every step", () => {
    const next = nextOccurrence({ freq: "DAILY", interval: 1 }, at9("2000-01-01"), at9("2026-10-19"), IST);
    expect(next).toEqual(at9("2026-10-20"));
  });

  it("keeps wall-clock time across a DST change", () => {
    const rule: RecurrenceRule = { freq: "WEEKLY", interval: 1, byDay: ["SU"] };
    const anchor = new Date("2026-03-01T09:00:00-05:00"); // New York, before DST.
    const next = nextOccurrence(rule, anchor, new Date("2026-03-07T00:00:00Z"), "America/New_York");
    expect(next?.toISOString()).toBe("2026-03-08T13:00:00.000Z"); // 09:00 EDT
  });
});

describe("presetRule", () => {
  it("uses the anchor's weekday and day of month", () => {
    expect(presetRule("weekly", at9("2026-10-22"), IST)).toEqual({ freq: "WEEKLY", interval: 1, byDay: ["TH"] });
    expect(presetRule("monthly", at9("2026-10-22"), IST)).toEqual({ freq: "MONTHLY", interval: 1, byMonthDay: 22 });
  });
});

describe("assignee rules", () => {
  it("parses defensively", () => {
    expect(parseAssigneeRule(null)).toEqual({ type: "FIXED", userIds: [] });
    expect(parseAssigneeRule({ type: "ROTATE", userIds: ["a", 3, "b"], index: -1 })).toEqual({ type: "ROTATE", userIds: ["a", "b"], index: 0 });
  });
  it("keeps fixed assignees and rotates through a list", () => {
    expect(nextAssignees({ type: "FIXED", userIds: ["a", "b"] }).userIds).toEqual(["a", "b"]);
    let rule = parseAssigneeRule({ type: "ROTATE", userIds: ["a", "b", "c"], index: 0 });
    const picks: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = nextAssignees(rule);
      picks.push(...result.userIds);
      rule = result.next;
    }
    expect(picks).toEqual(["a", "b", "c", "a"]);
  });
  it("skips people who can no longer be assigned", () => {
    expect(nextAssignees({ type: "FIXED", userIds: ["a", "b"] }, new Set(["b"])).userIds).toEqual(["b"]);
  });
});
