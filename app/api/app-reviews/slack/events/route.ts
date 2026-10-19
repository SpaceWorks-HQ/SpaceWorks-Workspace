import { receiveSlackEvent } from "@/lib/appReviews/slack";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const slug = new URL(request.url).searchParams.get("workspace");
  if (!slug || slug.length > 64) return Response.json({ error: "Request not verified." }, { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 128_000) return Response.json({ error: "Request too large." }, { status: 413 });
  const reader = request.body?.getReader(); if (!reader) return Response.json({ error: "Invalid request." }, { status: 400 });
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 128_000) { await reader.cancel(); return Response.json({ error: "Request too large." }, { status: 413 }); } chunks.push(part.value); }
  try { return await receiveSlackEvent(slug, Buffer.concat(chunks).toString("utf8"), request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature")); }
  catch { return Response.json({ error: "Couldn't accept the event. Try again." }, { status: 503 }); }
}
