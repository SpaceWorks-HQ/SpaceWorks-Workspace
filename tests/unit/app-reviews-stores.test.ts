import { afterEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import appleFixture from "../fixtures/app-reviews/apple.json";
import googleFixture from "../fixtures/app-reviews/google.json";
import { appleClient, appleJwt, applePublishState, mapAppleReview } from "@/lib/appReviews/stores/apple";
import { googleAssertion, googleClient, googleCredentials, mapGoogleReview } from "@/lib/appReviews/stores/google";
import { officialUrl, requestJson } from "@/lib/appReviews/stores/http";
import { safeStoreError } from "@/lib/appReviews/stores/types";
import { validateReply, replyLength, appSchema } from "@/lib/appReviews/validation";

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const apple = { issuerId: "issuer", keyId: "key", privateKeyP8: ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const google = JSON.stringify({ type: "service_account", client_email: "reviews@example.test", private_key: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
const transport = { allowNoProxy: true };
const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

describe("app review store clients", () => {
  it("signs Apple's ES256 JWT with a generated P-256 key and a sub-20-minute lifetime", () => {
    const now = new Date("2026-10-18T09:30:00Z");
    const token = appleJwt(apple, now); const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "key", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({ iss: "issuer", aud: "appstoreconnect-v1", iat: now.getTime() / 1000 });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(1200);
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });
  it("rejects non-P-256 Apple keys safely", () => {
    expect(() => appleJwt({ ...apple, privateKeyP8: "secret-invalid-key" })).toThrow("Check the Apple");
    expect(() => appleJwt({ ...apple, privateKeyP8: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).toThrow("Check the Apple");
  });
  it("signs Google's RSA assertion for the androidpublisher scope", () => {
    const token = googleAssertion(google); const [header, payload, signature] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toMatchObject({ iss: "reviews@example.test", scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token" });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), rsa.publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(() => googleCredentials("not-json-secret")).toThrow("Upload a valid Google");
  });
  it("maps Apple review metadata", () => {
    expect(mapAppleReview(appleFixture)).toMatchObject({ externalReviewId: "apple-review-1", author: "A maker", rating: 2, territory: "IND", title: "Hard to sign in", language: null, storeCreatedAt: new Date("2026-10-18T09:30:00Z") });
  });
  it("maps original Google text, language, version, fractional date and existing reply", () => {
    const review = mapGoogleReview(googleFixture)!;
    expect(review).toMatchObject({ rating: 4, body: "Original feedback", language: "ml", appVersion: "2.1.0", reply: { state: "PUBLISHED", body: "Thanks for helping us improve." } });
    expect(review.storeUpdatedAt.getMilliseconds()).toBe(500);
    expect(mapGoogleReview({ reviewId: "empty", comments: [] })).toBeNull();
    expect(mapGoogleReview({ ...googleFixture, comments: [{ userComment: { ...googleFixture.comments[0].userComment, text: "Newest feedback", originalText: undefined, lastModified: { seconds: "1792402200" } } }, ...googleFixture.comments] })?.body).toBe("Newest feedback");
  });
  it.each([{}, { ...appleFixture, attributes: { ...appleFixture.attributes, rating: 6 } }])("rejects malformed store reviews", raw => {
    expect(() => mapAppleReview(raw)).toThrow("unreadable review");
    expect(() => mapGoogleReview(raw)).toThrow("unreadable review");
  });
  it.each([["PUBLISHED", "PUBLISHED"], ["PENDING_PUBLISH", "PENDING"], ["UNKNOWN_NEW_STATE", "UNKNOWN"], [undefined, "UNKNOWN"]])("maps Apple state %s", (raw, state) => expect(applePublishState(raw)).toBe(state));
  it("stops Apple pagination at the first known review without another request", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ data: [{ ...appleFixture, id: "new" }], links: { next: "https://api.appstoreconnect.apple.com/v1/apps/123/customerReviews?cursor=2" } })).mockResolvedValueOnce(json({ data: [appleFixture, { ...appleFixture, id: "older" }], links: { next: "https://api.appstoreconnect.apple.com/v1/apps/123/customerReviews?cursor=3" } }));
    vi.stubGlobal("fetch", fetcher); const seen = [];
    for await (const review of appleClient(apple, "123", transport).reviews(async r => r.externalReviewId === appleFixture.id)) seen.push(review.externalReviewId);
    expect(seen).toEqual(["new"]); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects cross-origin pagination before sending credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: [], links: { next: "https://slack.com/api/auth.test" } })); vi.stubGlobal("fetch", fetcher);
    await expect(async () => { for await (const r of appleClient(apple, "123", transport).reviews()) void r; }).rejects.toThrow("invalid review pagination");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("replaces an Apple reply with one POST and never deletes the previous response", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: { id: "response", attributes: { responseBody: "Thanks", state: "PENDING_PUBLISH" } } })); vi.stubGlobal("fetch", fetcher);
    expect(await appleClient(apple, "123", transport).reply("review", "Thanks", "old")).toMatchObject({ state: "PENDING" });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1].method).toBe("POST");
  });
  it("imports existing Apple responses from included resources", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ data: [{ ...appleFixture, relationships: { response: { data: { id: "reply", type: "customerReviewResponses" } } } }], included: [{ id: "reply", type: "customerReviewResponses", attributes: { responseBody: "Already replied", state: "PENDING_PUBLISH" } }] })); vi.stubGlobal("fetch", fetcher);
    const reviews = [];
    for await (const review of appleClient(apple, "123", transport).reviews()) reviews.push(review);
    expect(reviews[0].reply).toMatchObject({ body: "Already replied", state: "PENDING" }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reads all Google pages including known reviews so edits aren't lost", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ access_token: "mock-oauth", expires_in: 3600 })).mockResolvedValueOnce(json({ reviews: [googleFixture], tokenPagination: { nextPageToken: "page-two" } })).mockResolvedValueOnce(json({ reviews: [{ ...googleFixture, reviewId: "second" }] })); vi.stubGlobal("fetch", fetcher);
    const client = googleClient(google, "org.spaceworks.app", transport); const seen = [];
    for await (const r of client.reviews(async () => true)) seen.push(r.externalReviewId);
    expect(seen).toEqual(["google-review-1", "second"]); expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2][0]).toContain("token=page-two");
    expect(fetcher.mock.calls[0][1].body).toContain("grant_type=");
  });
  it("posts Google replies and caches the access token", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json({ access_token: "mock", expires_in: 3600 })).mockImplementation(async () => json({ result: { replyText: "Thanks", lastEdited: { seconds: "1792319400" } } })); vi.stubGlobal("fetch", fetcher);
    const client = googleClient(google, "org.spaceworks.app", transport);
    await client.reply("a/b", "Thanks"); await client.reply("another", "Thanks");
    expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[1][0]).toContain("a%2Fb:reply");
  });
  it.each(["http://api.appstoreconnect.apple.com", "https://example.test", "https://slack.com.evil.test", "https://user:password@slack.com", "https://slack.com:444"]) ("rejects an untrusted target %s", url => expect(() => officialUrl(url)).toThrow());
  it("requires an explicit direct-connection opt in", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("https://slack.com/api/auth.test", {}, { allowNoProxy: false })).rejects.toThrow("egress proxy"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("passes the configured proxy dispatcher to fetch without changing the official target", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ ok: true })); vi.stubGlobal("fetch", fetcher);
    await requestJson("https://api.appstoreconnect.apple.com/v1/apps", {}, { proxyUrl: "http://proxy.example.test:8080", allowNoProxy: false });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.appstoreconnect.apple.com/v1/apps");
    expect(fetcher.mock.calls[0][1].dispatcher).toBeDefined();
  });
  it("never returns remote credential-bearing errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-key-in-error", { status: 401 })));
    await expect(requestJson("https://slack.com/api/auth.test", {})).rejects.toThrow("refused access");
    expect(safeStoreError(new Error("private-key-in-error"))).not.toContain("private-key");
  });
  it("maps timeouts and disables redirects", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DOMException("hidden", "TimeoutError")); vi.stubGlobal("fetch", fetcher);
    await expect(requestJson("https://slack.com/api/auth.test", {})).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(fetcher.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
describe("reply validation", () => {
  it.each([["APPLE", 5970], ["GOOGLE", 350]] as const)("enforces %s limits by Unicode code point", (platform, limit) => {
    expect(validateReply(platform, "★".repeat(limit))).toBeNull();
    expect(validateReply(platform, "★".repeat(limit + 1))).toContain(String(limit));
    expect(validateReply(platform, "   ")).toBe("Write a reply first.");
    expect(replyLength("😀")).toBe(1);
  });
  it("validates app identifiers and poll intervals", () => {
    const app = { accountId: "account", platform: "APPLE", name: "Maker", appIdentifier: "123" };
    expect(appSchema.safeParse(app).success).toBe(true);
    expect(appSchema.safeParse({ ...app, appIdentifier: "org.app" }).success).toBe(false);
    expect(appSchema.safeParse({ ...app, pollIntervalMinutes: 0 }).success).toBe(false);
    expect(appSchema.safeParse({ ...app, platform: "GOOGLE", appIdentifier: "org.spaceworks.app" }).success).toBe(true);
  });
});
