import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac, generateKeyPairSync } from "node:crypto";
import type { ReviewedApp } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ingestReview, pollApp } from "@/lib/appReviews/ingest";
import { sendReviewReply, recheckReply } from "@/lib/appReviews/replies";
import { mirrorReview, processSlackEvent, receiveSlackEvent } from "@/lib/appReviews/slack";
import { getReview, listReviews, reviewInsights, reviewSettings } from "@/lib/appReviews/queries";
import { saveAccount, saveApp, saveSlackMember } from "@/lib/appReviews/settings";
import { triageReview, createReviewTask } from "@/lib/appReviews/triage";
import { mapAppleReview } from "@/lib/appReviews/stores/apple";
import appleFixture from "../fixtures/app-reviews/apple.json";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix(); const domain = `@app-reviews-${suffix}.test`;
const slugs = [`reviews-a-${suffix}`, `reviews-b-${suffix}`];
let admin: WorkspaceContext; let member: WorkspaceContext; let guest: WorkspaceContext; let foreign: WorkspaceContext;
let accountId: string; let app: ReviewedApp;
const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const remote = (id: string) => ({ ...mapAppleReview(appleFixture), externalReviewId: id, storeCreatedAt: new Date(Date.now() - 86_400_000), storeUpdatedAt: new Date(Date.now() - 86_400_000) });
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
const response = (body: string, state = "PUBLISHED") => json({ data: { id: "response-id", attributes: { responseBody: body, state } } });
async function context(workspace: WorkspaceContext["workspace"], user: WorkspaceContext["user"], role: "ADMIN" | "MEMBER" | "GUEST") {
  const membership = await addMember(workspace.id, user.id, role);
  return { workspace, user, membership };
}
async function newApp(name: string) { return prisma.reviewedApp.create({ data: { workspaceId: admin.workspace.id, accountId, platform: "APPLE", name, appIdentifier: uniqueSuffix().replace(/[a-f]/g, "1"), allowNoProxy: true } }); }
beforeEach(() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected external request"))));
afterEach(() => vi.unstubAllGlobals());

describe.sequential("app review isolation and delivery", () => {
  beforeAll(async () => {
    // Fail closed: this file must never contact an external store or Slack.
    const owner = await createUser(`owner${domain}`); const workspace = await createWorkspace(slugs[0], owner.id);
    admin = await context(workspace, await createUser(`admin${domain}`), "ADMIN");
    member = await context(workspace, await createUser(`member${domain}`), "MEMBER");
    guest = await context(workspace, await createUser(`guest${domain}`), "GUEST");
    const ownerB = await createUser(`owner-b${domain}`); const workspaceB = await createWorkspace(slugs[1], ownerB.id);
    foreign = await context(workspaceB, await createUser(`admin-b${domain}`), "ADMIN");
    const account = await saveAccount(admin, { platform: "APPLE", name: "Test account", issuerId: "test-issuer", keyId: "test-key", privateKeyP8: key });
    if (!account.ok || !account.data) throw new Error("Account fixture failed"); accountId = account.data.id;
    app = await newApp("Maker app");
  });
  afterAll(async () => { await cleanup(slugs, domain); await prisma.$disconnect(); });

  it("encrypts credentials and returns only safe settings projections", async () => {
    const row = await prisma.appStoreAccount.findFirstOrThrow({ where: { workspaceId: admin.workspace.id, id: accountId } });
    expect(row.privateKeyP8Enc).not.toContain("PRIVATE KEY"); expect(decryptSecret("app-review-private-key", row.privateKeyP8Enc!)).toBe(key.trim());
    const settings = JSON.stringify(await reviewSettings(admin));
    expect(settings).not.toContain("test-issuer"); expect(settings).not.toContain("test-key"); expect(settings).not.toContain("Enc"); expect(settings).not.toContain("PRIVATE KEY");
    expect(await reviewSettings(member)).toBeNull(); expect(await reviewSettings(guest)).toBeNull();
    expect(await saveAccount(member, { name: "Rejected" })).toMatchObject({ ok: false });
    expect(await saveAccount(foreign, { id: accountId, platform: "APPLE", name: "Foreign edit" })).toMatchObject({ ok: false });
  });
  it("retains saved credentials when an admin edits metadata without new secrets", async () => {
    expect(await saveAccount(admin, { id: accountId, platform: "APPLE", name: "Renamed account" })).toMatchObject({ ok: true });
    const row = await prisma.appStoreAccount.findFirstOrThrow({ where: { workspaceId: admin.workspace.id, id: accountId } });
    expect(decryptSecret("app-review-private-key", row.privateKeyP8Enc!)).toBe(key.trim());
  });
  it("ingests concurrently once and dispatches one event per new review", async () => {
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => ingestReview(app, slugs[0], remote("deduped"))));
    expect(outcomes.filter(r => r.created)).toHaveLength(1);
    const review = await prisma.appReview.findFirstOrThrow({ where: { workspaceId: app.workspaceId, appId: app.id, externalReviewId: "deduped" } });
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: app.workspaceId, dedupeKey: `app-review:${review.id}:received` } })).toBe(1);
    await ingestReview(app, slugs[0], { ...remote("deduped"), body: "Edited feedback", rating: 1, storeUpdatedAt: new Date() });
    expect(await prisma.appReview.count({ where: { workspaceId: app.workspaceId, appId: app.id, externalReviewId: "deduped" } })).toBe(1);
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: app.workspaceId, dedupeKey: `app-review:${review.id}:received` } })).toBe(1);
    expect(await prisma.searchDocument.findFirst({ where: { workspaceId: app.workspaceId, entityId: review.id } })).toMatchObject({ body: expect.stringContaining("Edited feedback") });
  });
  it("allows only one poll claim across simultaneous workers", async () => {
    const polled = await newApp("Concurrent polls");
    const fetcher = vi.fn().mockImplementation(async () => json({ data: [{ ...appleFixture, id: "poll-review" }] })); vi.stubGlobal("fetch", fetcher);
    const outcomes = await Promise.all([pollApp(polled.workspaceId, polled.id), pollApp(polled.workspaceId, polled.id)]);
    expect(outcomes.filter(r => r.polled)).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.appReview.count({ where: { workspaceId: polled.workspaceId, appId: polled.id } })).toBe(1);
  });
  it("resumes past reviews saved by an interrupted first sync without losing older pages", async () => {
    const polled = await newApp("Interrupted sync");
    const next = `https://api.appstoreconnect.apple.com/v1/apps/${polled.appIdentifier}/customerReviews?cursor=older`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({ data: [{ ...appleFixture, id: "partial-new" }], links: { next } })).mockResolvedValueOnce(new Response("unavailable", { status: 503 })));
    await pollApp(polled.workspaceId, polled.id);
    expect((await prisma.reviewedApp.findFirstOrThrow({ where: { workspaceId: polled.workspaceId, id: polled.id } })).lastPolledAt).toBeNull();
    await prisma.reviewedApp.update({ where: { workspaceId: polled.workspaceId, id: polled.id }, data: { nextPollAt: new Date(0) } });
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [{ ...appleFixture, id: "partial-new" }], links: { next } })).mockResolvedValueOnce(json({ data: [{ ...appleFixture, id: "partial-older" }] })); vi.stubGlobal("fetch", fetcher);
    expect(await pollApp(polled.workspaceId, polled.id)).toMatchObject({ polled: true, created: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await prisma.appReview.count({ where: { workspaceId: polled.workspaceId, appId: polled.id } })).toBe(2);
  });
  it("keeps guests and foreign tenants out of reviews, triage and replies", async () => {
    const review = await ingestReview(app, slugs[0], remote("authz"));
    expect(await listReviews(guest)).toBeNull(); expect(await getReview(guest, review.id)).toBeNull(); expect(await getReview(foreign, review.id)).toBeNull();
    expect((await listReviews(member))?.reviews.some(r => r.id === review.id)).toBe(true);
    expect(await triageReview(guest, { reviewId: review.id, status: "DONE", tags: [] })).toMatchObject({ ok: false });
    expect(await triageReview(foreign, { reviewId: review.id, status: "DONE", tags: [] })).toMatchObject({ ok: false });
    expect(await triageReview(member, { reviewId: review.id, status: "IN_PROGRESS", assigneeId: member.user.id, tags: ["login", "login"] })).toMatchObject({ ok: true });
    expect((await getReview(member, review.id))?.tags).toEqual(["login"]);
    expect(await sendReviewReply({ workspaceId: app.workspaceId, reviewId: review.id, actorId: guest.user.id, source: "WORKSPACE", triggerKey: "guest", body: "No" })).toMatchObject({ ok: false });
    expect(await sendReviewReply({ workspaceId: foreign.workspace.id, reviewId: review.id, actorId: foreign.user.id, source: "WORKSPACE", triggerKey: "foreign", body: "No" })).toMatchObject({ ok: false });
  });
  it("rejects cross-tenant account relations and assignees", async () => {
    expect(await saveApp(foreign, { platform: "APPLE", accountId, name: "Foreign", appIdentifier: "555", allowNoProxy: true })).toMatchObject({ ok: false });
    await expect(prisma.reviewedApp.create({ data: { workspaceId: foreign.workspace.id, accountId, platform: "APPLE", name: "Foreign SQL", appIdentifier: "555" } })).rejects.toThrow();
    const review = await ingestReview(app, slugs[0], remote("bad-assignee"));
    expect(await triageReview(member, { reviewId: review.id, status: "NEW", assigneeId: foreign.user.id, tags: [] })).toMatchObject({ ok: false });
  });
  it("claims duplicate workspace sends permanently and publishes once", async () => {
    const review = await ingestReview(app, slugs[0], remote("workspace-send")); const fetcher = vi.fn().mockImplementation(async () => response("Thanks for the report.")); vi.stubGlobal("fetch", fetcher);
    const input = { workspaceId: app.workspaceId, reviewId: review.id, actorId: member.user.id, source: "WORKSPACE" as const, triggerKey: "workspace-send-once", body: "Thanks for the report." };
    const outcomes = await Promise.all([sendReviewReply(input), sendReviewReply(input)]);
    expect(outcomes.every(r => r.ok)).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await prisma.appReviewReplyAttempt.count({ where: { workspaceId: app.workspaceId, reviewId: review.id } })).toBe(1);
    expect((await getReview(member, review.id))?.replyPublishState).toBe("PUBLISHED");
    expect(await sendReviewReply({ ...input, body: "Changed" })).toMatchObject({ ok: false });
  });
  it("rechecks pending Apple replies without resending and dispatches publication once", async () => {
    const review = await ingestReview(app, slugs[0], remote("pending"));
    const fetcher = vi.fn().mockImplementationOnce(async () => response("We'll investigate.", "PENDING_PUBLISH")).mockImplementation(async () => response("We'll investigate.")); vi.stubGlobal("fetch", fetcher);
    const outcome = await sendReviewReply({ workspaceId: app.workspaceId, reviewId: review.id, actorId: member.user.id, source: "WORKSPACE", triggerKey: "pending", body: "We'll investigate." });
    expect(outcome).toMatchObject({ ok: true, data: { state: "PENDING" } });
    const later = new Date(Date.now() + 360_000);
    await Promise.all([recheckReply(app.workspaceId, review.id, later), recheckReply(app.workspaceId, review.id, later)]);
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    const attempt = await prisma.appReviewReplyAttempt.findFirstOrThrow({ where: { workspaceId: app.workspaceId, reviewId: review.id } });
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId: app.workspaceId, dedupeKey: `app-review:${attempt.id}:published` } })).toBe(1);
  });
  it("records safe failures and never automatically repeats an ambiguous POST", async () => {
    const review = await ingestReview(app, slugs[0], remote("failed-send")); const fetcher = vi.fn().mockRejectedValue(new Error("private-key-secret")); vi.stubGlobal("fetch", fetcher);
    const input = { workspaceId: app.workspaceId, reviewId: review.id, actorId: member.user.id, source: "WORKSPACE" as const, triggerKey: "failed-send", body: "Thanks" };
    expect(await sendReviewReply(input)).toMatchObject({ ok: false }); expect(await sendReviewReply(input)).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const saved = await getReview(member, review.id); expect(saved?.replyStatus).toBe("FAILED"); expect(JSON.stringify(saved)).not.toContain("private-key-secret");
  });
  it("reconciles imported Apple replies without a local attempt", async () => {
    const review = await ingestReview(app, slugs[0], { ...remote("imported-pending"), reply: { body: "Original reply", externalId: "response-id", state: "PENDING", sentAt: new Date() } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => response("Edited outside the workspace")));
    await recheckReply(app.workspaceId, review.id);
    expect(await getReview(member, review.id)).toMatchObject({ replyBody: "Edited outside the workspace", replyPublishState: "PUBLISHED" });
    expect(await prisma.appReviewReplyAttempt.count({ where: { workspaceId: app.workspaceId, reviewId: review.id } })).toBe(0);
  });
  it("mirrors once and processes duplicate reaction events as exactly one store send", async () => {
    await prisma.appReviewSlackConfig.create({ data: { workspaceId: app.workspaceId, teamId: "T123", botUserId: "UBOT", botTokenEnc: encryptSecret("app-review-slack-token", "mock-slack-token"), signingSecretEnc: encryptSecret("app-review-slack-signing", "mock-slack-secret") } });
    expect(await saveSlackMember(admin, { slackUserId: "UMEMBER", userId: member.user.id })).toMatchObject({ ok: true });
    await prisma.reviewedApp.update({ where: { workspaceId: app.workspaceId, id: app.id }, data: { slackChannelId: "CREVIEWS" } });
    const review = await ingestReview(app, slugs[0], remote("slack-send"));
    const fetcher = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("conversations.replies")) return json({ ok: true, messages: [{ ts: "100.002", thread_ts: "100.001", user: "UMEMBER", text: "*Thanks* for your report." }] });
      if (url.includes("chat.postMessage")) return json({ ok: true, ts: "100.001" });
      if (url.includes("customerReviewResponses") && init.method === "POST") return response("Thanks for your report.");
      throw new Error("Unexpected external request");
    }); vi.stubGlobal("fetch", fetcher);
    await Promise.all([mirrorReview(app.workspaceId, review.id), mirrorReview(app.workspaceId, review.id)]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const payload = { type: "event_callback", team_id: "T123", event_id: "event-one", event: { type: "reaction_added", user: "UMEMBER", item_user: "UMEMBER", reaction: "white_check_mark", item: { type: "message", channel: "CREVIEWS", ts: "100.002" } } };
    const body = JSON.stringify(payload); const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "mock-slack-secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    expect((await receiveSlackEvent(slugs[0], body, timestamp, "v0=" + "0".repeat(64))).status).toBe(401);
    await Promise.all([receiveSlackEvent(slugs[0], body, timestamp, signature), receiveSlackEvent(slugs[0], body, timestamp, signature)]);
    const event = await prisma.appReviewSlackEvent.findFirstOrThrow({ where: { workspaceId: app.workspaceId, externalEventId: "event-one" } });
    await Promise.all([processSlackEvent(app.workspaceId, event.id), processSlackEvent(app.workspaceId, event.id)]);
    expect(fetcher.mock.calls.filter(([url, init]) => String(url).includes("customerReviewResponses") && init.method === "POST")).toHaveLength(1);
    expect(await prisma.appReviewReplyAttempt.count({ where: { workspaceId: app.workspaceId, reviewId: review.id } })).toBe(1);
    expect((await getReview(member, review.id))?.replyBody).toBe("Thanks for your report.");
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes("chat.postMessage"))).toHaveLength(2);
  });
  it("keeps insights scoped to the caller's workspace", async () => {
    const a = await reviewInsights(member); const b = await reviewInsights(foreign);
    expect(a!.summary.total).toBeGreaterThan(0); expect(b!.summary.total).toBe(0); expect(await reviewInsights(guest)).toBeNull();
  });
  it("buckets stored UTC timestamps into the workspace's local calendar day", async () => {
    const account = await prisma.appStoreAccount.create({ data: { workspaceId: foreign.workspace.id, platform: "APPLE", name: "Calendar fixture", active: false } });
    const isolatedApp = await prisma.reviewedApp.create({ data: { workspaceId: foreign.workspace.id, accountId: account.id, platform: "APPLE", appIdentifier: "12345", name: "Calendar fixture", active: false } });
    const boundary = new Date(); boundary.setUTCDate(boundary.getUTCDate() - 2); boundary.setUTCHours(23, 30, 0, 0);
    await ingestReview(isolatedApp, slugs[1], { ...remote("day-boundary"), storeCreatedAt: boundary, storeUpdatedAt: boundary });
    const utc = await reviewInsights({ ...foreign, workspace: { ...foreign.workspace, timezone: "UTC" } });
    const kolkata = await reviewInsights({ ...foreign, workspace: { ...foreign.workspace, timezone: "Asia/Kolkata" } });
    const previousDay = boundary.toISOString().slice(0, 10);
    const localDay = new Date(boundary.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    expect(utc!.daily.find(d => d.day === previousDay)?.total).toBe(1);
    expect(kolkata!.daily.find(d => d.day === previousDay)).toBeUndefined();
    expect(kolkata!.daily.some(d => d.day === localDay)).toBe(true);
  });
  it("creates one linked task for concurrent create-task requests", async () => {
    const review = await ingestReview(app, slugs[0], remote("task"));
    const outcomes = await Promise.all([createReviewTask(member, { reviewId: review.id }), createReviewTask(member, { reviewId: review.id })]);
    expect(outcomes.every(r => r.ok)).toBe(true);
    if (outcomes[0].ok && outcomes[1].ok) expect(outcomes[0].data?.id).toBe(outcomes[1].data?.id);
  });
});
