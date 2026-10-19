import "server-only";

import { waitForSlot } from "@/lib/monitor/coord";
import { CloudApiError, type ProviderHttp } from "@/lib/monitor/cloud/types";

/**
 * Rate-limited JSON client for provider APIs. Requests for one connection
 * are spaced by the provider's published limit (Redis slot per connection),
 * 429 answers wait for Retry-After / RateLimit-Reset, 5xx answers back off
 * exponentially with jitter. Errors never include credentials or bodies.
 */

type Options = {
  /** Connection id: the rate-limit bucket. */
  key: string;
  spacingMs: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_WAIT_MS = 30_000;

/** Seconds to wait from Retry-After or RateLimit-Reset (delta seconds or a Unix timestamp). */
export function retryDelayMs(headers: Headers, now = Date.now()): number | null {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, date - now);
  }
  const reset = headers.get("ratelimit-reset") ?? headers.get("x-ratelimit-reset");
  if (reset) {
    const value = Number(reset);
    if (Number.isFinite(value)) return value > 1_000_000_000 ? Math.max(0, value * 1000 - now) : Math.max(0, value * 1000);
  }
  return null;
}

export function createProviderHttp(options: Options): ProviderHttp {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve, reject) => {
    options.signal?.throwIfAborted();
    const finish = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); reject(new CloudApiError("Sync time budget reached. Trying again later.", "network")); };
    options.signal?.addEventListener("abort", abort, { once: true });
  }));
  const maxRetries = options.maxRetries ?? 3;
  return {
    async json<T>(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
      for (let attempt = 0; ; attempt += 1) {
        options.signal?.throwIfAborted();
        if (options.spacingMs > 0 && !(await waitForSlot(`cloud:${options.key}`, options.spacingMs, Math.max(MAX_WAIT_MS, options.spacingMs + 1000), options.signal))) {
          throw new CloudApiError("Provider coordination is unavailable. Sync will retry later.", "rate_limited", 429);
        }
        let response: Response;
        try {
          response = await fetchImpl(url, {
            method: init.method ?? "GET",
            headers: { accept: "application/json", "user-agent": "SpaceWorks-Monitor/1.0", ...(init.headers ?? {}) },
            body: init.body,
            signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]) : AbortSignal.timeout(options.timeoutMs ?? 15_000),
            redirect: "error",
          });
        } catch {
          if (attempt < maxRetries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new CloudApiError("Couldn't reach the provider API.", "network");
        }
        if (response.status === 429) {
          await response.body?.cancel();
          if (attempt >= maxRetries) throw new CloudApiError("The provider is rate limiting requests. Sync will retry later.", "rate_limited", 429);
          const delay = retryDelayMs(response.headers) ?? backoff(attempt);
          if (delay > MAX_WAIT_MS) throw new CloudApiError("The provider requested a longer pause. Sync will retry later.", "rate_limited", 429, delay);
          await sleep(delay + jitter());
          continue;
        }
        if (response.status >= 500) {
          await response.body?.cancel();
          if (attempt < maxRetries) {
            await sleep(backoff(attempt));
            continue;
          }
          throw new CloudApiError(`The provider API answered ${response.status}.`, "http", response.status);
        }
        if (response.status === 401 || response.status === 403) {
          await response.body?.cancel();
          throw new CloudApiError(response.status === 401 ? "The provider rejected the credentials." : "The credentials lack a required read permission.", "auth", response.status);
        }
        const text = await response.text();
        let data: unknown = text;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }
        if (response.status >= 400) throw new CloudApiError(`The provider API answered ${response.status}.`, "http", response.status);
        return { status: response.status, data: data as T, headers: response.headers };
      }
    },
  };
}

function backoff(attempt: number) {
  return Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt) + jitter();
}

function jitter() {
  return Math.floor(Math.random() * 250);
}
