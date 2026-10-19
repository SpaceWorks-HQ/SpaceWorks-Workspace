import { publicSummary, publicHeaders, publicRateAllowed, statusBadge } from "@/lib/monitor/public";
import { formatUptime } from "@/lib/monitor/stats";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext<"/status/[workspaceSlug]/badge/[componentKey]">) {
  if (!await publicRateAllowed(request.headers)) return new Response("Too many requests", { status: 429 });
  const { workspaceSlug, componentKey } = await context.params;
  const summary = await publicSummary(workspaceSlug);
  const component = summary?.components.find(c => c.key === componentKey.replace(/\.svg$/, ""));
  if (!component) return new Response("Not found", { status: 404 });
  const type = new URL(request.url).searchParams.get("type");
  const value = type === "uptime" ? formatUptime(component.uptime) : type === "latency" ? component.latencyP95 === null ? "No data" : `${component.latencyP95} ms` : component.status.toLowerCase();
  return new Response(statusBadge(component.displayName, value, component.status), { headers: { ...publicHeaders, "Content-Type": "image/svg+xml; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", ...(summary?.noindex ? { "X-Robots-Tag": "noindex" } : {}) } });
}
