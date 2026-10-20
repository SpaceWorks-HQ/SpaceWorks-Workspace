import "server-only";
import { prisma } from "@/lib/db";
import { currentActor, listWhere, hydrateDevice, canRead, ensure, type Actor, type Filters } from "./service";
import { canManageItAdministration } from "@/lib/roles";
import { csv, object, type Kind } from "./schema";
import { FIELDS } from "./fields";
/** Same live access as the list; formula cells are neutralised and secret values never selected. */
export async function exportTools(supplied: Actor, kind: Kind, filters: Filters) {
 const actor = await currentActor(supplied);
 ensure(!["PROPOSAL", "REVIEW", "RESTORE"].includes(kind) || canManageItAdministration(actor.membership));
 const rows = await prisma.marketingItRecord.findMany({ where: await listWhere(actor, kind, filters), orderBy: { id: "asc" }, take: 10001 });
 ensure(rows.length <= 10000, "This export has more than 10,000 records. Narrow your filters.");
 const hydrated = await Promise.all(rows.map(r => hydrateDevice(r)));
 const readable = hydrated.filter(r => canRead(actor, r));
 if (kind === "REVIEW") {
  const items = await prisma.marketingItReviewItem.findMany({ where: { workspaceId: actor.workspace.id, recordId: { in: readable.map(r => r.id) } }, orderBy: [{ recordId: "asc" }, { userId: "asc" }] });
  ensure((await currentActor(supplied)).membership.role === actor.membership.role, "Your access changed. Refresh and try again.");
  return csv([["Review", "Status", "Due", "Completed at", "Completed by", "Member", "Source", "Resource", "Decision", "Note", "Reviewed by", "Reviewed at"], ...items.map(i => { const r = readable.find(r => r.id === i.recordId)!; return [r.title, r.status, r.dueOn?.toISOString().slice(0, 10), r.completedAt?.toISOString(), r.completedById, i.userId, i.sourceType, i.label, i.decision, i.note, i.reviewedById, i.reviewedAt?.toISOString()]; })]);
 }
 ensure((await currentActor(supplied)).membership.role === actor.membership.role, "Your access changed. Refresh and try again.");
 return csv([["Title", "Status", "Owner", "Date", "Due", "Notes", ...FIELDS[kind].map(f => f.type === "money" ? `${f.label} (minor units)` : f.label), ...(kind === "LICENCE" ? ["Assigned people"] : [])], ...readable.map(r => [r.title, r.status, r.ownerId, r.dateOn?.toISOString().slice(0, 10), r.dueOn?.toISOString().slice(0, 10), r.notes, ...FIELDS[kind].map(f => object(r.details)[f.key]), ...(kind === "LICENCE" ? [(object(r.details).assigneeIds as string[]).join("; ")] : [])])]);
}
