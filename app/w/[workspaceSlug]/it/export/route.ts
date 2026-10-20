import { requireWorkspace } from "@/lib/permissions";
import { exportTools } from "@/lib/marketingIt/export";
import type { Kind } from "@/lib/marketingIt/schema";
export async function GET(request: Request, { params }: RouteContext<"/w/[workspaceSlug]/it/export">) {
 const { workspaceSlug } = await params;
 const actor = await requireWorkspace(workspaceSlug, "MEMBER");
 const query = new URL(request.url).searchParams;
 const kind = (query.get("tool") ?? "DEVICE") as Kind;
 if (!["DEVICE", "LICENCE", "INCIDENT", "REVIEW", "RESTORE"].includes(kind)) return new Response("Not found", { status: 404 });
 try {
  const body = await exportTools(actor, kind, Object.fromEntries(query));
  return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="space-works-${kind.toLowerCase()}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
 } catch { return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } }); }
}
