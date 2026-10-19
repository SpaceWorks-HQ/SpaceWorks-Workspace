import { describe, expect, it } from "vitest";
import { buildCalendar, escapeText, foldLine, formatUtc, icsFilename } from "@/lib/community/ics";

const now = new Date("2026-10-19T08:00:00.000Z");

describe("ICS text helpers", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeText("Solder, snacks; tools\\parts\nline two")).toBe("Solder\\, snacks\\; tools\\\\parts\\nline two");
  });

  it("formats instants as UTC basic format", () => {
    expect(formatUtc(new Date("2026-10-14T12:30:00.000Z"))).toBe("20261014T123000Z");
  });

  it("folds long lines at 75 octets without splitting characters", () => {
    const line = `SUMMARY:${"ശ".repeat(60)}`; // Malayalam letters are 3 bytes each
    const folded = foldLine(line);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    for (const [index, part] of parts.entries()) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      if (index > 0) expect(part.startsWith(" ")).toBe(true);
    }
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join("")).toBe(line);
  });

  it("makes safe download names", () => {
    expect(icsFilename("Build night: robots & PCBs!")).toBe("build-night-robots-pcbs.ics");
    expect(icsFilename("!!!")).toBe("event.ics");
  });
});

describe("buildCalendar", () => {
  const ics = buildCalendar({
    name: "TinkerSpace Kochi",
    timeZone: "Asia/Kolkata",
    now,
    entries: [
      {
        uid: "community-event-1@spaceworks-workspace",
        summary: "Build night",
        description: "Bring a laptop, a soldering iron",
        location: "Workshop; first floor",
        url: "https://workspace.example/w/kochi/calendar/1",
        status: "CONFIRMED",
        categories: ["Build night"],
        start: new Date("2026-10-24T12:30:00.000Z"), // 6 PM IST
        end: new Date("2026-10-24T15:30:00.000Z"),
      },
      { uid: "task-due-9@spaceworks-workspace", summary: "Due: BOT-9 Sensor bar", allDay: "2026-10-25" },
    ],
  });
  const lines = ics.split("\r\n");

  it("wraps entries in a VCALENDAR with CRLF line endings", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n/);
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("X-WR-TIMEZONE:Asia/Kolkata");
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(2);
  });

  it("writes timed events as UTC instants (6 PM IST is 12:30 UTC)", () => {
    expect(lines).toContain("DTSTART:20261024T123000Z");
    expect(lines).toContain("DTEND:20261024T153000Z");
    expect(lines).toContain("DTSTAMP:20261019T080000Z");
  });

  it("writes all-day entries as dates with an exclusive end", () => {
    expect(lines).toContain("DTSTART;VALUE=DATE:20261025");
    expect(lines).toContain("DTEND;VALUE=DATE:20261026");
  });

  it("escapes text values", () => {
    expect(lines).toContain("LOCATION:Workshop\\; first floor");
    expect(lines).toContain("DESCRIPTION:Bring a laptop\\, a soldering iron");
    expect(lines).toContain("STATUS:CONFIRMED");
  });
});
