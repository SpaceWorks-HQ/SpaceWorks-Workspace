import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), getdel: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedis: () => mocks }));
import { issueRealtimeTicket, consumeRealtimeTicket } from "@/lib/frontend/realtimeTicket";
import { viewDto } from "@/lib/frontend/view";
beforeEach(() => { vi.clearAllMocks(); mocks.set.mockResolvedValue("OK"); });
describe("split realtime capability", () => {
  it("stores only a hash, with a bounded lifetime and session/workspace binding", async () => {
    const token = await issueRealtimeTicket("makers", "member-1", 3);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const [key, value, expiry, seconds, mode] = mocks.set.mock.calls[0];
    expect(key).not.toContain(token); expect(key).toMatch(/^sww:realtime-ticket:/);
    expect(JSON.parse(value)).toEqual({ workspaceSlug: "makers", userId: "member-1", sessionVersion: 3 });
    expect([expiry, seconds, mode]).toEqual(["EX", 60, "NX"]);
    mocks.getdel.mockResolvedValueOnce(value).mockResolvedValueOnce(null);
    expect(await consumeRealtimeTicket(token, "makers")).toMatchObject({ userId: "member-1", sessionVersion: 3 });
    expect(await consumeRealtimeTicket(token, "makers")).toBeNull();
  });
  it("rejects malformed and differently scoped tickets", async () => {
    expect(await consumeRealtimeTicket("bad", "makers")).toBeNull(); expect(mocks.getdel).not.toHaveBeenCalled();
    mocks.getdel.mockResolvedValue(JSON.stringify({ workspaceSlug: "other", userId: "member-1", sessionVersion: 3 }));
    expect(await consumeRealtimeTicket("a".repeat(64), "makers")).toBeNull();
  });
  it("removes persistence secrets recursively before view transport", () => {
    const value = viewDto({ name: "Safe", tokenHash: "hidden", nested: [{ secretEnc: "encrypted", passwordHash: "hidden", count: 2 }], date: new Date("2030-01-01Z") });
    expect(() => viewDto({ error: new Error("Backend details") })).toThrow();
    expect(viewDto({ contentHash: "public-fingerprint" })).toEqual({ contentHash: "public-fingerprint" });
    expect(value).toEqual({ name: "Safe", nested: [{ count: 2 }], date: new Date("2030-01-01Z") });
  });
});
