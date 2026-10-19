import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
/** Slack's top-level fallback text still treats these characters specially. */
export function escapeSlackText(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
/** Verify exact raw UTF-8 body before parsing JSON. */
export function verifySlackSignature(secret: string, body: string, timestamp: string | null, signature: string | null, now = new Date()) {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
export function normaliseSlackText(raw: string) {
  return raw
    .replace(/<!(?:channel|here|everyone)(?:\|[^>]+)?>/g, "")
    .replace(/<!subteam\^[^>|]+(?:\|[^>]+)?>/g, "the team")
    .replace(/<!date\^[^>|]+\|([^>]+)>/g, "$1")
    .replace(/<@[^>|]+(?:\|([^>]+))?>/g, (_all, label: string | undefined) => label ?? "a teammate")
    .replace(/<#[^>|]+(?:\|([^>]+))?>/g, (_all, label: string | undefined) => label ? `#${label}` : "a channel")
    .replace(/<mailto:([^>|]+)(?:\|([^>]+))?>/g, (_all, email: string, label: string | undefined) => label && label !== email ? `${label} (${email})` : email)
    .replace(/<(https?:\/\/[^>|]+)(?:\|([^>]+))?>/g, (_all, url: string, label: string | undefined) => label ? `${label} (${url})` : url)
    .replace(/```(?:[^\n]*\n)?([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[\s(])([*_~])([^\n]+?)\2(?=$|[\s).,!?:;])/g, "$1$3")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\r\n?/g, "\n").trim();
}
