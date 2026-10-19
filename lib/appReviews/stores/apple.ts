import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { validateReply } from "@/lib/appReviews/validation";
import { officialUrl, requestJson } from "./http";
import { StoreError, type PublishState, type StoreClient, type StoreReview, type Transport } from "./types";

const BASE = "https://api.appstoreconnect.apple.com";
export type AppleCredentials = { issuerId: string; keyId: string; privateKeyP8: string };
export function appleJwt(credentials: AppleCredentials, now = new Date()) {
  try {
    const key = createPrivateKey(credentials.privateKeyP8);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error();
    const seconds = Math.floor(now.getTime() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: credentials.issuerId, iat: seconds, exp: seconds + 19 * 60, aud: "appstoreconnect-v1" })).toString("base64url");
    const content = `${header}.${payload}`;
    return `${content}.${sign("sha256", Buffer.from(content), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
  } catch { throw new StoreError("AUTH", "Check the Apple issuer ID, key ID and P-256 private key."); }
}
export function applePublishState(state: unknown): PublishState {
  return state === "PUBLISHED" ? "PUBLISHED" : state === "PENDING_PUBLISH" ? "PENDING" : "UNKNOWN";
}
const appleReviewSchema = z.object({ id: z.string().min(1), attributes: z.object({ rating: z.number().int().min(1).max(5), title: z.string().nullish(), body: z.string(), reviewerNickname: z.string().nullish(), createdDate: z.string().datetime({ offset: true }), territory: z.string().nullish() }), relationships: z.object({ response: z.object({ data: z.object({ id: z.string(), type: z.literal("customerReviewResponses") }).nullish() }).optional() }).optional() });
export function mapAppleReview(raw: unknown): StoreReview {
  const parsed = appleReviewSchema.safeParse(raw);
  if (!parsed.success) throw new StoreError("INVALID", "Apple returned an unreadable review. Try again later.");
  const { id, attributes: a } = parsed.data;
  return { externalReviewId: id, author: a.reviewerNickname ?? "App Store reviewer", title: a.title ?? "", body: a.body, rating: a.rating, language: null, territory: a.territory ?? null, appVersion: null, storeCreatedAt: new Date(a.createdDate), storeUpdatedAt: new Date(a.createdDate) };
}
const responseSchema = z.object({ data: z.object({ id: z.string(), attributes: z.object({ responseBody: z.string(), state: z.string().optional(), lastModifiedDate: z.string().optional() }) }).nullable() });
function mapResponse(raw: unknown) {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new StoreError("INVALID", "Apple returned an unreadable reply state. Check again later.");
  const d = parsed.data.data;
  return d ? { body: d.attributes.responseBody, externalId: d.id, state: applePublishState(d.attributes.state), sentAt: d.attributes.lastModifiedDate ? new Date(d.attributes.lastModifiedDate) : null } : null;
}
export function appleClient(credentials: AppleCredentials, appId: string, transport: Transport): StoreClient {
  const call = <T>(path: string, init: RequestInit = {}) => requestJson<T>(path.startsWith("https:") ? path : `${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${appleJwt(credentials)}`, "Content-Type": "application/json" } }, transport);
  return {
    async *reviews(known, heartbeat) {
      let next: string | null = `${BASE}/v1/apps/${encodeURIComponent(appId)}/customerReviews?sort=-createdDate&limit=100&include=response`;
      const visited = new Set<string>();
      while (next) {
        await heartbeat?.();
        const url = officialUrl(next);
        if (url.origin !== BASE || url.pathname !== `/v1/apps/${encodeURIComponent(appId)}/customerReviews` || visited.has(next)) throw new StoreError("INVALID", "Apple returned invalid review pagination. Try again later.");
        visited.add(next);
        const page: { data: unknown[]; included?: unknown[]; links?: { next?: string } } = await call(next);
        if (!Array.isArray(page.data)) throw new StoreError("INVALID", "Apple returned an unreadable review list.");
        for (const item of page.data) {
          const review = mapAppleReview(item); if (await known?.(review)) return;
          const responseId = appleReviewSchema.parse(item).relationships?.response?.data?.id;
          if (responseId) {
            const included = page.included?.find(raw => typeof raw === "object" && raw !== null && "id" in raw && raw.id === responseId && "type" in raw && raw.type === "customerReviewResponses");
            const reply = included ? mapResponse({ data: included }) : await this.response(review.externalReviewId);
            if (reply) review.reply = reply;
          }
          yield review;
        }
        next = page.links?.next ?? null;
      }
    },
    async response(reviewId) {
      try { return mapResponse(await call(`/v1/customerReviews/${encodeURIComponent(reviewId)}/response`)); }
      catch (error) { if (error instanceof StoreError && error.code === "NOT_FOUND") return null; throw error; }
    },
    async reply(reviewId, body) {
      const invalid = validateReply("APPLE", body); if (invalid) throw new StoreError("INVALID", invalid);
      // Apple's create endpoint replaces an existing response atomically.
      const response = mapResponse(await call("/v1/customerReviewResponses", { method: "POST", body: JSON.stringify({ data: { type: "customerReviewResponses", attributes: { responseBody: body.trim() }, relationships: { review: { data: { type: "customerReviews", id: reviewId } } } } }) }));
      if (!response) throw new StoreError("INVALID", "Apple didn't return a reply. Check the store before sending again.");
      return response;
    },
  };
}
