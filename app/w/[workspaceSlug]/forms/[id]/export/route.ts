import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { exportCsv } from "@/lib/forms/service";
export async function GET(_request: Request, { params }: RouteContext<"/w/[workspaceSlug]/forms/[id]/export">) {
 const { workspaceSlug, id } = await params;
 const a = await getWorkspaceForAction(workspaceSlug, "ADMIN");
 if (!a) return new Response(null, { status: 404 });
 if (await isActionRateLimited("dataExport", a.user.id)) return new Response("Try again later.", { status: 429 });
 try { return new Response(await exportCsv(a, id), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="form-responses.csv"', "Cache-Control": "no-store, private" } }); } catch { return new Response(null, { status: 404 }); }
}
