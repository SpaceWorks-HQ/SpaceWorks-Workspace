import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveRecord, loadTools, archiveRecord, type Actor } from "@/lib/marketingIt/service";
import { attachFile, detachFile } from "@/lib/marketingIt/files";
import { decideAccess, completeReview } from "@/lib/marketingIt/reviews";
import { exportTools } from "@/lib/marketingIt/export";
import { run } from "@/lib/scheduled/marketingIt";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { searchDocuments } from "@/lib/search/query";
import { offboardingSources } from "@/lib/people/onboarding";
import { offboardingItems } from "@/lib/people/checklistItems";
import { deleteObjects, uploadWorkspaceFile } from "@/lib/storage";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "../helpers/fixtures";
const suffix = uniqueSuffix(), emailSuffix = `@marketing-it-${suffix}.test`, slugs = [`marketing-it-${suffix}`, `marketing-it-other-${suffix}`];
let owner: Actor, member: Actor, guest: Actor, other: Actor, colleague: Actor;
let contentId = "", brandId = "", proposalId = "", incidentId = "", deviceId = "", licenceId = "", reviewId = "", assetId = "", subscriptionId = "", orgId = "";
const input = (kind: string, details: object = {}, extra: object = {}) => ({ kind, title: `Office ${kind}`, status: "DRAFT", details, ...extra });
const content = (extra = {}) => input("CONTENT", { channel: "NEWSLETTER", publishAt: "2026-10-24T04:30:00Z", caption: "Office updates" }, { status: "SCHEDULED", ...extra });
beforeAll(async () => {
 const a = await createUser(`owner${emailSuffix}`), b = await createUser(`member${emailSuffix}`), c = await createUser(`guest${emailSuffix}`), d = await createUser(`other${emailSuffix}`), e = await createUser(`colleague${emailSuffix}`);
 const workspace = await createWorkspace(slugs[0]!, a.id), workspace2 = await createWorkspace(slugs[1]!, d.id);
 owner = { user: a, workspace, membership: { role: "OWNER" } }; other = { user: d, workspace: workspace2, membership: { role: "OWNER" } };
 member = { ...owner, user: b, membership: await addMember(workspace.id, b.id) }; guest = { ...owner, user: c, membership: await addMember(workspace.id, c.id, "GUEST") }; colleague = { ...owner, user: e, membership: await addMember(workspace.id, e.id) };
 assetId = (await prisma.asset.create({ data: { workspaceId: workspace.id, tag: `office-${suffix}`, name: "Office laptop", category: "Laptop" } })).id;
 subscriptionId = (await prisma.subscription.create({ data: { workspaceId: workspace.id, name: "Design software", kind: "LICENSE", period: "YEARLY" } })).id;
 orgId = (await prisma.organisation.create({ data: { workspaceId: workspace.id, name: "Kochi Office Foundation" } })).id;
 contentId = (await saveRecord(member, content({ ownerId: member.user.id }))).id;
 brandId = (await saveRecord(owner, input("BRAND", { category: "TYPE", tags: "brand, approved", usage: "Internal presentation template" }, { status: "APPROVED" }))).id;
 proposalId = (await saveRecord(owner, input("PROPOSAL", { organisationId: orgId, amountMinor: 12500000, currency: "INR", sentOn: "2026-10-15" }, { status: "SENT", dueOn: "2026-10-22", ownerId: owner.user.id }))).id;
 incidentId = (await saveRecord(owner, input("INCIDENT", { type: "PHISHING", confidential: true, detectedAt: "2026-10-20T04:30:00Z" }, { status: "DETECTED" }))).id;
 deviceId = (await saveRecord(owner, input("DEVICE", { serial: "OFFICE-01", condition: "Good", handoverNote: "Charger included" }, { assetId, ownerId: member.user.id, status: "ASSIGNED" }))).id;
 licenceId = (await saveRecord(owner, input("LICENCE", { seats: 2, assigneeIds: [member.user.id] }, { subscriptionId, status: "ACTIVE" }))).id;
});
afterAll(async () => {
 const files = await prisma.fileObject.findMany({ where: { workspaceId: { in: [owner.workspace.id, other.workspace.id] } }, select: { storageKey: true } });
 await deleteObjects(files.map(f => f.storageKey)); await cleanup(slugs, emailSuffix);
});
describe("marketing and IT permissions and manual flows", () => {
 it("allows member-owned content and admin-only outreach and IT writes", async () => {
  await expect(saveRecord(guest, content())).rejects.toThrow(); await expect(saveRecord(member, input("BRAND", {}, { status: "APPROVED" }))).rejects.toThrow();
  await expect(saveRecord({ ...member, membership: { role: "OWNER" } }, input("LICENCE", { seats: 1 }, { subscriptionId, status: "ACTIVE" }))).rejects.toThrow();
  await expect(saveRecord(colleague, content({ id: contentId }))).rejects.toThrow();
  await expect(saveRecord(member, content({ ownerId: owner.user.id }))).rejects.toThrow();
 });
 it("isolates records, exports and every linked tenant source", async () => {
  await expect(saveRecord(other, content({ id: contentId }))).rejects.toThrow();
  for (const raw of [input("DEVICE", {}, { assetId, status: "IN_STOCK" }), input("LICENCE", { seats: 1 }, { subscriptionId, status: "ACTIVE" }), input("PROPOSAL", { organisationId: orgId })]) await expect(saveRecord(other, raw)).rejects.toThrow();
  expect((await loadTools(other, "CONTENT", {}, contentId)).selected).toBeNull(); expect(await exportTools(other, "CONTENT", {})).not.toContain("Office CONTENT");
 });
 it("checks tenant and active state for owners and assigned seats", async () => {
  await expect(saveRecord(owner, content({ ownerId: other.user.id }))).rejects.toThrow();
  await expect(saveRecord(owner, input("LICENCE", { seats: 1, assigneeIds: [other.user.id] }, { id: licenceId, subscriptionId, status: "ACTIVE" }))).rejects.toThrow();
 });
 it("enforces current suspended, disabled and archived state", async () => {
  await prisma.membership.updateMany({ where: { workspaceId: owner.workspace.id, userId: member.user.id }, data: { status: "SUSPENDED" } }); await expect(loadTools(member, "CONTENT", {})).rejects.toThrow();
  await prisma.membership.updateMany({ where: { workspaceId: owner.workspace.id, userId: member.user.id }, data: { status: "ACTIVE" } });
  await prisma.user.update({ where: { id: member.user.id }, data: { disabledAt: new Date() } }); await expect(saveRecord(member, content())).rejects.toThrow(); await prisma.user.update({ where: { id: member.user.id }, data: { disabledAt: null } });
  await prisma.workspace.update({ where: { id: owner.workspace.id }, data: { archivedAt: new Date() } }); await expect(exportTools(owner, "CONTENT", {})).rejects.toThrow(); await prisma.workspace.update({ where: { id: owner.workspace.id }, data: { archivedAt: null } });
 });
 it("shows approved brand assets, own devices and own licence seats to members", async () => {
  expect((await loadTools(member, "BRAND", {}, brandId)).selected?.id).toBe(brandId);
  expect((await loadTools(member, "DEVICE", {}, deviceId)).selected?.id).toBe(deviceId); expect((await loadTools(colleague, "DEVICE", {}, deviceId)).selected).toBeNull();
  expect((await loadTools(member, "LICENCE", {}, licenceId)).selected?.id).toBe(licenceId);
  expect((await loadTools(member, "PROPOSAL", {}, proposalId)).selected).toBeNull(); await expect(exportTools(member, "PROPOSAL", {})).rejects.toThrow();
 });
 it("keeps confidential incidents private and permits explicit shared incidents", async () => {
  expect((await loadTools(member, "INCIDENT", {}, incidentId)).selected).toBeNull();
  const shared = await saveRecord(owner, input("INCIDENT", { detectedAt: "2026-10-20T04:30:00Z", confidential: false }, { title: "Office shared incident", status: "DETECTED" }));
  expect((await loadTools(member, "INCIDENT", {}, shared.id)).selected?.id).toBe(shared.id);
 });
 it("checks social-post workspace and channel matching", async () => {
  const account = await prisma.socialAccount.create({ data: { workspaceId: owner.workspace.id, platform: "INSTAGRAM", externalId: suffix, displayName: "Office" } });
  const post = await prisma.socialPost.create({ data: { workspaceId: owner.workspace.id, accountId: account.id, externalId: suffix, mediaType: "IMAGE", text: "Published office update", publishedAt: new Date() } });
  await expect(saveRecord(other, input("CONTENT", { channel: "INSTAGRAM", socialPostId: post.id, publishAt: new Date().toISOString() }, { status: "PUBLISHED" }))).rejects.toThrow();
  await expect(saveRecord(owner, input("CONTENT", { channel: "LINKEDIN", socialPostId: post.id, publishAt: new Date().toISOString() }, { status: "PUBLISHED" }))).rejects.toThrow();
  const saved = await saveRecord(owner, input("CONTENT", { channel: "INSTAGRAM", socialPostId: post.id, publishAt: new Date().toISOString() }, { status: "PUBLISHED" })); expect(saved.id).toBeTruthy();
 });
 it("filters the content calendar by publish day in the workspace zone", async () => {
  const calendar = await loadTools(owner, "CONTENT", { view: "week", date: "2026-10-24" }); expect(calendar.records.map(r => r.id)).toContain(contentId);
  expect((await loadTools(owner, "CONTENT", { view: "week", date: "2027-01-01" })).records.map(r => r.id)).not.toContain(contentId);
 });
 it("stores multiple private proofs and enforces parent access on downloads", async () => {
  const a = await attachFile(owner, incidentId, new File(["%PDF-1.4\nOffice proof"], "proof.pdf", { type: "application/pdf" })); const b = await attachFile(owner, incidentId, new File(["%PDF-1.4\nSecond"], "second.pdf", { type: "application/pdf" }));
  expect(await findDownloadableFile(a.id, owner.user.id)).not.toBeNull(); expect(await findDownloadableFile(a.id, member.user.id)).toBeNull(); expect(await findDownloadableFile(a.id, other.user.id)).toBeNull();
  expect(await prisma.fileObject.count({ where: { AND: [{ id: a.id }, await libraryWhere({ ...owner, user: { id: owner.user.id, name: null } })] } })).toBe(0);
  expect((await loadTools(owner, "INCIDENT", {}, incidentId)).selected?.attachments).toHaveLength(2);
  await expect(attachFile(member, incidentId, new File(["%PDF"], "bad.pdf", { type: "application/pdf" }))).rejects.toThrow();
  await expect(attachFile(other, incidentId, a.id)).rejects.toThrow();
  await detachFile(owner, incidentId, a.id); expect(await findDownloadableFile(a.id, owner.user.id)).toBeNull(); expect(await findDownloadableFile(b.id, owner.user.id)).not.toBeNull();
 });
 it("rechecks brand approval on every dedicated file download", async () => {
  const f = await attachFile(owner, brandId, new File(["%PDF-1.4\nTemplate"], "brand.pdf", { type: "application/pdf" })); expect(await findDownloadableFile(f.id, member.user.id)).not.toBeNull();
  await saveRecord(owner, input("BRAND", { category: "TEMPLATE" }, { id: brandId, status: "DRAFT" })); expect(await findDownloadableFile(f.id, member.user.id)).toBeNull();
  await saveRecord(owner, input("BRAND", { category: "TEMPLATE" }, { id: brandId, status: "APPROVED" }));
 });
 it("links existing library assets without changing their audience or deleting the source", async () => {
  const uploaded = await uploadWorkspaceFile({ workspaceId: owner.workspace.id, uploadedById: owner.user.id, file: new File(["%PDF-1.4\nLibrary"], "library.pdf", { type: "application/pdf" }) }); if (!uploaded.ok) throw new Error(uploaded.error);
  await attachFile(member, contentId, uploaded.file.id); expect(await findDownloadableFile(uploaded.file.id, guest.user.id)).not.toBeNull();
  const doc = await prisma.doc.create({ data: { workspaceId: owner.workspace.id, title: "Private office reference", visibility: "ADMINS", contentHtml: "", contentText: "" } });
  await prisma.fileObject.update({ where: { id: uploaded.file.id }, data: { docId: doc.id } });
  await expect(attachFile(owner, brandId, uploaded.file.id)).rejects.toThrow();
  expect((await loadTools(colleague, "CONTENT", {}, contentId)).selected?.attachments.map(a => a.file.id)).not.toContain(uploaded.file.id);
  await detachFile(member, contentId, uploaded.file.id); expect(await findDownloadableFile(uploaded.file.id, owner.user.id)).not.toBeNull();
 });
 it("rejects unsupported files and invalid images", async () => {
  await expect(attachFile(owner, incidentId, new File(["script"], "bad.txt", { type: "text/plain" }))).rejects.toThrow();
  await expect(attachFile(owner, incidentId, new File(["invalid image"], "bad.png", { type: "image/png" }))).rejects.toThrow();
 });
 it("keeps a handover history and updates the existing asset owner", async () => {
  await saveRecord(owner, input("DEVICE", { serial: "OFFICE-01", handoverNote: "Returned with charger" }, { id: deviceId, assetId, status: "RETURNED" }));
  expect((await prisma.asset.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, id: assetId } })).ownerUserId).toBeNull();
  const row = (await loadTools(owner, "DEVICE", {}, deviceId)).selected!; expect(row.events.map(e => e.action)).toEqual(["RETURN", "HANDOVER"]);
  expect((await loadTools(member, "DEVICE", {}, deviceId)).selected).toBeNull();
  await saveRecord(owner, input("DEVICE", { serial: "OFFICE-01" }, { id: deviceId, assetId, ownerId: member.user.id, status: "ASSIGNED" }));
 });
 it("uses the Asset owner and condition after another tool records a return", async () => {
  const proof = await attachFile(owner, deviceId, new File(["%PDF-1.4\nDevice proof"], "handover.pdf", { type: "application/pdf" }));
  expect(await findDownloadableFile(proof.id, member.user.id)).not.toBeNull();
  await prisma.asset.update({ where: { id: assetId }, data: { ownerUserId: null, condition: "Returned in good condition" } });
  expect((await loadTools(member, "DEVICE", {}, deviceId)).selected).toBeNull(); expect((await loadTools(member, "DEVICE", {})).records).toHaveLength(0); expect((await loadTools(owner, "DEVICE", { status: "RETURNED" })).records.map(r => r.id)).toContain(deviceId); expect((await loadTools(owner, "DEVICE", { status: "ASSIGNED" })).records.map(r => r.id)).not.toContain(deviceId); expect(await findDownloadableFile(proof.id, member.user.id)).toBeNull();
  const row = (await loadTools(owner, "DEVICE", {}, deviceId)).selected!; expect(row.ownerId).toBeNull(); expect(row.status).toBe("RETURNED"); expect((row.details as Record<string, unknown>).condition).toBe("Returned in good condition");
  expect(await exportTools(member, "DEVICE", {})).not.toContain("Office DEVICE");
  await saveRecord(owner, input("DEVICE", { serial: "OFFICE-01", condition: "Good", handoverNote: "Reassigned after review" }, { id: deviceId, assetId, ownerId: member.user.id, status: "ASSIGNED" }));
  await prisma.asset.update({ where: { id: assetId }, data: { status: "RETIRED" } });
  await expect(saveRecord(owner, input("DEVICE", {}, { id: deviceId, assetId, status: "LOST" }))).rejects.toThrow();
  await prisma.asset.update({ where: { id: assetId }, data: { status: "AVAILABLE" } });
 });
 it("includes device returns and licence seats in offboarding", async () => {
  const sources = await prisma.$transaction(tx => offboardingSources(tx, owner.workspace.id, member.user.id)); expect(sources.itAssignments?.map(r => r.id)).toEqual(expect.arrayContaining([deviceId, licenceId])); expect(offboardingItems(sources, { adminId: owner.user.id, dueAt: null }).filter(i => i.sourceType === "marketing_it").every(i => i.required)).toBe(true);
 });
 it("serialises seat updates and prevents over-allocation", async () => {
  await expect(saveRecord(owner, input("LICENCE", { seats: 1, assigneeIds: [member.user.id, colleague.user.id] }, { id: licenceId, subscriptionId, status: "ACTIVE" }))).rejects.toThrow();
  await expect(archiveRecord(owner, licenceId, true)).rejects.toThrow(); await expect(archiveRecord(owner, deviceId, true)).rejects.toThrow();
 });
 it("snapshots roles, teams, inherited grants, integrations, tokens and seats without secrets", async () => {
  const team = await prisma.team.create({ data: { workspaceId: owner.workspace.id, name: "Office team", slug: suffix } }); await prisma.teamMember.create({ data: { teamId: team.id, userId: member.user.id } });
  const collection = await prisma.vaultCollection.create({ data: { workspaceId: owner.workspace.id, name: "Office secrets" } });
  await prisma.vaultGrant.create({ data: { workspaceId: owner.workspace.id, collectionId: collection.id, principalType: "TEAM", principalId: team.id, permission: "REVEAL" } });
  await prisma.integrationConnection.create({ data: { workspaceId: owner.workspace.id, provider: "GOOGLE", accountLabel: "Office drive", externalId: suffix, connectedById: member.user.id, accessTokenEnc: "DO-NOT-SELECT" } });
  await prisma.apiToken.create({ data: { workspaceId: owner.workspace.id, name: "Office report token", prefix: suffix, secretHash: "DO-NOT-SELECT", createdById: member.user.id } });
  reviewId = (await saveRecord(owner, input("REVIEW", { cadence: "QUARTERLY" }, { status: "OPEN", dueOn: "2026-10-24" }))).id;
  const row = (await loadTools(owner, "REVIEW", {}, reviewId)).selected!; expect(new Set(row.reviewItems.map(i => i.sourceType))).toEqual(new Set(["ROLE", "TEAM", "VAULT", "INTEGRATION", "API_TOKEN", "LICENCE", "SOCIAL_ACCOUNT"])); expect(JSON.stringify(row.reviewItems)).not.toContain("DO-NOT-SELECT");
  expect((await loadTools(member, "REVIEW", {}, reviewId)).selected).toBeNull();
 });
 it("requires every decision and locks completion without revoking access", async () => {
  await expect(completeReview(owner, reviewId)).rejects.toThrow(); const row = (await loadTools(owner, "REVIEW", {}, reviewId)).selected!;
  await expect(decideAccess(other, { recordId: reviewId, itemId: row.reviewItems[0]!.id, decision: "KEEP", note: "Reviewed" })).rejects.toThrow();
  for (const item of row.reviewItems) await decideAccess(owner, { recordId: reviewId, itemId: item.id, decision: item.sourceType === "API_TOKEN" ? "REVOKE" : "KEEP", note: "Reviewed; any revocation will be done in the source tool." });
  await Promise.all([completeReview(owner, reviewId), completeReview(owner, reviewId)]);
  expect((await loadTools(owner, "REVIEW", {}, reviewId)).selected?.completedAt).not.toBeNull(); expect(await prisma.apiToken.count({ where: { workspaceId: owner.workspace.id, revokedAt: null } })).toBe(1);
  await expect(decideAccess(owner, { recordId: reviewId, itemId: row.reviewItems[0]!.id, decision: "KEEP", note: "Changed" })).rejects.toThrow();
  await expect(saveRecord(owner, input("REVIEW", {}, { id: reviewId, status: "OPEN", dueOn: "2026-10-24" }))).rejects.toThrow();
  expect(await exportTools(owner, "REVIEW", {})).toContain("REVOKE");
 });
 it("shows only tenant backup metadata and records recovery evidence", async () => {
  const global = await prisma.backupRun.create({ data: { kind: "DB", status: "SUCCEEDED", startedAt: new Date(), location: "GLOBAL-PRIVATE-LOCATION" } });
  const own = await prisma.backupRun.create({ data: { workspaceId: owner.workspace.id, kind: "DB", status: "SUCCEEDED", startedAt: new Date(), location: "PRIVATE-LOCATION" } }); const foreign = await prisma.backupRun.create({ data: { workspaceId: other.workspace.id, kind: "FILES", status: "SUCCEEDED", startedAt: new Date() } });
  const restore = input("RESTORE", { result: "Checks passed", backupRunId: own.id }, { status: "PASSED", dateOn: "2026-07-01", dueOn: "2026-10-01", notes: "Tested in an isolated environment." }); await saveRecord(owner, restore);
  await expect(saveRecord(other, restore)).rejects.toThrow(); const loaded = await loadTools(owner, "RESTORE", {}); expect(loaded.backups.map(b => b.id)).toContain(own.id); expect(loaded.backups.map(b => b.id)).not.toContain(foreign.id); expect(JSON.stringify(loaded.backups)).not.toContain("PRIVATE-LOCATION"); expect(loaded.instanceBackupHealth.length).toBeGreaterThan(0); expect(JSON.stringify(loaded.instanceBackupHealth)).not.toContain(global.id); expect(JSON.stringify(loaded.instanceBackupHealth)).not.toContain("GLOBAL-PRIVATE-LOCATION"); await prisma.backupRun.delete({ where: { id: global.id } });
 });
 it("authorises live search and removes archived records from search", async () => {
  const search = (a: Actor) => searchDocuments({ workspaceId: a.workspace.id, userId: a.user.id, role: a.membership.role }, "Office", "marketing_it");
  expect((await search(member)).map(r => r.entityId)).not.toContain(incidentId); expect((await search(owner)).map(r => r.entityId)).toContain(incidentId); expect(await search(other)).toHaveLength(0);
  await archiveRecord(owner, brandId, true); expect((await search(member)).map(r => r.entityId)).not.toContain(brandId); await archiveRecord(owner, brandId, false);
 });
 it("seeds every manual tool idempotently without adding provider connections", async () => {
  // The demo runner loads plain ESM modules with its standard area context.
  const { default: seed } = await import("../../scripts/seed/marketing-it.mjs");
  const context = { workspaceId: other.workspace.id, workspace: other.workspace, users: [], channels: [] };
  await seed(prisma, context); const count = await prisma.marketingItRecord.count({ where: { workspaceId: other.workspace.id } }); await seed(prisma, context);
  expect(count).toBe(8); expect(await prisma.marketingItRecord.count({ where: { workspaceId: other.workspace.id } })).toBe(8); expect(await prisma.integrationConnection.count({ where: { workspaceId: other.workspace.id } })).toBe(0);
 });
 it("does not let a planned drill replace completed recovery evidence", async () => {
  await saveRecord(owner, input("RESTORE", { result: "Planned drill" }, { status: "PLANNED", dateOn: "2026-12-01", dueOn: "2027-03-01", notes: "Plan only, not recovery evidence." }));
  const loaded = await loadTools(owner, "RESTORE", { q: "Plan" }); expect(loaded.latestRestore?.status).toBe("PASSED"); expect(loaded.latestRestore?.dueOn?.toISOString().slice(0, 10)).toBe("2026-10-01");
 });
 it("deduplicates reminders and keeps confidential payloads generic", async () => {
  await Promise.all([run(new Date("2026-10-23T06:00:00Z")), run(new Date("2026-10-23T06:00:00Z"))]);
  const rows = await prisma.notificationEventRecord.findMany({ where: { workspaceId: owner.workspace.id, type: { in: ["marketing.publish_due", "marketing.follow_up_due", "it.restore_due"] } } });
  expect(rows.map(r => r.type)).toEqual(expect.arrayContaining(["marketing.publish_due", "marketing.follow_up_due", "it.restore_due"])); expect(new Set(rows.map(r => r.dedupeKey)).size).toBe(rows.length); expect(JSON.stringify(rows)).not.toContain("Office PROPOSAL");
  await run(new Date("2026-10-23T06:01:00Z")); expect(await prisma.notificationEventRecord.count({ where: { workspaceId: owner.workspace.id, id: { in: rows.map(r => r.id) } } })).toBe(rows.length);
 });
});
