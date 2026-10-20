import "server-only";
import { prisma, type Tx } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { createFundingPdf } from "@/lib/funding/pdf";
import { formatMoney, currencyMinorDigits } from "@/lib/format/money";
import { formatDate } from "@/lib/format/datetime";
import { currentActor, findRecord, lock, ensure, type Actor } from "./access";
import { audit, recordsWhere, type Filters } from "./service";
import { csv, detailSchemas, object, human, SECTION_KINDS, type Section } from "./schema";
import { estimateTotals } from "./costs";
async function savedEstimate(actor: Actor, recordId: string, version?: number, tx: Tx = prisma) {
 const record = await findRecord(actor, recordId, tx); ensure(record.kind === "ESTIMATE");
 const revision = await tx.productEstimateRevision.findFirst({ where: { workspaceId: actor.workspace.id, recordId, version: version ?? record.revision } }); ensure(revision, "That estimate revision is unavailable.");
 const snapshot = object(revision.snapshot), details = detailSchemas.ESTIMATE.parse(snapshot.details);
 return { record, revision, snapshot, details, totals: estimateTotals(details), currency: String(snapshot.currency), title: String(snapshot.title) };
}
export async function exportEstimate(untrusted: Actor, recordId: string, version?: number) {
 const actor = await currentActor(untrusted), estimate = await savedEstimate(actor, recordId, version), { totals, currency } = estimate;
 const major = (value: number) => (value / 10 ** currencyMinorDigits(currency)).toFixed(currencyMinorDigits(currency));
 await prisma.$transaction(tx => audit(actor, tx, recordId, "estimate_exported"));
 return csv([["Estimate", estimate.title, "Revision", estimate.revision.version, "Currency", currency], ["Item", "Specification", "Category", "Quantity", "Unit", "Unit cost", "Supplier", "Quote link", "Quote file", "GST %", "Subtotal", "Tax", "Total"], ...totals.lines.map(l => [l.item, l.specification, human(l.category), l.quantityMilli / 1000, l.unit, major(l.unitCostMinor), l.supplier, l.quoteUrl, l.quoteFileId ? `/api/files/${l.quoteFileId}` : "", l.gstBps / 100, major(l.baseMinor), major(l.taxMinor), major(l.totalMinor)]), [], ["Category", "Subtotal", "Tax"], ...totals.categories.map(c => [human(c.category), major(c.baseMinor), major(c.taxMinor)]), ["Subtotal", major(totals.baseMinor)], ["GST / tax", major(totals.taxMinor)], [`Contingency ${estimate.details.contingencyBps / 100}% on subtotal plus tax`, major(totals.contingencyMinor)], ["Grand total", major(totals.totalMinor)], ["Revision note", estimate.details.revisionNote], ["Notes", String(estimate.snapshot.notes ?? "")]]);
}
export async function exportProductOps(untrusted: Actor, section: Section, filters: Filters) {
 const actor = await currentActor(untrusted);
 if (section === "ownership") {
  const { loadProductOps } = await import("./load"); const data = await loadProductOps(actor, section, filters);
  const name = (id: string | null) => data.people.find(p => p.user.id === id)?.user.name ?? (id ? "Former member" : "Unassigned");
  return csv([["System or service", "Kind", "Environment", "Owner", "Backup"], ...data.services.map(s => [s.name, human(s.kind), human(s.environment), name(s.ownerId), name(s.backupOwnerId)])]);
 }
 const records = await prisma.productRecord.findMany({ where: await recordsWhere(actor, SECTION_KINDS[section], filters), orderBy: { createdAt: "desc" }, take: 10001 });
 ensure(records.length <= 10000, "Use filters to export up to 10,000 records.");
 await prisma.$transaction(tx => audit(actor, tx, "export", "exported"));
 return csv([["Title", "Tool", "Status", "Owner", "Due date", "Date", "Project", "Release", "Notes", "Details"], ...records.map(r => [r.title, human(r.kind), human(r.status), r.ownerId, r.dueOn?.toISOString().slice(0, 10), r.dateOn?.toISOString().slice(0, 10), r.projectId, r.releaseId, r.notes, JSON.stringify(r.details)])]);
}
export async function generateEstimatePdf(untrusted: Actor, recordId: string, version?: number) {
 let storageKey: string | undefined;
 try {
  return await prisma.$transaction(async tx => {
   const actor = await lock(untrusted, tx), workspaceId = actor.workspace.id;
   const estimate = await savedEstimate(actor, recordId, version, tx), { totals, currency } = estimate;
   const existing = await tx.productAttachment.findFirst({ where: { workspaceId, recordId, generated: true, version: estimate.revision.version, file: { deletedAt: null } } });
   if (existing) return { id: recordId, fileId: existing.fileId };
   const workspace = await tx.workspace.findFirstOrThrow({ where: { id: workspaceId }, select: { name: true } });
   const money = (value: number) => `${currency} ${formatMoney(value, currency).replace(/[^0-9.,-]/g, "")}`;
   const paragraphs = [workspace.name, `Revision ${estimate.revision.version} · ${formatDate(estimate.revision.createdAt, actor.workspace.timezone)} · ${currency}`, "Funding proposal budget estimate", "Estimated quantities and manually supplied prices. Tax is rounded per line. Contingency applies to subtotal plus tax.", estimate.details.revisionNote];
   totals.lines.forEach((line, index) => paragraphs.push(`${index + 1}. ${line.item} · ${human(line.category)}\n${line.specification}\n${line.quantityMilli / 1000} ${line.unit} × ${money(line.unitCostMinor)} = ${money(line.baseMinor)}\nGST / tax ${line.gstBps / 100}%: ${money(line.taxMinor)} · Line total: ${money(line.totalMinor)}\nSupplier: ${line.supplier || "Not recorded"}${line.quoteUrl ? `\nQuote: ${line.quoteUrl}` : ""}${line.quoteFileId ? "\nSupporting quote attached to the saved estimate." : ""}`));
   paragraphs.push(...totals.categories.map(c => `Category subtotal - ${human(c.category)}: ${money(c.baseMinor)} + ${money(c.taxMinor)} tax`), `Subtotal: ${money(totals.baseMinor)}\nGST / tax: ${money(totals.taxMinor)}\nContingency ${estimate.details.contingencyBps / 100}%: ${money(totals.contingencyMinor)}\nTotal requested: ${money(totals.totalMinor)}`, String(estimate.snapshot.notes ?? ""));
   const body = await createFundingPdf(`${estimate.title} · Budget sheet`, paragraphs);
   const uploaded = await uploadWorkspaceFile({ workspaceId, uploadedById: actor.user.id, folder: "/product-ops", file: new File([new Uint8Array(body)], `budget-revision-${estimate.revision.version}.pdf`, { type: "application/pdf" }), client: tx });
   ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey;
   await tx.productAttachment.create({ data: { workspaceId, recordId, fileId: uploaded.file.id, generated: true, version: estimate.revision.version } });
   await audit(actor, tx, recordId, "budget_pdf_generated"); return { id: recordId, fileId: uploaded.file.id };
  }, { timeout: 30000 });
 } catch (error) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw error; }
}
