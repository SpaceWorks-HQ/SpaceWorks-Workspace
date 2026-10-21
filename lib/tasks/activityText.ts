import { formatDayShort } from "@/lib/format/datetime";
import { PRIORITY_LABELS } from "@/lib/tasks/filters";

/**
 * One line of task history in plain language (pure, client-safe). `data`
 * is the TaskActivity JSON written by lib/tasks/service.ts.
 */

type Data = Record<string, unknown> | null | undefined;

const str = (value: unknown) => (typeof value === "string" ? value : "");
/** "Every week on Mon" → "every week on Mon" (only the first letter). */
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "someone";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Kinds shown elsewhere (comments have their own list) or internal markers. */
export const HIDDEN_ACTIVITY_KINDS = new Set(["commented"]);

export function activityText(kind: string, data: Data, context: { nameOf: (userId: string) => string; timeZone: string }): string {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "plan_updated": return "updated the schedule and blocker";
    case "created":
      return "created this task";
    case "created_recurring":
      return `was created by the repeat schedule${str(d.text) ? ` (${lowerFirst(str(d.text))})` : ""}`;
    case "title":
      return `renamed this from “${str(d.from)}”`;
    case "description":
      return "updated the description";
    case "priority": {
      const to = str(d.to) as keyof typeof PRIORITY_LABELS;
      return to === "NONE" ? "cleared the priority" : `set the priority to ${(PRIORITY_LABELS[to] ?? to).toLowerCase()}`;
    }
    case "due":
      return d.to ? `set the due date to ${formatDayShort(str(d.to), context.timeZone)}` : "cleared the due date";
    case "moved":
      return d.from ? `moved this from ${str(d.from)} to ${str(d.to)}` : `moved this to ${str(d.to)}`;
    case "assigned":
      return `assigned ${joinNames(list(d.userIds).map(context.nameOf))}`;
    case "unassigned":
      return `unassigned ${joinNames(list(d.userIds).map(context.nameOf))}`;
    case "labeled":
      return `added the ${list(d.names).length === 1 ? "label" : "labels"} ${joinNames(list(d.names))}`;
    case "unlabeled":
      return `removed the ${list(d.names).length === 1 ? "label" : "labels"} ${joinNames(list(d.names))}`;
    case "completed":
      return "marked this done";
    case "reopened":
      return "reopened this";
    case "archived":
      return "archived this task";
    case "restored":
      return "restored this task";
    case "commented":
      return "commented";
    case "subtask_added":
      return `added the subtask “${str(d.title)}”`;
    case "blocked_by_added":
      return `marked this as blocked by ${str(d.ref)}`;
    case "blocks_added":
      return `marked this as blocking ${str(d.ref)}`;
    case "blocked_by_removed":
      return d.ref ? `removed the blocker ${str(d.ref)}` : "removed a blocker";
    case "unblocked":
      return `finished ${str(d.by)}, so this is no longer blocked`;
    case "attachment_added":
      return `attached ${str(d.filename)}`;
    case "attachment_removed":
      return `removed the attachment ${str(d.filename)}`;
    case "recurrence_set":
      return `set this to repeat: ${lowerFirst(str(d.text))}`;
    case "recurrence_stopped":
      return "stopped repeating this task";
    case "recurrence_skipped":
      return "skipped the next repeat";
    default:
      return "updated this task";
  }
}
