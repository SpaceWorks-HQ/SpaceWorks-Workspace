/**
 * iCalendar (RFC 5545) writer for event downloads and subscription feeds
 * (pure). Timed events are written as UTC instants (`...Z`), which every
 * calendar converts to the viewer's zone correctly; all-day entries (task
 * due dates) use the date in the workspace time zone. The workspace zone is
 * also advertised with X-WR-TIMEZONE for clients that display it.
 */

export type IcsStatus = "CONFIRMED" | "TENTATIVE" | "CANCELLED";

export type IcsEntry = {
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  /** Absolute URL back into the workspace. */
  url?: string | null;
  status?: IcsStatus;
  lastModified?: Date | null;
  categories?: string[];
} & ({ start: Date; end: Date; allDay?: undefined } | { allDay: string; start?: undefined; end?: undefined });

export type IcsCalendar = {
  name: string;
  timeZone: string;
  description?: string;
  entries: IcsEntry[];
  /** DTSTAMP for every entry (when the file was generated). */
  now: Date;
};

const CRLF = "\r\n";

/** Escape a TEXT value (RFC 5545 §3.3.11). */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line at 75 octets without splitting UTF-8 characters (§3.1). */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join(`${CRLF} `);
}

/** 20261014T130000Z */
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** "2026-10-14" → 20261014 */
function formatDateValue(key: string): string {
  return key.replace(/-/g, "");
}

function nextDayKey(key: string): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
}

function entryLines(entry: IcsEntry, now: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${escapeText(entry.uid)}`, `DTSTAMP:${formatUtc(now)}`];
  if (entry.allDay !== undefined) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateValue(entry.allDay)}`, `DTEND;VALUE=DATE:${formatDateValue(nextDayKey(entry.allDay))}`, "TRANSP:TRANSPARENT");
  } else {
    lines.push(`DTSTART:${formatUtc(entry.start)}`, `DTEND:${formatUtc(entry.end)}`);
  }
  lines.push(`SUMMARY:${escapeText(entry.summary)}`);
  if (entry.description) lines.push(`DESCRIPTION:${escapeText(entry.description)}`);
  if (entry.location) lines.push(`LOCATION:${escapeText(entry.location)}`);
  if (entry.url) lines.push(`URL:${entry.url.replace(/[\r\n]/g, "")}`);
  if (entry.categories?.length) lines.push(`CATEGORIES:${entry.categories.map(escapeText).join(",")}`);
  if (entry.status) lines.push(`STATUS:${entry.status}`);
  if (entry.lastModified) lines.push(`LAST-MODIFIED:${formatUtc(entry.lastModified)}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(calendar: IcsCalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Space Works//Space Works Workspace//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    `X-WR-TIMEZONE:${escapeText(calendar.timeZone)}`,
    ...(calendar.description ? [`X-WR-CALDESC:${escapeText(calendar.description)}`] : []),
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...calendar.entries.flatMap((entry) => entryLines(entry, calendar.now)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/** A safe download name: "build-night.ics". */
export function icsFilename(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "event"}.ics`;
}
