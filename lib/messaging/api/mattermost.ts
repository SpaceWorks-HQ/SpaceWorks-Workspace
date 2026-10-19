import "server-only";

import { requestJson, type HttpOutcome } from "@/lib/integrations/http";

/**
 * Mattermost REST v4 (bot accounts) and incoming webhooks. The server URL is
 * admin-supplied, so every call runs through the SSRF guard.
 */

export type MattermostPost = { id: string; channel_id: string; root_id?: string };

function base(serverUrl: string) {
  return serverUrl.replace(/\/+$/, "");
}

export function mattermostApi<T = unknown>(serverUrl: string, token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<HttpOutcome<T>> {
  return requestJson<T>(`${base(serverUrl)}/api/v4${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { Authorization: `Bearer ${token}` },
    body: init.body,
    guard: true,
    label: "Mattermost",
  });
}

export function createMattermostPost(serverUrl: string, token: string, post: { channel_id: string; message: string; root_id?: string; props?: Record<string, unknown> }) {
  return mattermostApi<MattermostPost>(serverUrl, token, "/posts", { body: post });
}

export function updateMattermostPost(serverUrl: string, token: string, postId: string, post: { message: string; props?: Record<string, unknown> }) {
  return mattermostApi<MattermostPost>(serverUrl, token, `/posts/${encodeURIComponent(postId)}/patch`, { method: "PUT", body: post });
}

export function getMattermostMe(serverUrl: string, token: string) {
  return mattermostApi<{ id: string; username: string; is_bot?: boolean }>(serverUrl, token, "/users/me");
}

export function getMattermostUser(serverUrl: string, token: string, userId: string) {
  return mattermostApi<{ id: string; username: string; first_name?: string; last_name?: string; nickname?: string }>(serverUrl, token, `/users/${encodeURIComponent(userId)}`);
}

/** Direct channel between the bot and a user. */
export function openMattermostDm(serverUrl: string, token: string, botUserId: string, userId: string) {
  return mattermostApi<{ id: string }>(serverUrl, token, "/channels/direct", { body: [botUserId, userId] });
}

/** Incoming webhook (answers "ok"). */
export function postMattermostWebhook(url: string, payload: Record<string, unknown>) {
  return requestJson(url, { method: "POST", body: payload, guard: true, label: "Mattermost" });
}
