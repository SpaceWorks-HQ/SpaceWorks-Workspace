import { auth } from "@/lib/auth";
import { findWorkspaceForUser } from "@/lib/permissions";
import { canViewFunding } from "@/lib/roles";
import { exportFunding } from "@/lib/funding/export";
import { SECTIONS, type Section } from "@/lib/funding/schema";
import { isActionRateLimited } from "@/lib/actionRateLimit";
export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/funding/[section]/export">) {
  const { workspaceSlug, section } = await params;
  const session = await auth();
  if (!session?.user?.id || !SECTIONS.includes(section as Section)) return new Response("Not found", { status: 404 });
  const context = await findWorkspaceForUser(workspaceSlug, session.user.id);
  if (!context || !canViewFunding(context.membership)) return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("action", session.user.id)) return new Response("Try again shortly.", { status: 429 });
  const query = new URL(request.url).searchParams;
  const actor = { ...context, user: { id: session.user.id } };
  const body = await exportFunding(actor, section as Section, Object.fromEntries(query), section === "donations" && query.get("format") === "10bd");
  if (body === null) return new Response("More than 10,000 records match. Narrow the filters and try again.", { status: 422 });
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="funding-${section}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
