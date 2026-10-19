import "server-only";
import { ProxyAgent } from "undici";
import { proxySchema } from "@/lib/appReviews/validation";
import { StoreError, type Transport } from "./types";

const HOSTS = new Set(["api.appstoreconnect.apple.com", "oauth2.googleapis.com", "androidpublisher.googleapis.com", "slack.com"]);
/** Redirects are never followed, including pagination and OAuth URLs. */
export function officialUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new StoreError("INVALID", "The store returned an invalid address."); }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443") || url.hash) throw new StoreError("INVALID", "The store returned an untrusted address.");
  return url;
}
export async function requestJson<T>(raw: string, init: RequestInit, transport?: Transport): Promise<T> {
  const url = officialUrl(raw);
  if (transport && !transport.proxyUrl && !transport.allowNoProxy) throw new StoreError("PROXY_REQUIRED", "Add an egress proxy or allow a direct connection for this app.");
  let agent: ProxyAgent | undefined;
  try {
    if (transport?.proxyUrl) {
      if (!proxySchema.safeParse(transport.proxyUrl).success) throw new StoreError("INVALID", "Check the egress proxy URL.");
      agent = new ProxyAgent(transport.proxyUrl);
    }
    const response = await fetch(url.toString(), { ...init, redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store", ...(agent ? { dispatcher: agent } : {}) });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new StoreError("AUTH", "The store refused access. Check the account permissions and credentials.");
      if (response.status === 404) throw new StoreError("NOT_FOUND", "The store couldn't find this app or review. Check the app identifier.");
      if (response.status === 429) throw new StoreError("RATE_LIMIT", "The store is busy. Wait a few minutes and try again.");
      throw new StoreError("STORE", "The store couldn't complete the request. Try again later.");
    }
    if (response.status === 204) return null as T;
    const reader = response.body?.getReader();
    if (!reader) throw new StoreError("INVALID", "The store returned an empty response. Try again later.");
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 4_000_000) { await reader.cancel(); throw new StoreError("INVALID", "The store response was too large. Try again later."); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new StoreError("TIMEOUT", "The store took too long. Check your connection and try again.");
    throw new StoreError("NETWORK", "Couldn't contact the store. Check your connection and try again.");
  } finally { await agent?.destroy(); }
}
