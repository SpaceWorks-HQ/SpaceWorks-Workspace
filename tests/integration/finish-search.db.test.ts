import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import { indexSearchDocument } from "@/lib/search/documents";
import { searchDocuments } from "@/lib/search/query";
import { ingestReview } from "@/lib/appReviews/ingest";
import { getDashboardData } from "@/lib/dashboard";
import { updateProject } from "@/lib/projects/service";

const suffix = uniqueSuffix(), slug = `search-finish-${suffix}`, domain = `@search-finish-${suffix}.test`;
const term = `Searchfixture${suffix}`;
let workspaceId: string, ownerId: string, memberId: string, guestId: string, reviewId: string, contactId: string, decisionId: string;
const actor = (userId: string, role: WorkspaceRole) => ({ workspaceId, userId, role });
beforeAll(async () => {
  ownerId = (await createUser(`owner${domain}`)).id;
  memberId = (await createUser(`member${domain}`)).id;
  guestId = (await createUser(`guest${domain}`)).id;
  workspaceId = (await createWorkspace(slug, ownerId)).id;
  await addMember(workspaceId, memberId); await addMember(workspaceId, guestId, "GUEST");
  const account = await prisma.appStoreAccount.create({ data: { workspaceId, name: "Search fixture", platform: "APPLE" } });
  const app = await prisma.reviewedApp.create({ data: { workspaceId, accountId: account.id, name: "Search fixture", platform: "APPLE", appIdentifier: "fixture" } });
  const review = await ingestReview(app, slug, { externalReviewId: "fixture", title: term, body: "Feedback", author: "Member", rating: 1, language: "en", territory: null, appVersion: null, storeCreatedAt: new Date(), storeUpdatedAt: new Date() });
  reviewId = review.id;
  // Existing indexes used PRIVATE with no owner before the shared role gate existed.
  await prisma.searchDocument.update({ where: { entityType_entityId: { entityType: "app_review", entityId: reviewId } }, data: { visibility: "PRIVATE" } });
  const contact = await prisma.contact.create({ data: { workspaceId, displayName: term, visibility: "PRIVATE", ownerId: ownerId } }); contactId = contact.id;
  await indexSearchDocument({ workspaceId, entityType: "contact", entityId: contactId, title: term, visibility: "PRIVATE", ownerId: ownerId, url: `/w/${slug}/contacts/${contactId}` });
  const meeting = await prisma.meeting.create({ data: { workspaceId, title: term, visibility: "PRIVATE", createdById: ownerId, startsAt: new Date() } });
  const decision = await prisma.decision.create({ data: { workspaceId, meetingId: meeting.id, title: term, decisionMd: "Result", visibility: "WORKSPACE", createdById: ownerId } }); decisionId = decision.id;
  // Stale or overly broad metadata cannot bypass source meeting permissions.
  await indexSearchDocument({ workspaceId, entityType: "decision", entityId: decisionId, title: term, url: `/w/${slug}/meetings/decisions` });
});
afterAll(async () => { await cleanup([slug], domain); await prisma.$disconnect(); });
describe.sequential("finished search and dashboard integration", () => {
  it("finds ingested app reviews for members, including legacy metadata, without exposing them to guests", async () => {
    expect((await searchDocuments(actor(memberId, "MEMBER"), term)).map(r => r.entityId)).toContain(reviewId);
    expect((await searchDocuments(actor(guestId, "GUEST"), term)).map(r => r.entityId)).not.toContain(reviewId);
  });
  it("keeps private CRM records and decisions behind a private meeting out of other members' search", async () => {
    const ids = (await searchDocuments(actor(memberId, "MEMBER"), term)).map(r => r.entityId);
    expect(ids).not.toContain(contactId); expect(ids).not.toContain(decisionId);
    const own = (await searchDocuments(actor(ownerId, "OWNER"), term)).map(r => r.entityId);
    expect(own).toContain(contactId); expect(own).toContain(decisionId);
    await prisma.contact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
    expect((await searchDocuments(actor(ownerId, "OWNER"), term)).map(r => r.entityId)).not.toContain(contactId);
  });
  it("includes unreplied low ratings for members and omits operational summaries for guests", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    expect((await getDashboardData(workspace, memberId, { role: "MEMBER" })).unrepliedLowRatings).toBe(1);
    const guest = await getDashboardData(workspace, guestId, { role: "GUEST" });
    expect(guest.unrepliedLowRatings).toBeNull(); expect(guest.services).toEqual([]);
  });
  it("saves cycles only for project managers and retains them across ordinary settings edits", async () => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const membership = await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: ownerId } });
    const project = await prisma.project.create({ data: { workspaceId, key: "FIN", name: "Finish project", ownerId } });
    const input = { projectId: project.id, name: project.name, key: project.key, status: "ACTIVE", cyclesEnabled: true };
    expect(await updateProject({ workspace, user, membership }, input)).toMatchObject({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ cyclesEnabled: true });
    const member = await prisma.user.findUniqueOrThrow({ where: { id: memberId } });
    const memberShip = await prisma.membership.findFirstOrThrow({ where: { workspaceId, userId: memberId } });
    expect(await updateProject({ workspace, user: member, membership: memberShip }, { ...input, cyclesEnabled: false })).toMatchObject({ ok: false });
    const { cyclesEnabled, ...ordinary } = input; void cyclesEnabled;
    expect(await updateProject({ workspace, user, membership }, ordinary)).toMatchObject({ ok: true });
    expect(await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).toMatchObject({ cyclesEnabled: true });
  });
});
