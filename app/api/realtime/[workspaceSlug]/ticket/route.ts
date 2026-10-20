import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findWorkspaceForUser } from "@/lib/permissions";
import { checkRateLimitById } from "@/lib/rateLimit";
import { issueRealtimeTicket } from "@/lib/frontend/realtimeTicket";
export const dynamic = "force-dynamic";
export async function POST(request: Request, ctx: RouteContext<"/api/realtime/[workspaceSlug]/ticket">) {
  const denied = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!process.env.FRONTEND_GATEWAY_SECRET || request.headers.get("origin") !== process.env.NEXT_PUBLIC_BASE_URL) return denied();
  const { workspaceSlug } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) return denied();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { disabledAt: true, sessionVersion: true } });
  if (!user || user.disabledAt || !await findWorkspaceForUser(workspaceSlug, session.user.id)) return denied();
  if (!await checkRateLimitById("realtime", `ticket:${session.user.id}`)) return new Response("Too many requests", { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "30" } });
  try {
    return Response.json({ token: await issueRealtimeTicket(workspaceSlug, session.user.id, user.sessionVersion) }, { headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
