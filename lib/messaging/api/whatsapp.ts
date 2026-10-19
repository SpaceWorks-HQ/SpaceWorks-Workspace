import "server-only";

import { requestJson, type HttpOutcome } from "@/lib/integrations/http";

/**
 * WhatsApp Cloud API (Meta Graph). Free-form text is only allowed inside the
 * 24-hour customer service window; outside it Meta answers error 131047
 * ("re-engagement message") and an approved template must be used.
 */

export const DEFAULT_GRAPH_VERSION = "v21.0";
/** Error codes that mean "outside the service window, send a template". */
export const WHATSAPP_WINDOW_CLOSED_CODES = new Set([131047]);
/** Throughput / spam rate limits: retry later. */
const WHATSAPP_RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

export type WhatsAppSendResult = { messages: Array<{ id: string }> };

function graph(version: string | undefined, path: string) {
  return `https://graph.facebook.com/${version || DEFAULT_GRAPH_VERSION}${path}`;
}

/** Graph error code from a failed outcome (null when absent). */
export function whatsappErrorCode(outcome: HttpOutcome<unknown>): number | null {
  if (outcome.ok) return null;
  const error = outcome.data && typeof outcome.data === "object" ? (outcome.data as { error?: { code?: unknown } }).error : undefined;
  return typeof error?.code === "number" ? error.code : null;
}

async function send(token: string, phoneNumberId: string, body: Record<string, unknown>, version?: string): Promise<HttpOutcome<WhatsAppSendResult>> {
  const outcome = await requestJson<WhatsAppSendResult>(graph(version, `/${encodeURIComponent(phoneNumberId)}/messages`), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { messaging_product: "whatsapp", recipient_type: "individual", ...body },
    label: "WhatsApp",
  });
  const code = whatsappErrorCode(outcome);
  if (!outcome.ok && code !== null && WHATSAPP_RATE_LIMIT_CODES.has(code)) return { ...outcome, retryable: true, retryAfterSec: outcome.retryAfterSec ?? 60 };
  return outcome;
}

/** E.164 "+919876543210" → Graph "919876543210". */
export function waNumber(e164: string) {
  return e164.replace(/[^\d]/g, "");
}

export function sendWhatsAppText(token: string, phoneNumberId: string, to: string, text: string, options: { version?: string; replyTo?: string } = {}) {
  return send(
    token,
    phoneNumberId,
    { to: waNumber(to), type: "text", text: { body: text, preview_url: false }, ...(options.replyTo ? { context: { message_id: options.replyTo } } : {}) },
    options.version,
  );
}

export function sendWhatsAppTemplate(token: string, phoneNumberId: string, to: string, template: { name: string; language: string; bodyParams: string[] }, options: { version?: string } = {}) {
  return send(
    token,
    phoneNumberId,
    {
      to: waNumber(to),
      type: "template",
      template: {
        name: template.name,
        language: { code: template.language },
        ...(template.bodyParams.length ? { components: [{ type: "body", parameters: template.bodyParams.map((text) => ({ type: "text", text })) }] } : {}),
      },
    },
    options.version,
  );
}

export function getWhatsAppPhoneNumber(token: string, phoneNumberId: string, version?: string) {
  return requestJson<{ id: string; display_phone_number: string; verified_name?: string }>(graph(version, `/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`), {
    headers: { Authorization: `Bearer ${token}` },
    label: "WhatsApp",
  });
}
