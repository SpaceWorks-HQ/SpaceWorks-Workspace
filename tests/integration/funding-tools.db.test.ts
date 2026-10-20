import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, operate, loadFunding, attachFile, detachFile, analyticsSnapshot, type Actor } from "@/lib/funding/service";
import { exportFunding } from "@/lib/funding/export";
import { run } from "@/lib/scheduled/funding";
import { offboardingSources } from "@/lib/people/onboarding";
import { offboardingItems } from "@/lib/people/checklistItems";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { fundingReceiptAttachment } from "@/lib/funding/email";
import { getObject, deleteObjects } from "@/lib/storage";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "../helpers/fixtures";
const suffix = uniqueSuffix(), emailSuffix = `@funding-${suffix}.test`, slugs = [`funding-${suffix}`, `funding-other-${suffix}`];
let actor: Actor, other: Actor, member: Actor, guest: Actor;
let contactId = "", orgId = "", grantId = "", giftId = "", pledgeId = "", accountId = "";
const input = (kind: string, details: object = {}, extra: object = {}) => ({ kind, title: `Funding ${kind}`, status: "ACTIVE", currency: "INR", details, ...extra });
const donation = (extra = {}) => input("DONATION", { mode: "BANK", pan: "ABCDE1234F", donorAddress: "Kochi", pledgeId }, { contactId, status: "RECEIVED", amountMinor: 100000, dateOn: "2026-09-05", ...extra });
beforeAll(async () => {
  const owner = await createUser(`owner${emailSuffix}`), stranger = await createUser(`other${emailSuffix}`), ordinary = await createUser(`member${emailSuffix}`), visitor = await createUser(`guest${emailSuffix}`);
  const workspace = await createWorkspace(slugs[0]!, owner.id), workspace2 = await createWorkspace(slugs[1]!, stranger.id);
  actor = { user: owner, workspace, membership: { role: "OWNER" } }; other = { user: stranger, workspace: workspace2, membership: { role: "OWNER" } };
  member = { ...actor, user: ordinary, membership: await addMember(workspace.id, ordinary.id) }; guest = { ...actor, user: visitor, membership: await addMember(workspace.id, visitor.id, "GUEST") };
  contactId = (await prisma.contact.create({ data: { workspaceId: workspace.id, displayName: "Funding donor", emails: [{ value: "donor@example.test", primary: true }], preferredChannel: "EMAIL", consentStatus: "GRANTED" } })).id;
  orgId = (await prisma.organisation.create({ data: { workspaceId: workspace.id, name: "Funding foundation" } })).id;
  grantId = (await saveRecord(actor, input("GRANT", {}, { organisationId: orgId, amountMinor: 1000000, dateOn: "2026-04-01", endsOn: "2027-03-31" }))).id;
  pledgeId = (await saveRecord(actor, input("PLEDGE", { frequency: "MONTHLY", nextExpectedOn: "2026-09-05" }, { contactId, amountMinor: 100000 }))).id;
  giftId = (await saveRecord(actor, donation())).id;
});
afterAll(async () => {
  const files = await prisma.fileObject.findMany({ where: { workspaceId: { in: [actor.workspace.id, other.workspace.id] }, folder: "/funding" }, select: { storageKey: true } });
  await deleteObjects(files.map(f => f.storageKey)); await cleanup(slugs, emailSuffix);
});
describe("funding permissions and manual flows", () => {
  it("rejects ordinary members, guests and forged roles", async () => {
    for (const denied of [member, guest, { ...member, membership: { role: "OWNER" as const } }]) {
      await expect(saveRecord(denied, donation())).rejects.toThrow(); await expect(loadFunding(denied, "donations", {})).rejects.toThrow(); await expect(exportFunding(denied, "donations", {})).rejects.toThrow();
    }
  });
  it("blocks cross-tenant records, CRM references and parent links", async () => {
    await expect(saveRecord(other, { ...donation(), id: giftId })).rejects.toThrow();
    await expect(saveRecord(other, donation())).rejects.toThrow();
    await expect(saveRecord(other, input("INSTALMENT", {}, { status: "EXPECTED", parentId: grantId, amountMinor: 10000, dueOn: "2026-12-01" }))).rejects.toThrow();
    expect((await loadFunding(other, "donations", {}, giftId)).selected).toBeNull();
  });
  it("reuses tenant finance funds and rejects currency or tenant mismatches", async () => {
    const fund = await prisma.financeFund.create({ data: { workspaceId: actor.workspace.id, name: "Funding restricted grant", currency: "INR", restricted: true } });
    const saved = await saveRecord(actor, input("GRANT", {}, { organisationId: orgId, fundId: fund.id, amountMinor: 100000, dateOn: "2026-04-01", endsOn: "2027-03-31" }));
    expect((await loadFunding(actor, "grants", {}, saved.id)).selected!.fundId).toBe(fund.id);
    await expect(saveRecord(other, donation({ fundId: fund.id }))).rejects.toThrow();
    await expect(saveRecord(actor, donation({ fundId: fund.id, currency: "USD" }))).rejects.toThrow();
  });
  it("checks current suspended, disabled and archived state", async () => {
    await prisma.membership.updateMany({ where: { workspaceId: actor.workspace.id, userId: actor.user.id }, data: { status: "SUSPENDED" } });
    await expect(loadFunding(actor, "grants", {})).rejects.toThrow();
    await prisma.membership.updateMany({ where: { workspaceId: actor.workspace.id, userId: actor.user.id }, data: { status: "ACTIVE" } });
    await prisma.user.update({ where: { id: actor.user.id }, data: { disabledAt: new Date() } }); await expect(saveRecord(actor, donation())).rejects.toThrow(); await prisma.user.update({ where: { id: actor.user.id }, data: { disabledAt: null } });
    await prisma.workspace.update({ where: { id: actor.workspace.id }, data: { archivedAt: new Date() } }); await expect(loadFunding(actor, "tracker", {})).rejects.toThrow(); await prisma.workspace.update({ where: { id: actor.workspace.id }, data: { archivedAt: null } });
  });
  it("logs grant instalments, report deadlines and deliverable completion", async () => {
    const instalment = await saveRecord(actor, input("INSTALMENT", { receivedOn: "2026-09-10" }, { parentId: grantId, status: "RECEIVED", amountMinor: 250000, dueOn: "2026-09-09" }));
    await saveRecord(actor, input("REPORT", { reportType: "UTILISATION" }, { parentId: grantId, status: "TODO", dueOn: "2026-11-01" }));
    await saveRecord(actor, input("DELIVERABLE", { completedOn: "2026-09-12" }, { parentId: grantId, status: "DONE", dueOn: "2026-09-15" }));
    const loaded = await loadFunding(actor, "grants", {}, grantId); expect(loaded.selected!.children).toHaveLength(3);
    await expect(saveRecord(actor, input("INSTALMENT", {}, { parentId: grantId, status: "EXPECTED", amountMinor: 10, currency: "USD", dueOn: "2026-12-01" }))).rejects.toThrow();
    await expect(operate(actor, { op: "archive", id: grantId })).rejects.toThrow(); expect(instalment.id).toBeTruthy();
  });
  it("tracks campaigns, in-kind gifts, thank-you attribution and retention", async () => {
    const campaign = await saveRecord(actor, input("CAMPAIGN", {}, { amountMinor: 1000000, dateOn: "2026-01-01", endsOn: "2026-12-31" }));
    const gift = await saveRecord(actor, donation({ details: { mode: "IN_KIND", inKindItem: "Office chairs", campaignId: campaign.id } }));
    await operate(actor, { op: "thank", id: gift.id }); const row = await prisma.fundingRecord.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, id: gift.id } }); expect(row.thankedById).toBe(actor.user.id);
    const snapshot = await analyticsSnapshot(actor); expect(snapshot.summary.campaigns.find(c => c.id === campaign.id)!.inKind.INR).toBe(100000);
  });
  it("stores multiple private proofs and enforces download and library rules", async () => {
    const file = await attachFile(actor, giftId, new File(["%PDF-1.4\nproof"], "proof.pdf", { type: "application/pdf" }));
    const file2 = await attachFile(actor, giftId, new File(["%PDF-1.4\nsecond"], "second.pdf", { type: "application/pdf" }));
    expect(await findDownloadableFile(file.id, member.user.id)).toBeNull(); expect(await findDownloadableFile(file.id, other.user.id)).toBeNull(); expect(await findDownloadableFile(file.id, actor.user.id)).not.toBeNull();
    expect(await prisma.fileObject.count({ where: { ...(await libraryWhere({ ...actor, user: { id: actor.user.id, name: null } })), id: file.id } })).toBe(0);
    await expect(detachFile(other, giftId, file.id)).rejects.toThrow(); await detachFile(actor, giftId, file.id); expect(await findDownloadableFile(file.id, actor.user.id)).toBeNull();
    expect((await loadFunding(actor, "donations", {}, giftId)).selected!.attachments.map(a => a.file.id)).toContain(file2.id);
    await expect(attachFile(actor, giftId, new File(["hello"], "bad.txt", { type: "text/plain" }))).rejects.toThrow();
  });
  it("indexes private source records with live role and tenant checks", async () => {
    expect(await searchDocuments({ workspaceId: actor.workspace.id, userId: actor.user.id, role: "OWNER" }, "Funding", "funding")).not.toHaveLength(0);
    expect(await searchDocuments({ workspaceId: actor.workspace.id, userId: member.user.id, role: "MEMBER" }, "Funding", "funding")).toHaveLength(0);
    const row = await saveRecord(actor, input("PROGRAMME", {}, { title: "Funding archived evidence" })); await operate(actor, { op: "archive", id: row.id });
    expect(await searchDocuments({ workspaceId: actor.workspace.id, userId: actor.user.id, role: "OWNER" }, "archived evidence", "funding")).toHaveLength(0); await operate(actor, { op: "restore", id: row.id });
  });
  it("records programme progress and saves a private report PDF", async () => {
    const programme = await saveRecord(actor, input("PROGRAMME", { purpose: "Train office volunteers" }));
    const kpi = await saveRecord(actor, input("KPI", { target: 60, unit: "volunteers", aggregation: "SUM" }, { parentId: programme.id }));
    await saveRecord(actor, input("IMPACT_ENTRY", { value: 18, period: "September 2026" }, { status: "RECORDED", parentId: kpi.id, dateOn: "2026-09-30" }));
    await expect(operate(other, { op: "impactPdf", id: programme.id })).rejects.toThrow();
    await operate(actor, { op: "impactPdf", id: programme.id });
    const selected = (await loadFunding(actor, "impact", {}, programme.id)).selected!;
    expect(selected.attachments).toHaveLength(1);
    const file = await findDownloadableFile(selected.attachments[0]!.file.id, actor.user.id);
    expect(file!.contentType).toBe("application/pdf"); expect(await findDownloadableFile(file!.id, member.user.id)).toBeNull();
    await operate(actor, { op: "archive", id: kpi.id }).catch(() => undefined);
    await expect(saveRecord(other, input("KPI", { target: 1, unit: "people" }, { parentId: programme.id }))).rejects.toThrow();
  });
  it("exports donation filing preparation with PAN, foreign flag and quoted content", async () => {
    const csv = await exportFunding(actor, "donations", {}, true); expect(csv).toContain("ABCDE1234F"); expect(csv).toContain("Foreign source"); expect(await exportFunding(other, "donations", {}, true)).not.toContain("ABCDE1234F");
  });
  it("generates one immutable stored PDF under concurrent retries and queues private attachment email", async () => {
    await saveRecord(actor, input("RECEIPT_SETTINGS", { organisationName: "Community Office Trust", address: "Kochi, Kerala", pan: "AAAAA1234A", registration80G: "Illustrative approval", receiptPrefix: "SW/", signatory: "Treasurer" }));
    await Promise.all([operate(actor, { op: "receipt", id: giftId }), operate(actor, { op: "receipt", id: giftId })]);
    const gift = await prisma.fundingRecord.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, id: giftId } });
    expect(gift.receiptNumber).toMatch(/^DR\/\d{4}\/\d{5}$/); expect(await prisma.fundingAttachment.count({ where: { workspaceId: actor.workspace.id, recordId: giftId, generated: true } })).toBe(1);
    const file = await findDownloadableFile(gift.receiptFileId!, actor.user.id); const bytes = await getObject(file!.storageKey); expect(Buffer.from(bytes!.body).subarray(0, 4).toString()).toBe("%PDF");
    await expect(saveRecord(actor, donation({ id: giftId, amountMinor: 10 }))).rejects.toThrow(); await expect(detachFile(actor, giftId, gift.receiptFileId!)).rejects.toThrow();
    await operate(actor, { op: "email", id: giftId });
    const email = await prisma.outboxMessage.findFirst({ where: { kind: "email", payload: { path: ["fundingReceipt", "recordId"], equals: giftId } } }); expect(email).not.toBeNull();
    const attached = await fundingReceiptAttachment(actor.workspace.id, { recordId: giftId, fileId: gift.receiptFileId, contactId }, "donor@example.test"); expect(attached.content.length).toBeGreaterThan(1000);
    await prisma.contact.updateMany({ where: { workspaceId: actor.workspace.id, id: contactId }, data: { doNotContact: true } });
    await expect(operate(actor, { op: "email", id: giftId })).rejects.toThrow(); await expect(fundingReceiptAttachment(actor.workspace.id, { recordId: giftId, fileId: gift.receiptFileId, contactId }, "donor@example.test")).rejects.toThrow();
  });
  it("creates quarterly access checklists once and records immutable sign-off", async () => {
    const service = await prisma.serviceCatalogItem.create({ data: { workspaceId: actor.workspace.id, name: "Office tool", slug: `funding-${suffix}`, kind: "SAAS_ACCOUNT" } });
    accountId = (await saveRecord(actor, input("TOOL_ACCOUNT", { userId: member.user.id, serviceId: service.id, identity: "member@example.test", accessLevel: "Editor" }))).id;
    await Promise.all([operate(actor, { op: "quarter", quarter: "2026-Q4" }), operate(actor, { op: "quarter", quarter: "2026-Q4" })]);
    const reviews = await prisma.fundingRecord.findMany({ where: { workspaceId: actor.workspace.id, kind: "ACCESS_REVIEW", parentId: accountId } }); expect(reviews).toHaveLength(1);
    await expect(operate(actor, { op: "sign", id: reviews[0]!.id })).rejects.toThrow();
    await saveRecord(actor, input("ACCESS_REVIEW", { quarter: "2026-Q4", decision: "REMOVE", reviewNote: "Removed the obsolete editor permission." }, { id: reviews[0]!.id, parentId: accountId, status: "TODO", dueOn: "2026-12-31" }));
    await operate(actor, { op: "sign", id: reviews[0]!.id }); await expect(saveRecord(actor, input("ACCESS_REVIEW", {}, { id: reviews[0]!.id }))).rejects.toThrow();
    expect((await loadFunding(actor, "access", { person: member.user.id })).records.map(r => r.id)).toContain(accountId);
    const sources = await prisma.$transaction(tx => offboardingSources(tx, actor.workspace.id, member.user.id));
    expect(sources.toolAccounts?.map(a => a.id)).toContain(accountId);
    expect(offboardingItems(sources, { adminId: actor.user.id, dueAt: null }).some(i => i.sourceType === "funding" && i.sourceId === accountId && i.required)).toBe(true);
  });
  it("voids issued gifts without changing their stored receipt facts", async () => {
    const before = await prisma.fundingRecord.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, id: giftId } });
    await expect(operate(member, { op: "void", id: giftId })).rejects.toThrow();
    await operate(actor, { op: "void", id: giftId });
    const after = await prisma.fundingRecord.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, id: giftId } });
    expect(after.status).toBe("VOID"); expect(after.receiptFileId).toBe(before.receiptFileId); expect(after.amountMinor).toBe(before.amountMinor);
    expect((await analyticsSnapshot(actor)).summary.donors.flatMap(d => d.history)).not.toContain(giftId);
    await expect(operate(actor, { op: "email", id: giftId })).rejects.toThrow();
  });
  it("deduplicates deadline, missed pledge and thank-you reminders and publishes aggregate analytics", async () => {
    await Promise.all([run(new Date("2026-10-20T12:00:00Z")), run(new Date("2026-10-20T12:00:00Z"))]);
    const events = await prisma.notificationEventRecord.findMany({ where: { workspaceId: actor.workspace.id, type: { startsWith: "funding." } } }); expect(events.length).toBeGreaterThan(0); expect(new Set(events.map(e => e.dedupeKey)).size).toBe(events.length);
    expect(events.some(e => e.type === "funding.pledge_due")).toBe(true);
    expect(await prisma.fundingAnalyticsSnapshot.count({ where: { workspaceId: actor.workspace.id } })).toBe(1);
    const before = events.length; await run(new Date("2026-10-20T12:01:00Z")); expect(await prisma.notificationEventRecord.count({ where: { workspaceId: actor.workspace.id, type: { startsWith: "funding." } } })).toBe(before);
  });
});
