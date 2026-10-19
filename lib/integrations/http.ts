import "server-only";

import type { SendResult } from "@/lib/notify/adapters/types";
import { checkPublicUrl, type Resolver } from "@/lib/integrations/ssrf";

/**
 * One HTTP helper for every provider call (Slack, Discord, Mattermost,
 * Telegram, WhatsApp, Google, GitHub, user webhooks). It always uses the
 * global `fetch` (tests mock it), times out, never follows redirects, reads
 * at most 1 MB, and turns failures into a retry decision:
 * 429 / 408 / 5xx / network errors are retryable, other 4xx are not, and
 * Retry-After (header, Discord `retry_after`, Telegram
 * `parameters.retry_after`) becomes `retryAfterSec`.
 *
 * Error strings never contain the request URL (webhook URLs and bot tokens
 * live in paths) or the request body.
 */

export type HttpOk<T> = { ok: true; status: number; data: T; headers: Headers };
export type HttpFail = { ok: false; status: number | null; retryable: boolean; error: string; retryAfterSec?: number; data?: unknown };
export type HttpOutcome<T> = HttpOk<T> | HttpFail;

export type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  /** Objects are sent as JSON; strings/URLSearchParams as-is. */
  body?: unknown;
  timeoutMs?: number;
  /** Run the SSRF guard first (user-supplied URLs). */
  guard?: boolean;
  resolver?: Resolver;
  /** Provider name for error messages ("Slack"). */
  label?: string;
};

const MAX_BODY_BYTES = 1_000_000;

export function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/** Retry-After in seconds from a header value (delta seconds or HTTP date). */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.max(1, Math.ceil(Number(trimmed)));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(1, Math.ceil((at - now) / 1000));
}

function bodyRetryAfter(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  const direct = record.retry_after;
  if (typeof direct === "number" && direct > 0) return Math.ceil(direct);
  const parameters = record.parameters as Record<string, unknown> | undefined;
  if (parameters && typeof parameters.retry_after === "number") return Math.ceil(parameters.retry_after);
  return undefined;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  const clipped = text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
  if (!clipped) return null;
  try {
    return JSON.parse(clipped);
  } catch {
    return clipped;
  }
}

/** Short provider-side reason from common error shapes (never echoes request data). */
export function providerReason(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data.replace(/\s+/g, " ").slice(0, 120) || null;
  if (typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const candidates = [record.error, record.message, record.description, (record.error as Record<string, unknown> | undefined)?.message, record.error_description];
  for (const candidate of candidates) if (typeof candidate === "string" && candidate) return candidate.slice(0, 160);
  return null;
}

export async function requestJson<T = unknown>(url: string, options: RequestOptions = {}): Promise<HttpOutcome<T>> {
  const label = options.label ?? "The service";
  if (options.guard) {
    const check = await checkPublicUrl(url, { resolver: options.resolver });
    if (!check.ok) return { ok: false, status: null, retryable: false, error: check.error };
  }
  const headers: Record<string, string> = { "User-Agent": "SpaceWorks-Workspace", ...options.headers };
  let body: BodyInit | undefined;
  if (options.body !== undefined && options.body !== null) {
    if (typeof options.body === "string" || options.body instanceof URLSearchParams) {
      body = options.body;
    } else {
      body = JSON.stringify(options.body);
      headers["Content-Type"] ??= "application/json; charset=utf-8";
    }
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (body ? "POST" : "GET"),
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      cache: "no-store",
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, status: null, retryable: true, error: timedOut ? `${label} did not answer in time.` : `Could not reach ${label}.` };
  }
  const data = await readBody(response);
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, status: response.status, retryable: false, error: `${label} answered with a redirect, which is not followed.` };
  }
  if (!response.ok) {
    const retryAfterSec = parseRetryAfter(response.headers.get("retry-after")) ?? bodyRetryAfter(data);
    const reason = providerReason(data);
    return {
      ok: false,
      status: response.status,
      retryable: isRetryableStatus(response.status),
      error: response.status === 429 ? `${label} is rate limiting requests.` : `${label} returned ${response.status}${reason ? ` (${reason})` : ""}.`,
      ...(retryAfterSec ? { retryAfterSec } : {}),
      data,
    };
  }
  return { ok: true, status: response.status, data: data as T, headers: response.headers };
}

/** Map a failed outcome onto the adapter contract. */
export function failToSendResult(outcome: HttpFail): SendResult {
  return { ok: false, retryable: outcome.retryable, error: outcome.error, ...(outcome.retryAfterSec ? { retryAfterSec: outcome.retryAfterSec } : {}) };
}
