import { safeEqual, sha256Hex } from "@/lib/crypto";
import { receiveMetaWebhook, verifyMetaSignature } from "@/lib/social/webhook";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams; const expected = process.env.SOCIAL_META_WEBHOOK_VERIFY_TOKEN;
  if (!expected || p.get("hub.mode") !== "subscribe" || !safeEqual(sha256Hex(p.get("hub.verify_token") ?? ""), sha256Hex(expected))) return new Response("Not found", { status: 404 });
  return new Response((p.get("hub.challenge") ?? "").slice(0, 1000), { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const secret = process.env.SOCIAL_META_CLIENT_SECRET; if (!secret) return new Response("Not configured", { status: 503 });
  if (Number(request.headers.get("content-length")) > 1048576) return new Response("Too large", { status: 413 });
  const reader = request.body?.getReader(); if (!reader) return new Response("Bad request", { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1048576) { await reader.cancel(); return new Response("Too large", { status: 413 }); } chunks.push(value); }
  const body = Buffer.concat(chunks); if (!verifyMetaSignature(body, request.headers.get("x-hub-signature-256"), secret)) return new Response("Invalid signature", { status: 401 });
  let data: unknown; try { data = JSON.parse(body.toString("utf8")); } catch { return new Response("Bad request", { status: 400 }); }
  await receiveMetaWebhook(data); return Response.json({ received: true });
}
