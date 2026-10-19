import "server-only";

import { CloudApiError, type AdapterContext, type VerifyResult } from "@/lib/monitor/cloud/types";

/** Small helpers shared by the provider adapters. */

export const MAX_PAGES = 10;

export function requireCredential(ctx: AdapterContext, key: string, label: string): string {
  const value = ctx.credentials[key]?.trim();
  if (!value) throw new CloudApiError(`The ${label} is missing. Add it and save again.`, "config");
  return value;
}

export function bearer(ctx: AdapterContext, label = "API token"): Record<string, string> {
  return { authorization: `Bearer ${requireCredential(ctx, "token", label)}` };
}

export function configString(ctx: AdapterContext, key: string): string | null {
  const value = ctx.config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function configList(ctx: AdapterContext, key: string): string[] {
  const value = ctx.config[key];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return items.map((item) => String(item).trim()).filter(Boolean);
}

/** Runs a verify body and turns any failure into a short, UI-safe sentence (never a token or body). */
export async function safeVerify(body: () => Promise<string | null>): Promise<VerifyResult> {
  try {
    return { ok: true, accountLabel: await body() };
  } catch (error) {
    if (!(error instanceof CloudApiError)) return { ok: false, error: "Couldn't verify the connection. Check the details and try again." };
    if (error.kind === "auth") return { ok: false, error: `${error.message} Check the credentials and their read permissions, then try again.` };
    return { ok: false, error: error.message };
  }
}

export function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function withQuery(url: string, params: Record<string, string | number | null | undefined>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== "") parsed.searchParams.set(key, String(value));
  return parsed.toString();
}

export function httpsUrl(host: unknown): string | null {
  if (typeof host !== "string" || !host) return null;
  return host.startsWith("http://") || host.startsWith("https://") ? host : `https://${host}`;
}
