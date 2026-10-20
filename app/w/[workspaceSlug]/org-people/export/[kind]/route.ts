import { requireWorkspace } from "@/lib/permissions";
import { orgExport } from "@/lib/orgPeople/export";
import { OperationsError } from "@/lib/opsGaps/context";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { dayKey } from "@/lib/community/schedule";
export async function GET(request: Request, { params }: { params: Promise<{ workspaceSlug: string; kind: string }> }) {
  const { workspaceSlug, kind } = await params;
  const actor = await requireWorkspace(workspaceSlug, "MEMBER");
  if (kind !== "attendance" && kind !== "responsibilities" && kind !== "organisation" && kind !== "escalation") return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("apiRead", actor.user.id)) return new Response("Try again shortly.", { status: 429 });
  const q = new URL(request.url).searchParams;
  try { return await orgExport(actor, kind, { month: q.get("month") ?? dayKey(new Date(), actor.workspace.timezone).slice(0, 7), userId: q.get("userId") || undefined, teamId: q.get("teamId") || undefined }); }
  catch (error) { if (error instanceof OperationsError) return new Response("This export is unavailable. Check your filters and try again.", { status: 404 }); throw error; }
}
