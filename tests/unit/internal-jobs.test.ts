import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/queue/enqueue", () => ({ enqueueScheduledTick: vi.fn(async () => undefined) }));
import { POST } from "@/app/api/internal/jobs/route";

const secret = "j".repeat(48);

function call(authorization?: string) {
  return POST(new Request("http://localhost/api/internal/jobs", { method: "POST", headers: authorization ? { authorization } : {} }));
}

describe("POST /api/internal/jobs", () => {
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = secret;
  });
  afterEach(() => {
    process.env.CRON_SECRET = previous;
  });

  it("answers 404 without the scheduler bearer", async () => {
    expect((await call()).status).toBe(404);
    expect((await call("Bearer wrong")).status).toBe(404);
    expect((await call(`Basic ${secret}`)).status).toBe(404);
  });

  it("answers 404 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await call(`Bearer ${secret}`)).status).toBe(404);
  });

  it("answers 204 No Content for an authorised scheduler", async () => {
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
