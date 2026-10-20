import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/queue/enqueue", () => ({ enqueueScheduledTick: vi.fn(async () => undefined) }));
import { enqueueScheduledTick } from "@/lib/queue/enqueue";
import { POST } from "@/app/api/internal/jobs/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("monitor external scheduler entry point", () => {
  it.each([undefined, "Bearer wrong-token"])("rejects unauthorized requests before enqueuing work", async authorization => {
    vi.stubEnv("CRON_SECRET", "fixture-cron-secret-with-at-least-32-characters");
    const response = await POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: authorization ? { authorization } : {} }));
    expect(response.status).toBe(404); expect(enqueueScheduledTick).not.toHaveBeenCalled();
  });
  it("enqueues after valid bearer authentication", async () => {
    vi.stubEnv("CRON_SECRET", "fixture-cron-secret-with-at-least-32-characters");
    const response = await POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(response.status).toBe(204); expect(enqueueScheduledTick).toHaveBeenCalledTimes(1);
  });
  it("reports Redis failure without internal details", async () => {
    vi.stubEnv("CRON_SECRET", "fixture-cron-secret-with-at-least-32-characters");
    vi.mocked(enqueueScheduledTick).mockRejectedValueOnce(new Error("private connection details"));
    const response = await POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false });
  });
});
