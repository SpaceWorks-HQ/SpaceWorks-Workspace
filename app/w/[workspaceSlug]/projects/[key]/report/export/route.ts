import { auth } from "@/lib/auth";
import { findWorkspaceForUser } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { getProjectPlan, projectReportCsv } from "@/lib/projects/plusQueries";
export async function GET(_request: Request, { params }: RouteContext<"/w/[workspaceSlug]/projects/[key]/report/export">) {
  const { workspaceSlug, key } = await params;
  const session = await auth();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });
  const context = await findWorkspaceForUser(workspaceSlug, session.user.id);
  if (!context) return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("action", session.user.id)) return new Response("Try again shortly.", { status: 429 });
  const plan = await getProjectPlan({ ...context, user: { id: session.user.id, name: session.user.name ?? null } }, key);
  if (!plan) return new Response("Not found", { status: 404 });
  return new Response(projectReportCsv(plan), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="project-${plan.key.replace(/[^A-Z0-9_-]/gi, "")}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
