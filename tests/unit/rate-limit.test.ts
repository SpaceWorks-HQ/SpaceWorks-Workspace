import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("rate limiting without Redis", () => {
  it("allows up to the bucket limit in development, then blocks", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const { checkRateLimitById } = await import("@/lib/rateLimit");
    const results = [];
    for (let i = 0; i < 12; i += 1) results.push(await checkRateLimitById("auth", "ip:test-dev"));
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[10]).toBe(false);
  });

  it("keeps subjects separate", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    const { checkRateLimitById } = await import("@/lib/rateLimit");
    for (let i = 0; i < 10; i += 1) await checkRateLimitById("auth", "ip:a");
    expect(await checkRateLimitById("auth", "ip:a")).toBe(false);
    expect(await checkRateLimitById("auth", "ip:b")).toBe(true);
  });

  it("fails closed in production", async () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    const { checkRateLimitById } = await import("@/lib/rateLimit");
    expect(await checkRateLimitById("global", "ip:prod")).toBe(false);
  });
});

describe("client IP resolution", () => {
  it("ignores forwarding headers unless a trusted header is configured", async () => {
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "");
    const { getClientIpFromHeaders } = await import("@/lib/rateLimit");
    expect(getClientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4" }))).toBe("unknown");
  });

  it("reads the configured header and honours proxy hops", async () => {
    vi.stubEnv("TRUSTED_PROXY_IP_HEADER", "x-forwarded-for");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const { getClientIpFromHeaders } = await import("@/lib/rateLimit");
    expect(getClientIpFromHeaders(new Headers({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
  });
});
