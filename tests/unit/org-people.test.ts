import { describe, expect, it } from "vitest";
import { canViewOrgPeople, canManageOrgPeople, canRecordAttendance } from "@/lib/roles";
import { monthDays, wouldCycle, indentedTree, responsibilitySchema, responsibilityRoles, csvCell, attendanceSchema } from "@/lib/orgPeople/rules";
describe("organisation capability rules", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)("gates %s", role => {
    expect(canViewOrgPeople({ role })).toBe(role !== "GUEST"); expect(canManageOrgPeople({ role })).toBe(["OWNER", "ADMIN"].includes(role));
    expect(canRecordAttendance({ role }, true, false, role)).toBe(role !== "GUEST");
  });
  it("limits managers to members and preserves admin hierarchy", () => {
    expect(canRecordAttendance({ role: "MEMBER" }, false, true, "MEMBER")).toBe(true);
    expect(canRecordAttendance({ role: "MEMBER" }, false, false, "MEMBER")).toBe(false);
    for (const role of ["OWNER", "ADMIN", "GUEST"] as const) expect(canRecordAttendance({ role: "MEMBER" }, false, true, role)).toBe(false);
    expect(canRecordAttendance({ role: "ADMIN" }, false, false, "OWNER")).toBe(false);
    expect(canRecordAttendance({ role: "ADMIN" }, false, false, "ADMIN")).toBe(false);
    expect(canRecordAttendance({ role: "OWNER" }, false, false, "ADMIN")).toBe(true);
  });
});
describe("organisation register rules", () => {
  it("handles leap months and rejects invalid or unbounded months", () => { expect(monthDays("2024-02")).toHaveLength(29); expect(monthDays("2100-02")).toHaveLength(28); for (const v of ["2024-13", "2024-2", "1800-01", "bad"]) expect(monthDays(v)).toEqual([]); });
  it("rejects direct, descendant and already-corrupt cycles", () => { const edges = [{ id: "a", parentId: null }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }]; expect(wouldCycle(edges, "a", "c")).toBe(true); expect(wouldCycle(edges, "a", "a")).toBe(true); expect(wouldCycle(edges, "c", "a")).toBe(false); expect(wouldCycle([{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }], "c", "a")).toBe(true); });
  it("renders orphaned and cyclic legacy nodes once", () => { const rows = [{ id: "child", parentId: "root" }, { id: "root", parentId: null }, { id: "orphan", parentId: "gone" }, { id: "cycle", parentId: "cycle" }]; const tree = indentedTree(rows); expect(tree.map(v => v.row.id)).toEqual(["root", "child", "orphan", "cycle"]); expect(tree[1].depth).toBe(1); });
  it("requires a responsible person and validates calendar dates", () => { const input = { title: "Safety", accountableId: "one", responsibleIds: ["one", "one"], reviewOn: "2026-10-21" }; expect(responsibilitySchema.parse(input).responsibleIds).toEqual(["one"]); expect(responsibilitySchema.safeParse({ ...input, responsibleIds: [] }).success).toBe(false); expect(responsibilitySchema.safeParse({ ...input, reviewOn: "2026-02-30" }).success).toBe(false); expect(attendanceSchema.safeParse({ userId: "one", dateOn: "2026-10-21", status: "UNKNOWN" }).success).toBe(false); });
  it("shows all roles including backup on profiles", () => { expect(responsibilityRoles({ responsibleIds: ["one"], accountableId: "one", consultedIds: [], informedIds: ["one"], backupId: "one" }, "one")).toEqual(["Responsible", "Accountable", "Informed", "Backup"]); });
  it("escapes CSV and neutralises spreadsheet formula prefixes", () => { expect(csvCell('A, "B"')).toBe('"A, ""B"""'); for (const v of ["=SUM(A1)", " +cmd", "@x", "-1"]) expect(csvCell(v)).toBe(`"'${v}"`); });
});
