import type { RenderedMessage } from "@/lib/notify/types";
import { escapeSlack, truncate } from "@/lib/messaging/format/escape";
import { messageBody, messageLinks, notificationTitle, truncateEscaped, type FormatOptions } from "@/lib/messaging/format/message";

/**
 * RenderedMessage → Slack Block Kit (pure). Used by incoming webhooks and
 * chat.postMessage alike. Limits: section text 3000, ≤50 blocks, ≤10 section
 * fields (2000 each), ≤5 link buttons (label 75, url 3000). The top-level
 * `text` is the notification/accessibility fallback and is always set.
 */

export type SlackBlock = Record<string, unknown>;
export type SlackFormatted = { text: string; blocks: SlackBlock[] };

const SECTION_MAX = 3000;
const MAX_BODY_SECTIONS = 10;

/** Split escaped mrkdwn into ≤`size` pieces, preferring line breaks, never inside an entity or surrogate pair. */
export function chunkEscaped(text: string, size = SECTION_MAX): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) {
      cut = size;
      const amp = rest.lastIndexOf("&", cut - 1);
      if (amp > cut - 6) {
        const semi = rest.indexOf(";", amp);
        if (semi === -1 || semi >= cut) cut = amp;
      }
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    }
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

export function formatSlackMessage(message: RenderedMessage, options: FormatOptions = {}): SlackFormatted {
  const title = escapeSlack(truncate(notificationTitle(message, options.isTest), 250));
  const body = messageBody(message).trim();
  const blocks: SlackBlock[] = [{ type: "section", text: { type: "mrkdwn", text: `*${title}*` } }];

  for (const chunk of chunkEscaped(escapeSlack(body)).slice(0, MAX_BODY_SECTIONS)) {
    if (chunk.trim()) blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }

  const fields = message.fields.slice(0, 10).map((field) => ({
    type: "mrkdwn",
    text: truncateEscaped(`*${escapeSlack(truncate(field.label, 100))}*\n${escapeSlack(field.value)}`, 2000),
  }));
  if (fields.length) blocks.push({ type: "section", fields });

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: truncateEscaped(`*${escapeSlack(message.severityLabel)}* · ${escapeSlack(message.workspace.name)}`, SECTION_MAX) }],
  });

  const links = messageLinks(message, 5).filter((link) => link.url.length <= 3000);
  if (links.length) {
    blocks.push({
      type: "actions",
      elements: links.map((link, index) => ({
        type: "button",
        action_id: `sw_link_${index}`,
        text: { type: "plain_text", text: truncate(link.label, 75), emoji: false },
        url: link.url,
      })),
    });
  }

  const fallback = `${message.severityLabel}: ${notificationTitle(message, options.isTest)}${body ? `\n${body}` : ""}`;
  return { text: truncateEscaped(escapeSlack(fallback), SECTION_MAX), blocks: blocks.slice(0, 50) };
}
