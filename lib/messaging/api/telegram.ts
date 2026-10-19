import "server-only";

import { requestJson, type HttpOutcome } from "@/lib/integrations/http";

/**
 * Telegram Bot API. Errors come back as `{ ok: false, error_code,
 * description, parameters: { retry_after } }`; 429 carries retry_after.
 * The bot token is part of the URL, so error strings never include it.
 */

export type TelegramSendMessage = {
  chat_id: string | number;
  text: string;
  parse_mode?: "HTML";
  message_thread_id?: number;
  reply_parameters?: { message_id: number; allow_sending_without_reply?: boolean };
  link_preview_options?: { is_disabled: boolean };
  reply_markup?: unknown;
};

export type TelegramMessage = { message_id: number; chat: { id: number; type: string; title?: string }; message_thread_id?: number };

export async function telegramApi<T = unknown>(token: string, method: string, body: Record<string, unknown> = {}): Promise<HttpOutcome<T>> {
  const outcome = await requestJson<{ ok: boolean; result?: T; description?: string }>(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body,
    label: "Telegram",
  });
  if (!outcome.ok) {
    const description = outcome.data && typeof outcome.data === "object" ? (outcome.data as { description?: unknown }).description : null;
    return typeof description === "string" && outcome.status !== 429 ? { ...outcome, error: `Telegram refused the request (${description.slice(0, 120)}).` } : outcome;
  }
  if (!outcome.data?.ok) return { ok: false, status: outcome.status, retryable: false, error: `Telegram refused the request (${outcome.data?.description ?? "unknown error"}).` };
  return { ok: true, status: outcome.status, data: outcome.data.result as T, headers: outcome.headers };
}

export function sendTelegramMessage(token: string, message: TelegramSendMessage) {
  return telegramApi<TelegramMessage>(token, "sendMessage", { link_preview_options: { is_disabled: true }, ...message });
}

export function editTelegramMessage(token: string, message: { chat_id: string | number; message_id: number; text: string; parse_mode?: "HTML" }) {
  return telegramApi<TelegramMessage>(token, "editMessageText", { link_preview_options: { is_disabled: true }, ...message });
}

export function getTelegramMe(token: string) {
  return telegramApi<{ id: number; is_bot: boolean; username: string; first_name: string }>(token, "getMe");
}

export function setTelegramWebhook(token: string, url: string, secretToken: string) {
  return telegramApi<boolean>(token, "setWebhook", { url, secret_token: secretToken, allowed_updates: ["message", "edited_message", "channel_post", "my_chat_member"], drop_pending_updates: true });
}

export function deleteTelegramWebhook(token: string) {
  return telegramApi<boolean>(token, "deleteWebhook", {});
}
