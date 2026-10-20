import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/queue/enqueue", () => ({ enqueueDueOutbox: vi.fn(async () => ({ enqueued: 2 })) }));
import { POST } from "@/app/api/internal/outbox/route";
import { enqueueDueOutbox } from "@/lib/queue/enqueue";
const secret = "fixture-outbox-secret-with-at-least-32-characters";
const call = (authorization?: string) => POST(new Request("http://localhost/api/internal/outbox", { method: "POST", headers: authorization ? { authorization } : {} }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("outbox enqueue endpoint", () => {
  it("denies unauthenticated work before accessing Redis", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    expect((await call()).status).toBe(404);
    expect((await call("Bearer wrong")).status).toBe(404);
    expect(enqueueDueOutbox).not.toHaveBeenCalled();
  });
  it("enqueues after bearer validation without running delivery inline", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, enqueued: 2 });
    expect(enqueueDueOutbox).toHaveBeenCalledTimes(1);
  });
  it("returns a safe retryable error when Redis is unavailable", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    vi.mocked(enqueueDueOutbox).mockRejectedValueOnce(new Error("private Redis connection"));
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private Redis");
  });
});
