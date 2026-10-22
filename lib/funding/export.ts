import "server-only";
import { prisma } from "@/lib/db";
import { assertActor, audit, recordsWhere, type Actor, type Filters } from "./service";
import { csv, type Section } from "./schema";
import { object } from "./analytics";
export async function exportFunding(actor: Actor, section: Section, filters: Filters, filing = false) {
  await assertActor(actor);
  const where = recordsWhere(actor, section, filters);
  if (filing) { where.kind = "DONATION"; where.status = "RECEIVED"; }
  const rows = await prisma.fundingRecord.findMany({ where, orderBy: [{ dateOn: "asc" }, { id: "asc" }], take: 10001 });
  if (rows.length > 10000) return null;
  const contacts = await prisma.contact.findMany({ where: { workspaceId: actor.workspace.id, id: { in: rows.flatMap(r => r.contactId ? [r.contactId] : []) }, deletedAt: null }, select: { id: true, displayName: true } });
  const profiles = filing ? await prisma.fundingRecord.findMany({ where: { workspaceId: actor.workspace.id, kind: "DONOR", archivedAt: null }, select: { contactId: true, details: true } }) : [];
  const output = filing ? csv([
    ["Donor name", "PAN", "Address", "Donation date", "Amount minor units", "Currency", "Mode", "Donation type", "Foreign source", "Receipt number", "Receipt issued", "In-kind item"],
    ...rows.map(row => { const d = object(row.details); const profile = object(profiles.find(p => p.contactId === row.contactId)?.details); return [contacts.find(c => c.id === row.contactId)?.displayName ?? "Former contact", d.pan || profile.pan, d.donorAddress || profile.address, row.dateOn?.toISOString().slice(0, 10), row.amountMinor, row.currency, d.mode, d.donationType, d.foreignSource ? "Yes" : "No", row.receiptNumber || d.receiptNumber, row.receiptFileId || d.receiptIssued ? "Yes" : "No", d.inKindItem]; }),
  ]) : csv([
    ["ID", "Type", "Name", "Status", "Owner ID", "Contact ID", "Organisation ID", "Parent ID", "Fund ID", "Date", "Due", "End", "Amount minor units", "Currency", "Thanked at", "Thanked by", "Signed at", "Signed by", "Receipt number", "Details", "Notes"],
    ...rows.map(row => [row.id, row.kind, row.title, row.status, row.ownerId, row.contactId, row.organisationId, row.parentId, row.fundId, row.dateOn?.toISOString().slice(0, 10), row.dueOn?.toISOString().slice(0, 10), row.endsOn?.toISOString().slice(0, 10), row.amountMinor, row.currency, row.thankedAt?.toISOString(), row.thankedById, row.signedAt?.toISOString(), row.signedById, row.receiptNumber, JSON.stringify(row.details), row.notes]),
  ]);
  await audit(actor, prisma, { id: section }, filing ? "donations_filing_exported" : "csv_exported");
  return output;
}
