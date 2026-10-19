import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublicUrl, isPrivateAddress, parseTargetUrl } from "@/lib/integrations/ssrf";

const resolveTo = (...addresses: string[]) => async () => addresses;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.5",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "fc12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "2002:c0a8:101::1",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("parseTargetUrl", () => {
  it("rejects non-http schemes, credentials in the URL and odd ports", () => {
    expect(parseTargetUrl("ftp://example.org/").ok).toBe(false);
    expect(parseTargetUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseTargetUrl("https://user:pass@example.org/").ok).toBe(false);
    expect(parseTargetUrl("https://example.org:6379/").ok).toBe(false);
    expect(parseTargetUrl("not a url").ok).toBe(false);
  });

  it("requires https in production unless private targets are allowed", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(parseTargetUrl("http://example.org/hook").ok).toBe(false);
    expect(parseTargetUrl("https://example.org/hook").ok).toBe(true);
  });
});

describe("checkPublicUrl", () => {
  it("accepts a host that resolves only to public addresses", async () => {
    const result = await checkPublicUrl("https://hooks.example.org/x", { resolver: resolveTo("93.184.216.34") });
    expect(result.ok).toBe(true);
  });

  it("rejects when any resolved address is private (split-horizon / rebinding bait)", async () => {
    const result = await checkPublicUrl("https://hooks.example.org/x", { resolver: resolveTo("93.184.216.34", "10.0.0.7") });
    expect(result).toEqual({ ok: false, error: "That address points at a private network." });
  });

  it("rejects literal private IPs, localhost names and metadata hosts without resolving", async () => {
    const resolver = vi.fn(resolveTo("93.184.216.34"));
    for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://foo.internal/", "https://169.254.169.254/latest"]) {
      expect((await checkPublicUrl(url, { resolver })).ok, url).toBe(false);
    }
    expect(resolver).not.toHaveBeenCalled();
  });

  it("reports unresolvable hosts", async () => {
    const result = await checkPublicUrl("https://nope.example.org/", {
      resolver: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(result).toEqual({ ok: false, error: "That host name does not resolve." });
  });

  it("skips address checks when ALLOW_PRIVATE_WEBHOOK_TARGETS=true", async () => {
    vi.stubEnv("ALLOW_PRIVATE_WEBHOOK_TARGETS", "true");
    expect((await checkPublicUrl("http://192.168.1.20:9000/hook", { resolver: resolveTo("192.168.1.20") })).ok).toBe(true);
  });
});
