import { describe, expect, it } from "vitest";
import { addDays, dueLabel, isDay, parseQuickTodo, positionBetween, todayIn, todoBucket } from "@/lib/notepad/dates";

// 2026-10-20 is a Tuesday.
const TODAY = "2026-10-20";

describe("todayIn", () => {
  it("uses the workspace time zone, not the server clock", () => {
    const lateUtc = new Date("2026-10-20T20:00:00Z");
    expect(todayIn("UTC", lateUtc)).toBe("2026-10-20");
    expect(todayIn("Asia/Kolkata", lateUtc)).toBe("2026-10-21");
    expect(todayIn("America/Los_Angeles", new Date("2026-10-20T05:00:00Z"))).toBe("2026-10-19");
  });
});

describe("parseQuickTodo", () => {
  it("reads a trailing date word and removes it", () => {
    expect(parseQuickTodo("Order solder tomorrow", TODAY)).toEqual({ text: "Order solder", dueOn: "2026-10-21", starred: false });
    expect(parseQuickTodo("Sweep the bench today", TODAY)).toEqual({ text: "Sweep the bench", dueOn: TODAY, starred: false });
    expect(parseQuickTodo("Renew domain 2026-11-02", TODAY).dueOn).toBe("2026-11-02");
  });

  it("finds the next weekday, a week out when it is today", () => {
    expect(parseQuickTodo("Call venue fri", TODAY).dueOn).toBe("2026-10-23");
    expect(parseQuickTodo("Standup notes tuesday", TODAY).dueOn).toBe("2026-10-27");
    expect(parseQuickTodo("Plan build night next week", TODAY)).toEqual({ text: "Plan build night", dueOn: "2026-10-26", starred: false });
  });

  it("stars with a leading or trailing !", () => {
    expect(parseQuickTodo("!Pay the electricity bill", TODAY)).toMatchObject({ text: "Pay the electricity bill", starred: true });
    expect(parseQuickTodo("Pay rent tomorrow!", TODAY)).toMatchObject({ text: "Pay rent", dueOn: "2026-10-21", starred: true });
  });

  it("leaves ordinary words and single words alone", () => {
    expect(parseQuickTodo("Fix the friday sign", TODAY)).toEqual({ text: "Fix the friday sign", dueOn: null, starred: false });
    expect(parseQuickTodo("tomorrow", TODAY)).toEqual({ text: "tomorrow", dueOn: null, starred: false });
    expect(parseQuickTodo("Ship 2026-02-30", TODAY).dueOn).toBeNull();
  });
});

describe("todoBucket", () => {
  it("groups by due day", () => {
    expect(todoBucket({ done: false, dueOn: "2026-10-19" }, TODAY)).toBe("overdue");
    expect(todoBucket({ done: false, dueOn: TODAY }, TODAY)).toBe("today");
    expect(todoBucket({ done: false, dueOn: "2026-10-25" }, TODAY)).toBe("upcoming");
    expect(todoBucket({ done: false, dueOn: null }, TODAY)).toBe("someday");
    expect(todoBucket({ done: true, dueOn: "2026-10-19" }, TODAY)).toBe("done");
  });
});

describe("helpers", () => {
  it("validates calendar days", () => {
    expect(isDay("2026-10-20")).toBe(true);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("20-10-2026")).toBe(false);
  });

  it("labels due days relative to today", () => {
    expect(dueLabel(TODAY, TODAY)).toBe("Today");
    expect(dueLabel(addDays(TODAY, 1), TODAY)).toBe("Tomorrow");
    expect(dueLabel(addDays(TODAY, -1), TODAY)).toBe("Yesterday");
    expect(dueLabel("2026-10-23", TODAY)).toBe("Fri");
    expect(dueLabel("2027-01-05", TODAY)).toBe("5 Jan 2027");
  });

  it("places items between neighbours", () => {
    expect(positionBetween(null, null)).toBe(1024);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(1024, null)).toBe(2048);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });
});
