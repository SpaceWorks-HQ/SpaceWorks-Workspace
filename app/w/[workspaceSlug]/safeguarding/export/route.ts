import { routeActor, notFoundResponse } from "@/lib/files/request";
import { loadCases, liveCaseMember } from "@/lib/govextras/cases";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { csvCell } from "@/lib/governance/schemas";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(
  request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/safeguarding/export">,
) {
  const { workspaceSlug } = await params,
    actor = await routeActor(workspaceSlug);
  if (!actor) return notFoundResponse();
  if (await isActionRateLimited("apiRead", actor.user.id))
    return new Response("Wait a minute and try again.", { status: 429 });
  const filter = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const first = await loadCases(actor, { ...filter, page: "1" });
    if (!first.appointed) return notFoundResponse();
    if (first.total > 1000)
      return new Response("Narrow your filters to at most 1,000 cases.", {
        status: 400,
      });
    const rows = [...first.rows];
    for (let page = 2; rows.length < first.total; page++) {
      const next = await loadCases(actor, { ...filter, page: String(page) });
      if (!next.rows.length) break;
      rows.push(...next.rows);
    }
    const csv = [
      ["ID", "Case number", "Kind", "Status", "Received", "Due", "Handler IDs"],
      ...rows.map((r) => [
        r.id,
        r.number,
        r.kind,
        r.status,
        r.receivedOn.toISOString().slice(0, 10),
        r.dueOn.toISOString().slice(0, 10),
        r.handlerIds.join("; "),
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
    await liveCaseMember(actor);
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "safeguarding.exported",
      metadata: { count: rows.length },
    });
    return new Response("\ufeff" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=case-register.csv",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return notFoundResponse();
  }
}
