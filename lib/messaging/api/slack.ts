import "server-only";

import { requestJson, type HttpOutcome } from "@/lib/integrations/http";

/**
 * Slack Web API and incoming webhooks (thin; formatting lives in
 * lib/messaging/format/slack.ts). Slack answers HTTP 200 with `ok: false`
 * for API errors, so those are normalised to failures here.
 */

const RETRYABLE_SLACK_ERRORS = new Set(["ratelimited", "internal_error", "fatal_error", "service_unavailable", "request_timeout"]);

export type SlackMessage = { channel: string; text: string; blocks?: unknown[]; thread_ts?: string; unfurl_links?: boolean; unfurl_media?: boolean; username?: string; icon_url?: string };

export async function slackApi<T extends Record<string, unknown> = Record<string, unknown>>(method: string, token: string, body: Record<string, unknown> = {}): Promise<HttpOutcome<T>> {
  const outcome = await requestJson<T & { ok?: boolean; error?: string }>(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
    label: "Slack",
  });
  if (!outcome.ok) return outcome;
  if (outcome.data && outcome.data.ok === false) {
    const code = typeof outcome.data.error === "string" && /^[a-z_]{1,80}$/.test(outcome.data.error) ? outcome.data.error : "unknown_error";
    return { ok: false, status: outcome.status, retryable: RETRYABLE_SLACK_ERRORS.has(code), error: `Slack refused the request (${code}).`, data: outcome.data };
  }
  return outcome as HttpOutcome<T>;
}

export function postSlackMessage(token: string, message: SlackMessage) {
  return slackApi<{ ts: string; channel: string }>("chat.postMessage", token, { unfurl_links: false, unfurl_media: false, ...message });
}

export function updateSlackMessage(token: string, message: { channel: string; ts: string; text: string; blocks?: unknown[] }) {
  return slackApi<{ ts: string; channel: string }>("chat.update", token, message);
}

export function slackAuthTest(token: string) {
  return slackApi<{ team_id: string; team: string; user_id: string; bot_id?: string; url: string }>("auth.test", token);
}

/** Open (or reuse) the DM channel between the bot and a user. */
export async function openSlackDm(token: string, userId: string): Promise<HttpOutcome<{ channel: { id: string } }>> {
  return slackApi<{ channel: { id: string } }>("conversations.open", token, { users: userId });
}

export function slackUserInfo(token: string, userId: string) {
  return slackApi<{ user: { id: string; name: string; real_name?: string; profile?: { display_name?: string; real_name?: string; image_72?: string } } }>("users.info", token, { user: userId });
}

/** Incoming webhook: answers the plain text "ok"; errors are plain text codes (no_service, channel_not_found…). */
export async function postSlackWebhook(url: string, payload: Record<string, unknown>): Promise<HttpOutcome<unknown>> {
  return requestJson(url, { method: "POST", body: payload, guard: true, label: "Slack" });
}
