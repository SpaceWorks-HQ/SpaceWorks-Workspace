import "server-only";
import { LINKEDIN_VERSION } from "./config";
import { object, array, number, string } from "./types";
export class SocialApiError extends Error {
  constructor(message: string, readonly kind: "RATE_LIMIT" | "ACCESS" | "TOKEN" | "REMOTE" | "UNKNOWN", readonly retryAt?: Date, readonly status?: number) { super(message); }
}
export const X_ACCESS_MESSAGE = "X did not allow this endpoint. Check API access, paid credits and spending limits in the X Developer Console; reply search and private metrics may be unavailable.";
/** Retry headers take precedence. Meta usage can signal throttling before a 429.
 * https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
 * https://docs.x.com/x-api/fundamentals/rate-limits */
export function backoffAt(headers: Headers, now = new Date()): Date | undefined {
  const waits: number[] = []; const retry = headers.get("retry-after");
  if (retry) { const seconds = Number(retry); const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - now.getTime(); if (Number.isFinite(wait)) waits.push(wait); }
  if (headers.get("x-rate-limit-remaining") === "0") { const reset = Number(headers.get("x-rate-limit-reset")); if (reset) waits.push(reset * 1000 - now.getTime()); }
  for (const name of ["x-app-usage", "x-page-usage", "x-business-use-case-usage"]) {
    try { const data: unknown = JSON.parse(headers.get(name) ?? "{}"); const visit = (v: unknown): void => { if (Array.isArray(v)) { v.forEach(visit); return; } const row = object(v); if (["call_count", "total_cputime", "total_time"].some(k => (number(row[k]) ?? 0) >= 90)) waits.push(Math.max(900000, (number(row.estimated_time_to_regain_access) ?? 0) * 60000)); Object.values(row).filter(x => typeof x === "object").forEach(visit); }; visit(data); } catch { /* An invalid usage header cannot override a valid retry header. */ }
  }
  return waits.length ? new Date(now.getTime() + Math.max(1000, Math.min(7 * 86400000, Math.max(...waits)))) : undefined;
}
const ORIGINS = new Set(["https://www.googleapis.com", "https://youtubeanalytics.googleapis.com", "https://oauth2.googleapis.com", "https://graph.facebook.com", "https://api.linkedin.com", "https://www.linkedin.com", "https://api.x.com"]);
export type ApiClient = ReturnType<typeof client>;
export function client(token: string, onBackoff?: (until: Date) => void) {
  let blocked: Date | undefined;
  let calls = 0;
  return async (url: string | URL, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    if (blocked && blocked.getTime() > Date.now()) throw new SocialApiError("The platform is rate limiting requests. Sync will resume after the wait period.", "RATE_LIMIT", blocked);
    if (++calls > 250) throw new SocialApiError("This sync reached its request budget. Remaining data will be fetched on a later sync.", "RATE_LIMIT", new Date(Date.now() + 900000));
    const target = new URL(url); if (!ORIGINS.has(target.origin)) throw new SocialApiError("The platform returned an unsupported API address.", "REMOTE");
    const headers = new Headers(init.headers); if (token) headers.set("Authorization", `Bearer ${token}`);
    if (target.hostname === "api.linkedin.com") { headers.set("LinkedIn-Version", LINKEDIN_VERSION); headers.set("X-Restli-Protocol-Version", "2.0.0"); }
    let response: Response;
    try { response = await fetch(target, { ...init, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) }); }
    catch { throw new SocialApiError("The platform did not confirm the request. Check its current state before trying a reply again.", "UNKNOWN"); }
    const rateHeaders = new Headers(response.headers); if (response.status === 429 && rateHeaders.has("x-rate-limit-reset")) rateHeaders.set("x-rate-limit-remaining", "0");
    const until = backoffAt(rateHeaders); if (until) { blocked = until; onBackoff?.(until); }
    let data: Record<string, unknown> = {};
    if (response.status !== 204) { try { const body = await response.text(); if (body.length > 8_000_000) throw new Error(); data = object(body ? JSON.parse(body) : {}); } catch { throw new SocialApiError("The platform returned an unreadable response. Try syncing again.", init.method && init.method !== "GET" ? "UNKNOWN" : "REMOTE"); } }
    if (response.ok) return data;
    const code = number(object(data.error).code); const reason = string(object(data.error).status);
    if (data.error === "invalid_grant" || data.error === "invalid_token") throw new SocialApiError("Account access expired or was revoked. Reconnect the account in Social settings.", "TOKEN", undefined, response.status);
    if (array(object(data.error).errors).some(e => ["quotaExceeded", "dailyLimitExceeded"].includes(string(object(e).reason)))) throw new SocialApiError("YouTube daily API quota is exhausted. Sync will resume after the quota reset window.", "RATE_LIMIT", new Date(Date.now() + 86400000), response.status);
    if (response.status === 429 || code && [4, 17, 32, 613, 80004].includes(code) || reason === "RESOURCE_EXHAUSTED") throw new SocialApiError("The platform is rate limiting requests. Sync will resume after the wait period.", "RATE_LIMIT", until ?? new Date(Date.now() + 900000), response.status);
    if (response.status === 401 || code === 190) throw new SocialApiError("Account access expired or was revoked. Reconnect the account in Social settings.", "TOKEN", undefined, response.status);
    if (response.status === 403 || response.status === 402 || code === 10 || code === 200) throw new SocialApiError(target.hostname === "api.x.com" ? X_ACCESS_MESSAGE : "The app is missing permission or approval for this request. Review its permissions and reconnect.", "ACCESS", undefined, response.status);
    throw new SocialApiError("The platform rejected the request. Check the account and try again.", response.status >= 500 && init.method && init.method !== "GET" ? "UNKNOWN" : "REMOTE", undefined, response.status);
  };
}
export function endpoint(base: string, path: string, query: Record<string, string | number | undefined> = {}) { const url = new URL(path, base); for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v)); return url; }
export const jsonBody = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
