import { describe, expect, it } from "vitest";
import { csvCell, milestoneSchema, milestoneStatus, nextUpdateDue, projectDate, projectProgress, taskPlanSchema, timelinePosition, timelineRange } from "@/lib/projects/plusLogic";
import { resourcePaths } from "@/lib/frontend/resources";
import { canEditTaskPlan, canManageProjectPlan } from "@/lib/roles";

describe("manual project planning", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "1899-12-31", "invalid"])("rejects invalid date %s", value => expect(projectDate.safeParse(value).success).toBe(false));
  it("allows the report CSV through the private frontend gateway", () => {
    expect(resourcePaths.some(pattern => pattern.test("/w/kochi/projects/OFC/report/export"))).toBe(true);
  });
  it("accepts leap days and deduplicates linked tasks", () => {
    expect(projectDate.safeParse("2028-02-29").success).toBe(true);
    expect(milestoneSchema.parse({ projectId: "p", name: "Ready", targetOn: "2028-02-29", status: "PENDING", taskIds: ["a", "a"] }).taskIds).toEqual(["a"]);
  });
  it("needs a follow-up owner for a manual blocker", () => expect(taskPlanSchema.safeParse({ taskId: "t", startsOn: null, blockerReason: "Awaiting approval", blockerOwnerId: null }).success).toBe(false));
  it("derives completion without treating an empty milestone as done", () => {
    expect(milestoneStatus("PENDING", [])).toBe("PENDING");
    expect(milestoneStatus("IN_PROGRESS", [{ completedAt: new Date() }])).toBe("DONE");
    expect(milestoneStatus("IN_PROGRESS", [{ completedAt: null }])).toBe("IN_PROGRESS");
    expect(milestoneStatus("DONE", [{ completedAt: null }])).toBe("DONE");
  });
  it("counts top-level tasks once", () => {
    expect(projectProgress([{ parentId: null, completedAt: new Date() }, { parentId: "p", completedAt: null }, { parentId: null, completedAt: null }])).toEqual({ total: 2, done: 1, percent: 50 });
    expect(projectProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
  });
  it("reminds at 09:00 local seven calendar days later, including DST", () => {
    expect(nextUpdateDue(new Date("2026-10-21T20:00:00Z"), "Asia/Kolkata").toISOString()).toBe("2026-10-29T03:30:00.000Z");
    expect(nextUpdateDue(new Date("2026-10-28T16:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-04T14:00:00.000Z");
  });
  it("lays out inclusive spans and single endpoints", () => {
    expect(timelineRange([{ start: null, end: null }])).toBeNull();
    const range = timelineRange([{ start: "2026-10-01", end: "2026-10-10" }])!;
    expect(range.days).toBe(10);
    expect(timelinePosition("2026-10-02", "2026-10-03", range)).toEqual({ left: "10%", width: "20%" });
    expect(timelinePosition(null, "2026-10-10", range)).toEqual({ left: "90%", width: "10%" });
  });
  it.each(["=SUM(A1)", "+1", "-2", "@x", "  =1", "\ttext", "\rtext"])("neutralises CSV formula %j", value => expect(csvCell(value)).toBe(`"'${value}"`));
  it("escapes CSV quotes, commas and newlines", () => expect(csvCell('A,"B"\nC')).toBe('"A,""B""\nC"'));
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)("enforces %s planning capability", role => {
    expect(canEditTaskPlan({ role })).toBe(role !== "GUEST");
    expect(canManageProjectPlan({ role }, "me", "me")).toBe(role !== "GUEST");
    expect(canManageProjectPlan({ role }, "me", "other")).toBe(role === "OWNER" || role === "ADMIN");
  });
});
