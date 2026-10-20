import { routeActor, notFoundResponse } from "@/lib/files/request";
import { canViewGovernance } from "@/lib/roles";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { prisma } from "@/lib/db";
import {
  assertActor,
  recordsWhere,
  type Filters,
} from "@/lib/governance/service";
import { csvCell, LABELS, type Section } from "@/lib/governance/schemas";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(
  request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/governance/export">,
) {
  const { workspaceSlug } = await params;
  const actor = await routeActor(workspaceSlug);
  if (!actor || !canViewGovernance(actor.membership)) return notFoundResponse();
  if (await isActionRateLimited("apiRead", actor.user.id))
    return new Response("Wait a minute and try again.", { status: 429 });
  await assertActor(actor);
  const url = new URL(request.url);
  const section = url.searchParams.get("section");
  if (!["compliance", "board", "vendors"].includes(section ?? ""))
    return new Response("Choose a governance tool.", { status: 400 });
  const filter: Filters = Object.fromEntries(url.searchParams);
  const where = recordsWhere(
    actor.workspace.id,
    section as Section,
    actor.workspace.timezone,
    filter,
  );
  const rows = await prisma.governanceRecord.findMany({
    where,
    orderBy: { id: "asc" },
    include: {
      attachments: {
        where: { file: { deletedAt: null } },
        select: { fileId: true },
      },
    },
    take: 10001,
  });
  if (rows.length > 10000)
    return new Response(
      "Narrow your filters to export at most 10,000 records.",
      { status: 400 },
    );
  const headings = [
    "ID",
    "Type",
    "Name",
    "Status",
    "Owner ID",
    "Committee ID",
    "Organisation ID",
    "Meeting ID",
    "Resolution number",
    "Due date",
    "Start date",
    "End date",
    "Reminder days",
    "Notes",
    "Details (no banking)",
    "Proof file IDs",
  ];
  const csv = [
    headings,
    ...rows.map((r) => [
      r.id,
      LABELS[r.kind],
      r.title,
      r.status,
      r.ownerId,
      r.parentId,
      r.organisationId,
      r.meetingId,
      r.number,
      r.dueOn?.toISOString().slice(0, 10),
      r.startsOn?.toISOString().slice(0, 10),
      r.endsOn?.toISOString().slice(0, 10),
      r.reminderDays,
      r.notes,
      JSON.stringify(r.details),
      r.attachments.map((a) => a.fileId).join("; "),
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: "governance.exported",
    metadata: { count: rows.length },
  });
  return new Response("\ufeff" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="governance-${section}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
