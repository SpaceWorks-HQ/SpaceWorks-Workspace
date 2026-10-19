import { afterEach, describe, expect, it, vi } from "vitest";
import { failToSendResult, parseRetryAfter, providerReason, requestJson } from "@/lib/integrations/http";
import { truncate } from "@/lib/messaging/format/escape";

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function stubFetch() {
  vi.stubGlobal("fetch", fetchMock);
}

describe("parseRetryAfter", () => {
  it("reads delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter("1.2")).toBe(2);
    const now = Date.parse("2026-10-19T10:00:00Z");
    expect(parseRetryAfter("Mon, 19 Oct 2026 10:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("requestJson", () => {
  it("sends JSON bodies and parses JSON answers", async () => {
    stubFetch();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, ts: "1.2" }), { status: 200 }));
    const outcome = await requestJson<{ ts: string }>("https://slack.com/api/chat.postMessage", { body: { text: "hi" }, headers: { Authorization: "Bearer x" } });
    expect(outcome).toMatchObject({ ok: true, status: 200, data: { ts: "1.2" } });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBe(JSON.stringify({ text: "hi" }));
    expect((init?.headers as Record<string, string>)["Content-Type"]).toContain("application/json");
  });

  it("maps 429 with Retry-After to a retryable failure", async () => {
    stubFetch();
    fetchMock.mockResolvedValue(new Response("slow down", { status: 429, headers: { "Retry-After": "30" } }));
    const outcome = await requestJson("https://discord.com/api/v10/x", { label: "Discord" });
    expect(outcome).toMatchObject({ ok: false, status: 429, retryable: true, retryAfterSec: 30, error: "Discord is rate limiting requests." });
    expect(failToSendResult(outcome as never)).toEqual({ ok: false, retryable: true, error: "Discord is rate limiting requests.", retryAfterSec: 30 });
  });

  it("reads retry_after from Discord and Telegram bodies", async () => {
    stubFetch();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }));
    expect(await requestJson("https://discord.com/api/v10/x")).toMatchObject({ retryAfterSec: 2 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, parameters: { retry_after: 7 } }), { status: 429 }));
    expect(await requestJson("https://api.telegram.org/botX/sendMessage")).toMatchObject({ retryAfterSec: 7 });
  });

  it("treats 5xx and network errors as retryable, 4xx as permanent, and never follows redirects", async () => {
    stubFetch();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    expect(await requestJson("https://example.org")).toMatchObject({ ok: false, retryable: true });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "Unknown Channel" }), { status: 404 }));
    expect(await requestJson("https://example.org", { label: "Discord" })).toMatchObject({ ok: false, retryable: false, error: "Discord returned 404 (Unknown Channel)." });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/" } }));
    expect(await requestJson("https://example.org")).toMatchObject({ ok: false, retryable: false });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await requestJson("https://example.org", { label: "Slack" })).toMatchObject({ ok: false, retryable: true, error: "Could not reach Slack." });
  });

  it("never echoes the request URL (tokens live in paths) in errors", async () => {
    stubFetch();
    fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
    const outcome = await requestJson("https://api.telegram.org/bot123:SECRET/sendMessage", { label: "Telegram" });
    expect(JSON.stringify(outcome)).not.toContain("SECRET");
  });

  it("runs the SSRF guard before fetching when asked", async () => {
    stubFetch();
    const outcome = await requestJson("https://hooks.example.org/x", { guard: true, resolver: async () => ["10.0.0.5"] });
    expect(outcome).toMatchObject({ ok: false, retryable: false, error: "That address points at a private network." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("providerReason and truncate", () => {
  it("extracts common error shapes", () => {
    expect(providerReason({ error: { message: "bad token" } })).toBe("bad token");
    expect(providerReason({ description: "Bad Request: chat not found" })).toBe("Bad Request: chat not found");
    expect(providerReason(null)).toBeNull();
  });

  it("truncates without splitting surrogate pairs", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello world", 6)).toBe("hello…");
    const cut = truncate("ab😀cd", 4);
    expect(cut).toBe("ab…");
    expect(cut.length).toBeLessThanOrEqual(4);
  });
});
