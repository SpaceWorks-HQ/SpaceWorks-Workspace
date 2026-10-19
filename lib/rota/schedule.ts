import { zonedInputToIso } from "@/lib/timeZone";

/** Preserve workspace wall-clock hours across weekly repeats; reject missing times. */
export function weeklyShiftInstances(input: { startsAt: string; endsAt: string; weeks: number }, timezone: string) {
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 12 || !zonedInputToIso(input.startsAt, timezone) || !zonedInputToIso(input.endsAt, timezone)) return null;
  const instances: { startsAt: Date; endsAt: Date }[] = [];
  for (let week = 0; week < input.weeks; week++) {
    const local = (value: string) => {
      const date = new Date(`${value}:00Z`);
      date.setUTCDate(date.getUTCDate() + week * 7);
      return date.toISOString().slice(0, 16);
    };
    const start = zonedInputToIso(local(input.startsAt), timezone);
    const end = zonedInputToIso(local(input.endsAt), timezone);
    if (!start || !end || end <= start || new Date(end).getTime() - new Date(start).getTime() > 86400000) return null;
    instances.push({ startsAt: new Date(start), endsAt: new Date(end) });
  }
  return instances;
}
