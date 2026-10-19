import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { buildFeed, resolveFeedToken } from "@/lib/community/feeds";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * Private calendar subscription feed (Google Calendar, Apple Calendar, …).
 * The bearer token in the path is the only credential: unknown, revoked or
 * no-longer-member tokens all answer the same 404. `/ics/<token>.ics` and
 * `/ics/<token>` both work.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/ics/[token]">) {
  if (!(await checkRateLimit(request, "apiRead"))) {
    return new Response("Too many requests. Try again later.", { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  }
  const { token } = await ctx.params;
  const raw = token.endsWith(".ics") ? token.slice(0, -4) : token;
  const feed = await resolveFeedToken(raw);
  if (!feed) return notFound();
  const body = await buildFeed(feed);
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  });
}
