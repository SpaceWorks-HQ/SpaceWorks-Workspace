import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedLookup } from "@/lib/integrations/guardedFetch";
import { requestJson } from "@/lib/integrations/http";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const resolve = (addresses: string[]) => new Promise<{ error: Error | null; addresses: unknown }>(done => guardedLookup(async () => addresses)("hooks.example.org", { all: true }, (error, result) => done({ error, addresses: result })));
describe("socket DNS validation", () => {
  it("returns approved public addresses to the socket", async () => { vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "false"); expect(await resolve(["93.184.216.34"])).toEqual({ error: null, addresses: [{ address: "93.184.216.34", family: 4 }] }); });
  it("rejects a changed DNS answer pointing into a private network", async () => { vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "false"); expect((await resolve(["127.0.0.1"])).error).toBeInstanceOf(Error); });
  it("rejects mixed public and private answers", async () => { vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "false"); expect((await resolve(["93.184.216.34", "169.254.169.254"])).error).toBeInstanceOf(Error); });
  it("requires explicit opt-in for private destinations", async () => { vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "true"); expect((await resolve(["10.1.1.1"])).error).toBeNull(); });
  it("bounds provider response bodies and hides response text from errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(1000001))));
    expect(await requestJson("https://example.org")).toMatchObject({ ok: false, retryable: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret-credential-echo", { status: 403 })));
    const result = await requestJson("https://example.org"); expect(result.ok ? "" : result.error).not.toContain("secret-credential-echo");
  });
});
