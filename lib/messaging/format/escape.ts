/**
 * Escaping and length helpers shared by the provider adapters, bot replies
 * and channel bridges (pure).
 */

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair; adds "…" when cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…".slice(0, max);
  let end = max - 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}…`;
}

/** Telegram HTML parse mode: only &, < and > need escaping in text; quotes too inside attributes. */
export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function escapeHtmlAttribute(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, "&quot;");
}

/** Slack mrkdwn / plain text: &, < and > are control characters (links, mentions). */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Discord markdown: neutralise formatting characters and mass mentions. */
export function escapeDiscordMarkdown(text: string): string {
  return text
    .replace(/([\\*_~`|[\]])/g, "\\$1")
    .replace(/^(\s*)([>#-])/gm, "$1\\$2")
    .replace(/@(everyone|here)/g, "@\u200b$1");
}

/** Mattermost markdown: neutralise formatting characters and channel-wide mentions. */
export function escapeMattermostMarkdown(text: string): string {
  return text
    .replace(/([\\*_~`|[\]])/g, "\\$1")
    .replace(/^(\s*)([>#-])/gm, "$1\\$2")
    .replace(/@(all|channel|here|everyone)\b/g, "@\u200b$1");
}
