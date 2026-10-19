import { formatDayLong, formatRelativeDay, formatTime } from "@/lib/format/datetime";
import type { MessageDTO } from "@/lib/chat/types";

/** Shared presentation helpers for the chat components (client-safe). */

/** Rendered message HTML: the markdown subset, mentions, channels and tasks, in tokens only. */
export const messageBodyClass = [
  "min-w-0 break-words text-body-ui text-ink",
  "[&_p]:m-0 [&_p+p]:mt-2 [&_p+ul]:mt-1 [&_p+ol]:mt-1",
  "[&_strong]:font-semibold [&_em]:italic [&_del]:line-through",
  "[&_code]:rounded [&_code]:bg-surface [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[13px]",
  "[&_pre]:my-2 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-inverse [&_pre]:p-3 [&_pre]:text-[13px] [&_pre]:text-on-inverse",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-on-inverse",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-secondary",
  "[&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_a:hover]:text-ink",
  "[&_.sw-mention]:rounded [&_.sw-mention]:bg-accent-soft [&_.sw-mention]:px-1 [&_.sw-mention]:font-semibold [&_.sw-mention]:text-accent-text",
  "[&_.sw-mention-me]:bg-warning-bg [&_.sw-mention-me]:text-warning-fg",
  "[&_a.sw-channel]:font-semibold [&_a.sw-channel]:no-underline [&_a.sw-task]:font-semibold",
].join(" ");

/** "Today", "Yesterday", or "Wednesday, 14 October". */
export function dayLabel(iso: string, timeZone: string): string {
  const relative = formatRelativeDay(iso, timeZone);
  return relative === "Today" || relative === "Yesterday" ? relative : formatDayLong(iso, timeZone);
}

export function dayKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export const timeLabel = formatTime;

/** Collapse a message into the previous one (same author, same kind, within five minutes). */
export function continuesPrevious(previous: MessageDTO | undefined, message: MessageDTO, timeZone: string): boolean {
  if (!previous || previous.deleted || message.deleted) return false;
  if (previous.author?.id !== message.author?.id || previous.authorKind !== message.authorKind) return false;
  if (previous.origin || message.origin) return false;
  if (dayKey(previous.createdAt, timeZone) !== dayKey(message.createdAt, timeZone)) return false;
  return new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Merge messages by id and keep (createdAt, id) order. */
export function mergeMessages(current: MessageDTO[], incoming: MessageDTO[]): MessageDTO[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
