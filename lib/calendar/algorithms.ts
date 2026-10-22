import { zonedDatetimeLocalValue, zonedInputToIso } from "@/lib/timeZone";

export type Repeat = "NONE" | "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";
export type Busy = { start: string; end: string; userId?: string };
export const LAYERS = {
  meeting: "Meeting",
  task: "Task due",
  availability: "Time off / availability",
  shift: "Rota shift",
  cycle: "Cycle",
  renewal: "Renewal",
  rotation: "Vault rotation",
  maintenance: "Maintenance",
  deadline: "Compliance deadline",
  reminder: "Personal reminder",
  google: "Google busy",
} as const;
export type Layer = keyof typeof LAYERS;

/** Finite wall-clock recurrence. Invalid month days and DST gaps are skipped (RFC 5545). */
export function expandRecurrence(
  start: Date,
  repeat: Repeat,
  until: Date,
  zone: string,
): Date[] {
  const local = zonedDatetimeLocalValue(start, zone);
  const [day, clock] = local.split("T");
  const anchor = new Date(`${day}T12:00:00Z`);
  const out: Date[] = [];
  for (let index = 0; index < 367; index++) {
    const date = new Date(anchor);
    if (repeat === "MONTHLY") {
      date.setUTCDate(1);
      date.setUTCMonth(date.getUTCMonth() + index);
      const month = date.getUTCMonth();
      date.setUTCDate(anchor.getUTCDate());
      if (date.getUTCMonth() !== month) continue;
    } else
      date.setUTCDate(
        date.getUTCDate() +
          index * (repeat === "BIWEEKLY" ? 14 : repeat === "WEEKLY" ? 7 : 1),
      );
    const key = date.toISOString().slice(0, 10);
    if (key > zonedDatetimeLocalValue(until, zone).slice(0, 10)) break;
    const iso = zonedInputToIso(`${key}T${clock}`, zone);
    if (iso) {
      const occurrence =
        index === 0
          ? new Date(start)
          : new Date(
              Date.parse(iso) +
                start.getUTCSeconds() * 1000 +
                start.getUTCMilliseconds(),
            );
      if (occurrence <= until) out.push(occurrence);
    }
    if (repeat === "NONE") break;
  }
  return out;
}
export function recurrenceRule(repeat: Repeat, count: number) {
  return repeat === "NONE"
    ? null
    : `FREQ=${repeat === "MONTHLY" ? "MONTHLY" : repeat === "DAILY" ? "DAILY" : "WEEKLY"};INTERVAL=${repeat === "BIWEEKLY" ? 2 : 1};COUNT=${count}`;
}
export function mergeBusy(blocks: Busy[]): Busy[] {
  const sorted = blocks
    .filter((b) => Date.parse(b.end) > Date.parse(b.start))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const merged: Busy[] = [];
  for (const block of sorted) {
    const last = merged.at(-1);
    if (last && Date.parse(block.start) <= Date.parse(last.end))
      last.end = new Date(
        Math.max(Date.parse(last.end), Date.parse(block.end)),
      ).toISOString();
    else merged.push({ start: block.start, end: block.end });
  }
  return merged;
}
export function findTimes(
  blocks: Busy[],
  from: Date,
  minutes: number,
  zone: string,
  startHour = 9,
  endHour = 18,
): Busy[] {
  const busy = mergeBusy(blocks),
    suggestions: Busy[] = [];
  const first = new Date(
    `${zonedDatetimeLocalValue(from, zone).slice(0, 10)}T12:00Z`,
  );
  for (let day = 0; day < 14; day++) {
    const date = new Date(first);
    date.setUTCDate(date.getUTCDate() + day);
    if ([0, 6].includes(date.getUTCDay())) continue;
    const key = date.toISOString().slice(0, 10);
    for (
      let minute = startHour * 60;
      minute + minutes <= endHour * 60;
      minute += 30
    ) {
      const iso = zonedInputToIso(
        `${key}T${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
        zone,
      );
      if (!iso || Date.parse(iso) < from.getTime()) continue;
      const end = new Date(Date.parse(iso) + minutes * 60000).toISOString();
      if (
        !busy.some(
          (b) =>
            Date.parse(b.start) < Date.parse(end) &&
            Date.parse(b.end) > Date.parse(iso),
        )
      )
        suggestions.push({ start: iso, end });
      if (suggestions.length === 8) return suggestions;
    }
  }
  return suggestions;
}
export function layerAllowed(layer: Layer, guest: boolean, involved: boolean) {
  return (
    !guest || (involved && ["meeting", "task", "reminder"].includes(layer))
  );
}
export function csvCell(value: string) {
  return `"${value.replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
}
