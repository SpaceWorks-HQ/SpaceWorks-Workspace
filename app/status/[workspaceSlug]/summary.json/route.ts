import { publicSummary, publicHeaders, publicRateAllowed } from "@/lib/monitor/public";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext<"/status/[workspaceSlug]/summary.json">) {
  if (!await publicRateAllowed(request.headers)) return new Response("Too many requests", { status: 429 });
  const { workspaceSlug } = await context.params;
  const summary = await publicSummary(workspaceSlug);
  return summary ? Response.json(summary, { headers: { ...publicHeaders, ...(summary.noindex ? { "X-Robots-Tag": "noindex" } : {}) } }) : new Response("Not found", { status: 404 });
}
