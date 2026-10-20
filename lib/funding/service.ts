import "server-only";
import { Prisma, type FundingRecord, type WorkspaceRole } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { canManageFunding } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { recordSchema, detailSchemas, operationSchema, quarterEnd, sectionFor, SECTION_KINDS, dayInZone, type Kind, type Section } from "./schema";
import { donationSummary, pledgeDue } from "./analytics";
import { uploadWorkspaceFile, deleteObjects, RASTER_IMAGE_TYPES, maxUploadBytes } from "@/lib/storage";

export type Actor = { user: { id: string }; workspace: { id: string; slug: string; timezone: string }; membership: { role: WorkspaceRole } };
export class FundingError extends Error {}
export const ensure: (value: unknown, message?: string) => asserts value = (value, message = "That record is unavailable. Refresh and try again.") => { if (!value) throw new FundingError(message); };
export async function assertActor(actor: Actor, tx: Tx = prisma) {
  const member = await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id, status: "ACTIVE", user: { disabledAt: null }, workspace: { archivedAt: null } }, select: { role: true } });
  ensure(member && canManageFunding(member), "You don't have access to do that.");
}
export async function lock(actor: Actor, tx: Tx) { await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR UPDATE`; await assertActor(actor, tx); }
export async function audit(actor: Actor, tx: Tx, record: { id: string }, verb: string) { await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `funding.${verb}`, targetType: "FundingRecord", targetId: record.id, client: tx }); }
export async function sync(actor: Actor, tx: Tx, row: FundingRecord, verb: string) {
  await audit(actor, tx, row, verb);
  if (row.archivedAt) await removeSearchDocument("funding", row.id, tx);
  else await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: "funding", entityId: row.id, title: row.title, url: `/w/${actor.workspace.slug}/funding/${sectionFor(row.kind)}?edit=${row.id}`, visibility: "PRIVATE", ownerId: row.ownerId ?? actor.user.id }, tx);
  await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, entityType: "funding", entityId: row.id, verb, summary: `Funding record ${verb}.`, visibility: "PRIVATE" }, tx);
}
async function linked(tx: Tx, workspaceId: string, id: string, kind: Kind | Kind[]) {
  return tx.fundingRecord.findFirst({ where: { workspaceId, id, archivedAt: null, kind: { in: Array.isArray(kind) ? kind : [kind] } } });
}
const PARENTS: Partial<Record<Kind, Kind>> = { INSTALMENT: "GRANT", REPORT: "GRANT", DELIVERABLE: "GRANT", KPI: "PROGRAMME", IMPACT_ENTRY: "KPI", ACCESS_REVIEW: "TOOL_ACCOUNT" };
export async function saveRecord(actor: Actor, raw: unknown) {
  const input = recordSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await lock(actor, tx);
    const workspaceId = actor.workspace.id;
    const old = input.id ? await tx.fundingRecord.findFirst({ where: { workspaceId, id: input.id, archivedAt: null } }) : null;
    if (input.id) ensure(old);
    ensure(!old || old.kind === input.kind);
    ensure(!old?.signedAt, "Signed reviews are locked. Add a review for the next quarter.");
    ensure(!old?.receiptFileId, "Issued receipts are locked. Void the gift and log a corrected donation.");
    ensure(input.kind !== "ACCESS_REVIEW" || input.status !== "SIGNED", "Use Sign off after reviewing the saved checklist.");
    if (input.ownerId) ensure(await tx.membership.findFirst({ where: { workspaceId, userId: input.ownerId, status: "ACTIVE", role: { in: ["ADMIN", "OWNER"] }, user: { disabledAt: null } } }), "Choose an active admin as owner.");
    if (input.fundId) ensure(await tx.financeFund.findFirst({ where: { workspaceId, id: input.fundId, archivedAt: null, currency: input.currency } }), "Choose a current finance fund with the same currency.");
    if (input.contactId) ensure(await tx.contact.findFirst({ where: { workspaceId, id: input.contactId, deletedAt: null } }), "Choose a contact in this workspace.");
    if (input.organisationId) ensure(await tx.organisation.findFirst({ where: { workspaceId, id: input.organisationId, deletedAt: null } }), "Choose an organisation in this workspace.");
    const expectedParent = PARENTS[input.kind];
    ensure(!input.parentId || expectedParent, "This tool doesn't use a parent record.");
    const parent = input.parentId && expectedParent ? await linked(tx, workspaceId, input.parentId, expectedParent) : null;
    if (expectedParent) ensure(parent, "Choose the linked record in this workspace.");
    if (input.kind === "INSTALMENT") ensure(parent?.currency === input.currency, "Use the grant's currency for its instalments.");
    const details = detailSchemas[input.kind].parse(input.details) as Prisma.InputJsonObject;
    for (const [field, kind] of Object.entries({ grantId: "GRANT", programmeId: "PROGRAMME", opportunityId: "OPPORTUNITY", campaignId: "CAMPAIGN", pledgeId: "PLEDGE", donationId: "DONATION" } as const)) {
      const value = details[field];
      if (typeof value !== "string" || !value) continue;
      const target = await linked(tx, workspaceId, value, kind);
      ensure(target && target.id !== old?.id, "Choose linked records in this workspace.");
      if (field === "pledgeId") ensure(target.contactId === input.contactId && target.currency === input.currency, "The pledge must match this donor and currency.");
      if (field === "campaignId" && input.kind === "DONATION") ensure(target.currency === input.currency, "Use the campaign's currency for tagged donations.");
    }
    if (input.kind === "TOOL_ACCOUNT") {
      ensure(await tx.membership.findFirst({ where: { workspaceId, userId: String(details.userId) } }), "Choose a person in this workspace.");
      if (details.serviceId) ensure(await tx.serviceCatalogItem.findFirst({ where: { workspaceId, id: String(details.serviceId) } }), "Choose a catalogue item in this workspace.");
      if (details.subscriptionId) ensure(await tx.subscription.findFirst({ where: { workspaceId, id: String(details.subscriptionId) } }), "Choose a subscription in this workspace.");
      ensure(details.serviceId || details.subscriptionId, "Link a catalogue item or subscription first.");
    }
    let key: string | null = null;
    if (input.kind === "RECEIPT_SETTINGS") key = "settings";
    if (input.kind === "DONOR") key = input.contactId;
    if (input.kind === "FUNDER") key = input.organisationId;
    if (input.kind === "RUNWAY") key = `${input.dateOn.slice(0, 7)}:${input.currency}`;
    if (input.kind === "ACCESS_REVIEW") key = `${input.parentId}:${details.quarter}`;
    if (input.kind === "RUNWAY") ensure(input.dateOn.endsWith("-01"), "Use the first day of the forecast month.");
    const data = { title: input.title, status: input.status, ownerId: input.ownerId || null, parentId: input.parentId || null, fundId: input.fundId || null, contactId: input.contactId || null, organisationId: input.organisationId || null, dateOn: input.dateOn ? new Date(input.dateOn) : null, dueOn: input.dueOn ? new Date(input.dueOn) : null, endsOn: input.endsOn ? new Date(input.endsOn) : null, amountMinor: input.amountMinor, currency: input.currency, notes: input.notes, reminderDays: input.reminderDays, details, key };
    const row = old ? await tx.fundingRecord.update({ where: { workspaceId_id: { workspaceId, id: old.id } }, data }) : await tx.fundingRecord.create({ data: { ...data, workspaceId, kind: input.kind, createdById: actor.user.id } });
    await sync(actor, tx, row, old ? "updated" : "created");
    return { id: row.id };
  });
}
export async function operate(actor: Actor, raw: unknown) {
  const input = operationSchema.parse(raw);
  if (input.op === "receipt" || input.op === "email") { const { receiptOperation } = await import("./receipts"); return receiptOperation(actor, input.id, input.op); }
  if (input.op === "impactPdf") { const { generateImpactReport } = await import("./reports"); return generateImpactReport(actor, input.id); }
  return prisma.$transaction(async tx => {
    await lock(actor, tx); const workspaceId = actor.workspace.id;
    if (input.op === "quarter") {
      const accounts = await tx.fundingRecord.findMany({ where: { workspaceId, kind: "TOOL_ACCOUNT", archivedAt: null, status: { not: "REMOVED" } }, take: 2001 });
      ensure(accounts.length <= 2000, "Review up to 2,000 accounts at a time.");
      for (const account of accounts) {
        const row = await tx.fundingRecord.upsert({ where: { workspaceId_kind_key: { workspaceId, kind: "ACCESS_REVIEW", key: `${account.id}:${input.quarter}` } }, create: { workspaceId, kind: "ACCESS_REVIEW", key: `${account.id}:${input.quarter}`, parentId: account.id, title: `${account.title} · ${input.quarter}`, status: "TODO", dueOn: new Date(quarterEnd(input.quarter)), ownerId: account.ownerId ?? actor.user.id, createdById: actor.user.id, details: { quarter: input.quarter, decision: "KEEP", reviewNote: "" } }, update: {} });
        await sync(actor, tx, row, "review_added");
      }
      return { id: "" };
    }
    const row = await tx.fundingRecord.findFirst({ where: { workspaceId, id: input.id, archivedAt: input.op === "restore" ? { not: null } : null } }); ensure(row);
    if (input.op === "void") {
      ensure(row.kind === "DONATION" && row.status === "RECEIVED", "Choose a received donation to void.");
      const changed = await tx.fundingRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { status: "VOID" } });
      await sync(actor, tx, changed, "voided"); return { id: row.id };
    }
    if (input.op === "donorPreferences") {
      ensure(row.kind === "DONOR" && row.contactId);
      ensure(await tx.contact.findFirst({ where: { workspaceId, id: row.contactId, deletedAt: null } }));
      await tx.contact.updateMany({ where: { workspaceId, id: row.contactId }, data: { preferredChannel: input.preferredChannel, consentStatus: input.consentStatus, doNotContact: input.doNotContact, consentSource: input.consentSource, consentAt: new Date() } });
      await audit(actor, tx, row, "donor_preferences_updated");
      return { id: row.id };
    }
    if (input.op === "thank") {
      ensure(row.kind === "DONATION" && row.status === "RECEIVED");
      if (!row.thankedAt) { await tx.fundingRecord.updateMany({ where: { workspaceId, id: row.id }, data: { thankedAt: new Date(), thankedById: actor.user.id } }); await audit(actor, tx, row, "thanked"); }
      return { id: row.id };
    }
    if (input.op === "sign") {
      ensure(row.kind === "ACCESS_REVIEW");
      if (!row.signedAt) {
        ensure(row.parentId && await linked(tx, workspaceId, row.parentId, "TOOL_ACCOUNT"));
        const d = detailSchemas.ACCESS_REVIEW.parse(row.details);
        ensure(d.reviewNote, "Add a review note before signing off.");
        const signed = await tx.fundingRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { signedAt: new Date(), signedById: actor.user.id, status: "SIGNED" } });
        await sync(actor, tx, signed, "review_signed");
      }
      return { id: row.id };
    }
    if (input.op === "restore") {
      if (row.parentId) ensure(await linked(tx, workspaceId, row.parentId, Object.values(PARENTS)), "Restore the parent record first.");
    } else {
      ensure(!row.signedAt, "Signed reviews stay in the record.");
      ensure(!await tx.fundingRecord.count({ where: { workspaceId, parentId: row.id, archivedAt: null } }), "Archive the linked child records first.");
    }
    const changed = await tx.fundingRecord.update({ where: { workspaceId_id: { workspaceId, id: row.id } }, data: { archivedAt: input.op === "restore" ? null : new Date() } });
    await sync(actor, tx, changed, input.op === "restore" ? "restored" : "archived");
    return { id: row.id };
  }, { timeout: 20000 });
}
const PROOF_TYPES = new Set([...RASTER_IMAGE_TYPES, "application/pdf"]);
export async function attachFile(actor: Actor, recordId: string, file: File) {
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(async tx => {
      await lock(actor, tx);
      const row = await tx.fundingRecord.findFirst({ where: { workspaceId: actor.workspace.id, id: recordId, archivedAt: null } }); ensure(row && !row.signedAt, "This record is unavailable or locked.");
      ensure(await tx.fundingAttachment.count({ where: { workspaceId: actor.workspace.id, recordId, file: { deletedAt: null } } }) < 20, "This record has 20 files. Remove an unused file first.");
      const uploaded = await uploadWorkspaceFile({ workspaceId: actor.workspace.id, uploadedById: actor.user.id, file, folder: "/funding", allowedTypes: PROOF_TYPES, client: tx });
      ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey;
      await tx.fundingAttachment.create({ data: { workspaceId: actor.workspace.id, recordId, fileId: uploaded.file.id } }); await audit(actor, tx, row, "file_added");
      return { id: uploaded.file.id };
    }, { timeout: 30000 });
  } catch (e) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw e; }
}
export async function detachFile(actor: Actor, recordId: string, fileId: string) {
  await prisma.$transaction(async tx => {
    await lock(actor, tx);
    const row = await tx.fundingRecord.findFirst({ where: { workspaceId: actor.workspace.id, id: recordId, archivedAt: null } }); ensure(row && !row.signedAt && row.receiptFileId !== fileId, "Generated receipts and signed reviews keep their files.");
    ensure(await tx.fundingAttachment.findFirst({ where: { workspaceId: actor.workspace.id, recordId, fileId } }));
    await tx.fileObject.updateMany({ where: { workspaceId: actor.workspace.id, id: fileId }, data: { deletedAt: new Date() } }); await audit(actor, tx, row, "file_removed");
  });
}
export type Filters = { q?: string; kind?: string; status?: string; owner?: string; overdue?: string; archived?: string; page?: string; person?: string; year?: string; contact?: string; segment?: string; major?: string; currency?: string };
export function recordsWhere(actor: Actor, section: Section, filters: Filters): Prisma.FundingRecordWhereInput {
  const kinds = SECTION_KINDS[section]; const kind = kinds.find(k => k === filters.kind);
  return { workspaceId: actor.workspace.id, archivedAt: filters.archived === "1" ? { not: null } : null, kind: kind ?? { in: kinds },
    ...(filters.q ? { title: { contains: filters.q.slice(0, 200), mode: "insensitive" } } : {}), ...(filters.status ? { status: filters.status.slice(0, 30) } : {}), ...(filters.owner ? { ownerId: filters.owner.slice(0, 64) } : {}), ...(filters.contact ? { contactId: filters.contact.slice(0, 64) } : {}),
    ...(filters.person && section === "access" ? { kind: "TOOL_ACCOUNT", details: { path: ["userId"], equals: filters.person.slice(0, 64) } } : {}),
    ...(filters.year && /^20\d{2}$/.test(filters.year) ? section === "tracker" ? { details: { path: ["year"], equals: Number(filters.year) } } : { dateOn: { gte: new Date(`${filters.year}-01-01`), lt: new Date(`${Number(filters.year) + 1}-01-01`) } } : {}),
    ...(filters.overdue === "1" ? { dueOn: { lt: new Date(dayInZone(new Date(), actor.workspace.timezone)) }, status: { in: ["TODO", "EXPECTED", "APPLYING", "SUBMITTED", "RECEIVING", "REPORTING", "IDEA", "AWARDED"] } } : {}),
  };
}
export async function analyticsSnapshot(actor: Actor, now = new Date(), majorMinor = 1000000, majorCurrency = "INR") {
  await assertActor(actor);
  const gifts = await prisma.fundingRecord.findMany({ where: { workspaceId: actor.workspace.id, kind: "DONATION", archivedAt: null }, select: { id: true, contactId: true, dateOn: true, amountMinor: true, currency: true, status: true, details: true, thankedAt: true } });
  return { summary: donationSummary(gifts, now, majorMinor, majorCurrency), gifts };
}
export async function loadFunding(actor: Actor, section: Section, filters: Filters, edit?: string) {
  await assertActor(actor); const workspaceId = actor.workspace.id; const where = recordsWhere(actor, section, filters); const page = Math.max(1, Math.min(10000, Number.parseInt(filters.page ?? "1", 10) || 1));
  const [records, total, selected, people, contacts, organisations, services, subscriptions, funds, choices] = await Promise.all([
    prisma.fundingRecord.findMany({ where, orderBy: [{ dueOn: "asc" }, { createdAt: "desc" }, { id: "asc" }], take: 30, skip: (page - 1) * 30 }), prisma.fundingRecord.count({ where }),
    edit ? prisma.fundingRecord.findFirst({ where: { workspaceId, id: edit.slice(0, 64), kind: { in: SECTION_KINDS[section] } }, include: { attachments: { where: { file: { deletedAt: null } }, select: { file: { select: { id: true, filename: true, contentType: true, size: true } } } }, children: { where: { archivedAt: null }, select: { id: true, title: true, kind: true, status: true, amountMinor: true, currency: true, dateOn: true, dueOn: true, details: true } } } }) : null,
    prisma.membership.findMany({ where: { workspaceId }, select: { user: { select: { id: true, name: true } }, role: true, status: true } }),
    prisma.contact.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, displayName: true, emails: true, preferredChannel: true, consentStatus: true, consentSource: true, doNotContact: true }, orderBy: { displayName: "asc" } }),
    prisma.organisation.findMany({ where: { workspaceId, deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.serviceCatalogItem.findMany({ where: { workspaceId }, select: { id: true, name: true } }), prisma.subscription.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.financeFund.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true, currency: true }, orderBy: { name: "asc" } }),
    prisma.fundingRecord.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, title: true, kind: true, parentId: true, contactId: true, dateOn: true, dueOn: true, endsOn: true, status: true, amountMinor: true, currency: true, details: true, thankedAt: true, ownerId: true } }),
  ]);
  // The same snapshot feeds donor retention and campaign analytics consumers.
  const summary = donationSummary(choices.filter(r => r.kind === "DONATION"), new Date(), Math.max(1, Math.min(2147483647, Number(filters.major) || 1000000)), filters.currency ?? "INR");
  const pledgeDates = choices.filter(r => r.kind === "PLEDGE" && r.status === "ACTIVE").map(p => ({ id: p.id, dueOn: pledgeDue(p, choices.filter(r => r.kind === "DONATION")) }));
  return { records, total, page, selected, people, contacts, organisations, services, subscriptions, funds, choices, summary, pledgeDates, uploadMaxBytes: maxUploadBytes() };
}
export type FundingData = Awaited<ReturnType<typeof loadFunding>>;
