import { publicSummary, publicHeaders, publicRateAllowed, escapeXml } from "@/lib/monitor/public";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext<"/status/[workspaceSlug]/feed.rss">) {
  if (!await publicRateAllowed(request.headers)) return new Response("Too many requests", { status: 429 });
  const { workspaceSlug } = await context.params, summary = await publicSummary(workspaceSlug);
  if (!summary) return new Response("Not found", { status: 404 });
  const url = new URL(`/status/${workspaceSlug}`, process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3200").toString();
  const items = summary.incidents.map(i => `<item><title>${escapeXml(i.title)}</title><guid isPermaLink="false">${escapeXml(`${workspaceSlug}:${i.number}`)}</guid><pubDate>${new Date(i.startedAt).toUTCString()}</pubDate><description>${escapeXml(i.updates.at(-1)?.body ?? i.status)}</description></item>`).join("");
  return new Response(`<?xml version="1.0"?><rss version="2.0"><channel><title>${escapeXml(summary.title)}</title><link>${escapeXml(url)}</link><description>Service incidents</description>${items}</channel></rss>`, { headers: { ...publicHeaders, "Content-Type": "application/rss+xml; charset=utf-8" } });
}
