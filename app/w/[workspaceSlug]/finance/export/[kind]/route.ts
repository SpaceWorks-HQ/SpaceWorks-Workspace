import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  financeCsv,
  EXPORT_KINDS,
  type ExportKind,
} from "@/lib/finance/tools/export";
import { FinanceError } from "@/lib/finance/tools/access";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(
  request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/finance/export/[kind]">,
) {
  const { workspaceSlug, kind } = await params;
  const actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!actor || !(EXPORT_KINDS as readonly string[]).includes(kind))
    return new Response("Not found", { status: 404, headers });
  if (await isActionRateLimited("apiRead", `finance-export:${actor.user.id}`))
    return new Response("Try again in a minute.", { status: 429, headers });
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const csv = await financeCsv(actor, kind as ExportKind, query);
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "finance.export_downloaded",
      targetType: kind,
    });
    return new Response(`\uFEFF${csv}`, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="finance-${kind}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof FinanceError)
      return new Response(e.message, {
        status: /access/.test(e.message) ? 404 : 400,
        headers,
      });
    throw e;
  }
}
