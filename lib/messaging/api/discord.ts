import "server-only";

import { requestJson, type HttpOutcome } from "@/lib/integrations/http";

/**
 * Discord REST (v10) for bots and webhooks. Rate limits come back as 429
 * with `retry_after` (seconds, float) in the body and a Retry-After header;
 * lib/integrations/http.ts maps both onto `retryAfterSec`.
 */

const API = "https://discord.com/api/v10";

export type DiscordMessagePayload = {
  content?: string;
  embeds?: unknown[];
  allowed_mentions?: { parse: string[] };
  username?: string;
  avatar_url?: string;
  message_reference?: { message_id: string };
  flags?: number;
};

export type DiscordMessage = { id: string; channel_id: string };

export function discordBotApi<T = unknown>(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<HttpOutcome<T>> {
  return requestJson<T>(`${API}${path}`, { method: init.method ?? (init.body ? "POST" : "GET"), headers: { Authorization: `Bot ${token}` }, body: init.body, label: "Discord" });
}

/** Never ping anyone from a notification or bridge. */
export const NO_MENTIONS = { parse: [] as string[] };

export function createDiscordMessage(token: string, channelId: string, payload: DiscordMessagePayload) {
  return discordBotApi<DiscordMessage>(`/channels/${encodeURIComponent(channelId)}/messages`, token, { body: { allowed_mentions: NO_MENTIONS, ...payload } });
}

export function editDiscordMessage(token: string, channelId: string, messageId: string, payload: DiscordMessagePayload) {
  return discordBotApi<DiscordMessage>(`/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`, token, {
    method: "PATCH",
    body: { allowed_mentions: NO_MENTIONS, ...payload },
  });
}

export function getDiscordApplication(token: string) {
  return discordBotApi<{ id: string; name: string; verify_key: string; bot?: { id: string; username: string } }>("/applications/@me", token);
}

export function getDiscordBotUser(token: string) {
  return discordBotApi<{ id: string; username: string }>("/users/@me", token);
}

export function openDiscordDm(token: string, userId: string) {
  return discordBotApi<{ id: string }>("/users/@me/channels", token, { body: { recipient_id: userId } });
}

/** Register slash commands globally, or on one guild (instant) when `guildId` is set. */
export function registerDiscordCommands(token: string, applicationId: string, commands: unknown[], guildId?: string) {
  const path = guildId ? `/applications/${applicationId}/guilds/${encodeURIComponent(guildId)}/commands` : `/applications/${applicationId}/commands`;
  return discordBotApi(path, token, { method: "PUT", body: commands });
}

/** Follow-up for a deferred interaction (no bot token needed; the interaction token authorises it for 15 minutes). */
export function editInteractionResponse(applicationId: string, interactionToken: string, payload: DiscordMessagePayload) {
  return requestJson<DiscordMessage>(`${API}/webhooks/${applicationId}/${encodeURIComponent(interactionToken)}/messages/@original`, {
    method: "PATCH",
    body: { allowed_mentions: NO_MENTIONS, ...payload },
    label: "Discord",
  });
}

/** Execute a channel webhook; `wait=true` returns the created message (id for edits/threads). */
export function executeDiscordWebhook(url: string, payload: DiscordMessagePayload, options: { threadId?: string } = {}) {
  const target = new URL(url);
  target.searchParams.set("wait", "true");
  if (options.threadId) target.searchParams.set("thread_id", options.threadId);
  return requestJson<DiscordMessage>(target.toString(), { method: "POST", body: { allowed_mentions: NO_MENTIONS, ...payload }, label: "Discord" });
}

export function editDiscordWebhookMessage(url: string, messageId: string, payload: DiscordMessagePayload, options: { threadId?: string } = {}) {
  const target = new URL(`${url.replace(/\/$/, "")}/messages/${encodeURIComponent(messageId)}`);
  if (options.threadId) target.searchParams.set("thread_id", options.threadId);
  return requestJson<DiscordMessage>(target.toString(), { method: "PATCH", body: { allowed_mentions: NO_MENTIONS, ...payload }, label: "Discord" });
}
