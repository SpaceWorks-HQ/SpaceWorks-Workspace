import { describe, expect, it } from "vitest";
import { allocatedMinutes,leaveDays,csvCell,csvText,addDays, canTransitionTicket, day, durationLabel, localDay, nextChecklistDay, ticketDueAt, workedMinutes } from "@/lib/opsGaps/rules";
import { canUseInternalOperations, canManageInternalOperations } from "@/lib/roles";

describe("internal operations roles", () => {
  it.each(["OWNER", "ADMIN", "MEMBER", "GUEST"] as const)("applies capabilities for %s", role => {
    expect(canUseInternalOperations({ role })).toBe(role !== "GUEST");
    expect(canManageInternalOperations({ role })).toBe(["OWNER", "ADMIN"].includes(role));
  });
});
describe("help desk targets and workflow", () => {
  it.each([["URGENT",4],["HIGH",24],["NORMAL",72],["LOW",168]] as const)("uses elapsed hours for %s", (priority,hours) => {
    const now = new Date("2026-03-28T23:30:00Z");
    expect(ticketDueAt(priority,now).getTime()-now.getTime()).toBe(hours*3600000);
  });
  it("requires reopening before triaging a closed request", () => {
    expect(canTransitionTicket("CLOSED","OPEN")).toBe(true);
    expect(canTransitionTicket("CLOSED","IN_PROGRESS")).toBe(false);
    expect(canTransitionTicket("RESOLVED","WAITING")).toBe(false);
    expect(canTransitionTicket("OPEN","RESOLVED")).toBe(true);
  });
});
describe("operational checklist dates", () => {
  it("preserves cadence after downtime", () => {
    expect(nextChecklistDay("2026-10-01",7,"2026-10-20")).toBe("2026-10-22");
    expect(nextChecklistDay("2026-10-01",7,"2026-10-22")).toBe("2026-10-29");
    expect(nextChecklistDay("2026-10-20",1,"2026-10-20")).toBe("2026-10-21");
  });
  it("uses workspace calendar days across time zones and daylight saving", () => {
    expect(localDay(new Date("2026-10-20T20:00:00Z"),"Asia/Kolkata")).toBe("2026-10-21");
    expect(addDays("2026-03-29",1)).toBe("2026-03-30");
  });
  it.each(["2026-02-30","2026-13-01","2026-2-03",""])("rejects invalid calendar day %s", value => expect(day.safeParse(value).success).toBe(false));
});
describe("volunteer durations", () => {
  const start = new Date("2026-10-20T08:00:00Z");
  it("deducts breaks with exact integer minutes", () => {
    expect(workedMinutes(start,new Date("2026-10-20T10:00:00Z"),15)).toBe(105);
    expect(durationLabel(105)).toBe("1 h 45 min");
  });
  it.each([[0,0],[30,30],[30,-1],[30,0.5],[961,0],[-60,0],[0.5,0]])("rejects duration %s with break %s", (elapsed,pause) => expect(workedMinutes(start,new Date(start.getTime()+elapsed*60000),pause)).toBeNull());
});

describe("leave arithmetic and safe CSV",()=>{
 it("counts calendar days across leap dates and year boundaries",()=>{expect(leaveDays("2028-02-28","2028-03-01")).toBe(3);expect(leaveDays("2026-12-31","2027-01-01")).toBe(2);});
 it.each(["=SUM(A1)"," +2","@HYPERLINK","\t-1"])("neutralises formula cell %s",v=>expect(csvCell(v).startsWith('"\'')).toBe(true));
 it("quotes embedded commas, quotes and newlines",()=>expect(csvText([["name",'a,"b"\nc']])).toBe('"name","a,""b""\nc"'));
});

it("preserves an odd minute across a month boundary",()=>{
 const start=new Date("2026-01-31T23:00Z"),end=new Date("2026-02-01T01:00Z"),boundary=new Date("2026-02-01T00:00Z");
 expect(allocatedMinutes(105,start,end,start,boundary)+allocatedMinutes(105,start,end,boundary,end)).toBe(105);
});
