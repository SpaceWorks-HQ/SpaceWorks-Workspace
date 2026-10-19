import { handlePing } from "@/lib/monitor/heartbeatService";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function ping(request: Request, context: RouteContext<"/api/hb/[token]/[[...action]]">) {
  const { token, action } = await context.params;
  if (action && action.length !== 1) return new Response("Not found", { status: 404 });
  let body: string | undefined;
  if (request.method === "POST" && request.body) {
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try { while (size < 10240) { const next = await reader.read(); if (next.done) break; const chunk = next.value.subarray(0, 10240 - size); chunks.push(chunk); size += chunk.length; } } finally { await reader.cancel(); }
    body = Buffer.concat(chunks).toString("utf8");
  }
  const result = await handlePing({ token, action: action?.[0], body, runId: new URL(request.url).searchParams.get("rid") });
  return new Response(request.method === "HEAD" ? null : result.body, { status: result.status, headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
export const GET = ping;
export const POST = ping;
export const HEAD = ping;
