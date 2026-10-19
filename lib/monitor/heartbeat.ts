import { CronExpressionParser } from "cron-parser";
import type { HeartbeatConfig } from "@/lib/monitor/schemas";

/**
 * Heartbeat (push) monitors: schedule maths and ping parsing. Pure; the
 * route handler and sweeper live in lib/monitor/heartbeatService.ts.
 *
 *   /api/hb/<token>            success (GET, HEAD or POST)
 *   /api/hb/<token>/start      a run started
 *   /api/hb/<token>/fail       explicit failure
 *   /api/hb/<token>/<0-255>    exit status (0 = success)
 *   /api/hb/<token>/log        store a message only
 *   ?rid=<uuid>                pairs start and finish
 */

export type PingAction = { kind: "SUCCESS" | "START" | "FAIL" | "LOG" | "EXIT"; exitCode: number | null };

export function parsePingAction(segment: string | undefined): PingAction | null {
  if (segment === undefined || segment === "") return { kind: "SUCCESS", exitCode: null };
  const value = segment.toLowerCase();
  if (value === "start") return { kind: "START", exitCode: null };
  if (value === "fail") return { kind: "FAIL", exitCode: null };
  if (value === "log") return { kind: "LOG", exitCode: null };
  if (/^\d{1,3}$/.test(value)) {
    const code = Number(value);
    if (code <= 255) return { kind: "EXIT", exitCode: code };
  }
  return null;
}

/** Does this ping count as a success, a failure, or neither (start/log)? */
export function pingOutcome(action: PingAction): "UP" | "DOWN" | null {
  if (action.kind === "SUCCESS") return "UP";
  if (action.kind === "FAIL") return "DOWN";
  if (action.kind === "EXIT") return action.exitCode === 0 ? "UP" : "DOWN";
  return null;
}

export function validateCron(expression: string, timeZone: string): string | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return "Use five fields: minute hour day-of-month month day-of-week.";
  try {
    CronExpressionParser.parse(expression, { tz: timeZone, currentDate: new Date() }).next();
    return null;
  } catch {
    return "That cron schedule is not valid.";
  }
}

/** When the next ping is due (before grace). */
export function nextExpectedAt(config: Pick<HeartbeatConfig, "schedule" | "periodSec" | "cronExpr" | "timezone">, from: Date): Date {
  if (config.schedule === "CRON" && config.cronExpr) {
    try {
      return CronExpressionParser.parse(config.cronExpr, { tz: config.timezone || "UTC", currentDate: from }).next().toDate();
    } catch {
      // fall back to the period
    }
  }
  return new Date(from.getTime() + config.periodSec * 1000);
}

export function isOverdue(expectedNextAt: Date | null, graceSec: number, now: Date): boolean {
  return expectedNextAt !== null && now.getTime() > expectedNextAt.getTime() + graceSec * 1000;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (value: string) => value.padStart(2, "0");

/** Plain-language reading of common cron schedules (falls back to "Custom schedule"). */
export function describeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return "Custom schedule";
  const [minute, hour, dom, month, dow] = fields;
  const isNum = (value: string) => /^\d{1,2}$/.test(value);
  if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") return `Every ${minute.slice(2)} minutes`;
  if (minute === "*" && hour === "*" && dom === "*" && month === "*" && dow === "*") return "Every minute";
  if (isNum(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*") return `Every hour at :${two(minute)}`;
  if (isNum(minute) && hour.startsWith("*/") && dom === "*" && month === "*" && dow === "*") return `Every ${hour.slice(2)} hours at :${two(minute)}`;
  if (isNum(minute) && isNum(hour) && dom === "*" && month === "*") {
    const time = `${two(hour)}:${two(minute)}`;
    if (dow === "*") return `Every day at ${time}`;
    if (/^[0-6]$/.test(dow)) return `Every ${DAYS[Number(dow)]} at ${time}`;
    if (dow === "1-5") return `Weekdays at ${time}`;
  }
  if (isNum(minute) && isNum(hour) && isNum(dom) && month === "*" && dow === "*") return `Monthly on day ${dom} at ${two(hour)}:${two(minute)}`;
  return "Custom schedule";
}

export function describeSchedule(config: Pick<HeartbeatConfig, "schedule" | "periodSec" | "cronExpr" | "timezone" | "graceSec">): string {
  const grace = config.graceSec >= 60 ? `${Math.round(config.graceSec / 60)} min grace` : `${config.graceSec} s grace`;
  if (config.schedule === "CRON" && config.cronExpr) return `${describeCron(config.cronExpr)} (${config.timezone}), ${grace}`;
  const period = config.periodSec % 3600 === 0 ? `${config.periodSec / 3600} h` : `${Math.round(config.periodSec / 60)} min`;
  return `Every ${period}, ${grace}`;
}
