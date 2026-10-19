import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewedApp } from "@prisma/client";
import { ingestReview } from "@/lib/appReviews/ingest";
import { mapAppleReview } from "@/lib/appReviews/stores/apple";
import appleFixture from "../fixtures/app-reviews/apple.json";

const mocks = vi.hoisted(() => ({
  tx: { appReview: { createMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() } },
  dispatch: vi.fn(), afterCommit: vi.fn(), index: vi.fn(), activity: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { $transaction: async (fn: (tx: typeof mocks.tx) => Promise<unknown>) => fn(mocks.tx) } }));
vi.mock("@/lib/notify", () => ({ dispatch: mocks.dispatch }));
vi.mock("@/lib/search/documents", () => ({ indexSearchDocument: mocks.index }));
vi.mock("@/lib/activity", () => ({ recordActivity: mocks.activity }));
afterEach(() => vi.resetAllMocks());

describe("app review ingest deduplication", () => {
  it("only emits a received event for a successful first insert", async () => {
    const app = { id: "app", workspaceId: "workspace", name: "Maker app", platform: "APPLE" } as ReviewedApp;
    const remote = mapAppleReview(appleFixture);
    const saved = { ...remote, id: "review", workspaceId: app.workspaceId, appId: app.id, platform: app.platform, tags: [], replyStatus: "NONE", repliedById: null };
    mocks.tx.appReview.createMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mocks.tx.appReview.findUniqueOrThrow.mockResolvedValue(saved); mocks.tx.appReview.update.mockResolvedValue(saved);
    mocks.dispatch.mockResolvedValue({ afterCommit: mocks.afterCommit });
    expect(await ingestReview(app, "makers", remote)).toEqual({ id: saved.id, created: true });
    expect(await ingestReview(app, "makers", remote)).toEqual({ id: saved.id, created: false });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1); expect(mocks.afterCommit).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0][1]).toMatchObject({ type: "app_review.received", scope: { reviewedAppId: app.id, rating: 2 }, data: { app: app.name, platform: "APPLE", author: "A maker" } });
    expect(mocks.index).toHaveBeenCalledTimes(2);
    expect(mocks.tx.appReview.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ workspaceId: app.workspaceId, appId: app.id }] });
  });
  it("keeps the original creation date and newer stored content when an older payload arrives", async () => {
    const app = { id: "app", workspaceId: "workspace", name: "Maker app", platform: "APPLE" } as ReviewedApp;
    const remote = mapAppleReview(appleFixture);
    mocks.tx.appReview.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.appReview.findUniqueOrThrow.mockResolvedValue({ ...remote, id: "review", workspaceId: app.workspaceId, storeUpdatedAt: new Date(remote.storeUpdatedAt.getTime() + 1) });
    await ingestReview(app, "makers", remote);
    expect(mocks.tx.appReview.update).not.toHaveBeenCalled(); expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
