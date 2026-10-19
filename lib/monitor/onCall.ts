import { zonedDatetimeLocalValue } from "@/lib/timeZone";
export function currentOnCall(schedule: { participants: string[]; rotation: string; handoffTime: string; timezone: string; createdAt: Date; overrides: unknown }, at: Date): string | null {
  const overrides = Array.isArray(schedule.overrides) ? schedule.overrides as Array<{ userId: string; start: string; end: string }> : [];
  const override = overrides.find(o => new Date(o.start) <= at && at < new Date(o.end));
  if (override) return override.userId;
  if (!schedule.participants.length) return null;
  const dayNumber = (date: Date) => {
    const local = zonedDatetimeLocalValue(date, schedule.timezone);
    return Math.floor(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) / 86400000) - (local.slice(11, 16) < schedule.handoffTime ? 1 : 0);
  };
  const period = schedule.rotation === "DAILY" ? 1 : 7;
  const index = Math.floor((dayNumber(at) - dayNumber(schedule.createdAt)) / period);
  return schedule.participants[((index % schedule.participants.length) + schedule.participants.length) % schedule.participants.length];
}
