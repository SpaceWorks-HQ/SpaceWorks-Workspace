import type { RenderedMessage, Severity } from "@/lib/notify/types";
import { escapeDiscordMarkdown, truncate } from "@/lib/messaging/format/escape";
import { messageBody, messageLinks, notificationTitle, type FormatOptions } from "@/lib/messaging/format/message";

/**
 * RenderedMessage → one Discord message with one embed (pure). Limits:
 * content 2000, embed title 256, description 4096, ≤25 fields (name 256,
 * value 1024), footer 2048, and 6000 characters across the whole embed.
 * Mentions never ping (`allowed_mentions.parse = []`) and user text is
 * markdown-escaped.
 */

export type DiscordEmbed = {
  title: string;
  description?: string;
  url?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline: boolean }>;
  footer: { text: string };
};

export type DiscordFormatted = {
  content: string;
  embeds: [DiscordEmbed];
  allowed_mentions: { parse: string[] };
};

/** Accent only: the severity word is always in the footer and content. */
export const DISCORD_SEVERITY_COLOR: Record<Severity, number> = { info: 0xb5cdff, warning: 0xffd447, critical: 0xb91c1c };

const EMBED_TOTAL_MAX = 6000;
const DESCRIPTION_MAX = 4096;

/** Make a URL safe inside markdown link parentheses. */
export function markdownUrl(url: string): string {
  return url.replace(/[()<>\s]/g, (char) => encodeURIComponent(char));
}

export function formatDiscordMessage(message: RenderedMessage, options: FormatOptions = {}): DiscordFormatted {
  const title = truncate(escapeDiscordMarkdown(notificationTitle(message, options.isTest)), 256);
  const footer = truncate(`${message.severityLabel} · ${message.workspace.name}`, 2048);

  let fields = message.fields.slice(0, 25).map((field) => ({
    name: truncate(escapeDiscordMarkdown(field.label), 256) || "-",
    value: truncate(escapeDiscordMarkdown(field.value), 1024) || "-",
    inline: true,
  }));

  const linkLine = messageLinks(message, 5)
    .map((link) => `[${escapeDiscordMarkdown(link.label)}](${markdownUrl(link.url)})`)
    .join(" · ");
  const linkPart = linkLine.length + 2 <= 2000 ? linkLine : "";

  const fieldsSize = () => fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  while (fields.length && title.length + footer.length + fieldsSize() + linkPart.length + 2 > EMBED_TOTAL_MAX) fields = fields.slice(0, -1);

  const budget = Math.min(DESCRIPTION_MAX, EMBED_TOTAL_MAX - title.length - footer.length - fieldsSize()) - (linkPart ? linkPart.length + 2 : 0);
  const body = escapeDiscordMarkdown(messageBody(message).trim());
  const bodyPart = body && budget > 1 ? truncate(body, budget) : "";
  const description = [bodyPart, linkPart].filter(Boolean).join("\n\n");

  const embed: DiscordEmbed = {
    title,
    ...(description ? { description } : {}),
    ...(message.url ? { url: message.url } : {}),
    color: DISCORD_SEVERITY_COLOR[message.severity],
    ...(fields.length ? { fields } : {}),
    footer: { text: footer },
  };
  return {
    content: truncate(`**${escapeDiscordMarkdown(message.severityLabel)}:** ${title}`, 2000),
    embeds: [embed],
    allowed_mentions: { parse: [] },
  };
}

/** Total characters Discord counts toward the 6000 embed limit. */
export function discordEmbedSize(embed: DiscordEmbed): number {
  return (
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.footer.text.length +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}
