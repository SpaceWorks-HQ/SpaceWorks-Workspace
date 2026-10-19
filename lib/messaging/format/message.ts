import type { RenderedMessage } from "@/lib/notify/types";
import { truncate } from "@/lib/messaging/format/escape";

/**
 * Pieces every provider formatter shares (pure): the title with its test
 * marker, the body without the field lines `renderMessage` appends to
 * `text`, the link list (deep link + action links) and entity-safe cuts.
 */

export type FormatOptions = { isTest?: boolean };
export type MessageLink = { label: string; url: string };

export const OPEN_LABEL = "Open in Space Works";

export function notificationTitle(message: RenderedMessage, isTest = false): string {
  return `${isTest ? "[Test] " : ""}${message.title}`;
}

/** `message.text` minus the "Label: value" lines rich formats show as fields. */
export function messageBody(message: RenderedMessage): string {
  const lines = message.fields.map((field) => `${field.label}: ${field.value}`);
  if (lines.length === 0) return message.text;
  const suffix = lines.join("\n");
  if (message.text === suffix) return "";
  if (message.text.endsWith(`\n${suffix}`)) return message.text.slice(0, -(suffix.length + 1));
  // The rendered text was cut at 3000 characters: drop whole and partial field lines.
  const known = new Set(lines);
  const kept = message.text.split("\n").filter((line) => !known.has(line));
  const last = kept.at(-1);
  if (last && lines.some((line) => line.startsWith(last))) kept.pop();
  return kept.join("\n");
}

/** Deep link first, then action links (deduplicated), at most `max`. */
export function messageLinks(message: RenderedMessage, max = 5): MessageLink[] {
  const links: MessageLink[] = [];
  const seen = new Set<string>();
  const add = (label: string, url: string | null) => {
    if (!url || !label.trim()) return;
    const key = `${label}\u0000${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ label, url });
  };
  add(OPEN_LABEL, message.url);
  for (const action of message.actions) {
    if (action.id === "open" && action.url === message.url) continue;
    add(action.label, action.url);
  }
  return links.slice(0, max);
}

/** Truncate already-escaped HTML/mrkdwn text without leaving half an entity ("&am…"). */
export function truncateEscaped(text: string, max: number): string {
  if (text.length <= max) return text;
  return truncate(text, max).replace(/&[a-zA-Z0-9#]*…$/, "…");
}

/** One line: newlines and tabs become spaces, runs of whitespace collapse. */
export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Provider id of the thread to reply under: the root message's id (Slack ts,
 * Mattermost post id, Discord/Telegram message id) when an earlier message in
 * the same thread was delivered.
 */
export function threadRoot(thread: { providerMessageId: string | null; providerThreadId: string | null } | null | undefined): string | null {
  if (!thread?.providerMessageId) return null;
  return thread.providerThreadId ?? thread.providerMessageId;
}
