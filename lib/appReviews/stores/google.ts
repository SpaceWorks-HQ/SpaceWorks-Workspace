import "server-only";
import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import { validateReply } from "@/lib/appReviews/validation";
import { requestJson } from "./http";
import { StoreError, type StoreClient, type StoreReview, type Transport } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const credentialsSchema = z.object({ client_email: z.string().email(), private_key: z.string().min(1), type: z.literal("service_account") });
export function googleCredentials(json: string) {
  try { const credentials = credentialsSchema.parse(JSON.parse(json)); const key = createPrivateKey(credentials.private_key); if (key.asymmetricKeyType !== "rsa") throw new Error(); return credentials; }
  catch { throw new StoreError("AUTH", "Upload a valid Google service account JSON key."); }
}
export function googleAssertion(json: string, now = new Date()) {
  const credentials = googleCredentials(json); const seconds = Math.floor(now.getTime() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: seconds, exp: seconds + 3600 })).toString("base64url");
  const content = `${header}.${payload}`;
  return `${content}.${sign("RSA-SHA256", Buffer.from(content), credentials.private_key).toString("base64url")}`;
}
const timestamp = z.object({ seconds: z.union([z.string(), z.number()]), nanos: z.number().optional() });
const googleReviewSchema = z.object({ reviewId: z.string(), authorName: z.string().optional(), comments: z.array(z.object({ userComment: z.object({ text: z.string(), originalText: z.string().optional(), starRating: z.number().int().min(1).max(5), reviewerLanguage: z.string().optional(), appVersionName: z.string().optional(), lastModified: timestamp }).optional(), developerComment: z.object({ text: z.string(), lastModified: timestamp }).optional() })) });
function dateFrom(value: z.infer<typeof timestamp>) { const d = new Date(Number(value.seconds) * 1000 + (value.nanos ?? 0) / 1e6); if (!Number.isFinite(d.getTime())) throw new StoreError("INVALID", "Google returned an invalid review date."); return d; }
export function mapGoogleReview(raw: unknown): StoreReview | null {
  const parsed = googleReviewSchema.safeParse(raw); if (!parsed.success) throw new StoreError("INVALID", "Google returned an unreadable review. Try again later.");
  const r = parsed.data; const user = r.comments.flatMap(c => c.userComment ? [c.userComment] : []).sort((a, b) => dateFrom(a.lastModified).getTime() - dateFrom(b.lastModified).getTime()).at(-1); if (!user) return null;
  const developer = r.comments.flatMap(c => c.developerComment ? [c.developerComment] : []).sort((a, b) => dateFrom(a.lastModified).getTime() - dateFrom(b.lastModified).getTime()).at(-1);
  return { externalReviewId: r.reviewId, author: r.authorName ?? "Google Play reviewer", title: "", body: user.originalText ?? user.text, rating: user.starRating, language: user.reviewerLanguage ?? null, territory: null, appVersion: user.appVersionName ?? null, storeCreatedAt: dateFrom(user.lastModified), storeUpdatedAt: dateFrom(user.lastModified), ...(developer ? { reply: { body: developer.text, externalId: null, state: "PUBLISHED", sentAt: dateFrom(developer.lastModified) } } : {}) };
}
export function googleClient(json: string, packageName: string, transport: Transport, translationLanguage?: string | null): StoreClient {
  let token: string | null = null; let expiresAt = 0;
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/reviews`;
  async function accessToken() {
    if (token && Date.now() < expiresAt) return token;
    const response = await requestJson<{ access_token: string; expires_in: number }>(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: googleAssertion(json) }).toString() }, transport);
    if (typeof response.access_token !== "string" || !Number.isFinite(response.expires_in)) throw new StoreError("AUTH", "Google didn't issue an access token. Check the service account.");
    token = response.access_token; expiresAt = Date.now() + Math.max(0, response.expires_in - 60) * 1000; return token;
  }
  const call = async <T>(url: string, init: RequestInit = {}) => requestJson<T>(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" } }, transport);
  return {
    async *reviews(_known, heartbeat) {
      void _known;
      let next: string | undefined; const visited = new Set<string>();
      do {
        await heartbeat?.();
        const query = new URLSearchParams({ maxResults: "100" }); if (next) query.set("token", next); if (translationLanguage) query.set("translationLanguage", translationLanguage);
        const page = await call<{ reviews?: unknown[]; tokenPagination?: { nextPageToken?: string } }>(`${base}?${query}`);
        for (const raw of page.reviews ?? []) { const review = mapGoogleReview(raw); if (review) yield review; }
        next = page.tokenPagination?.nextPageToken; if (next && visited.has(next)) throw new StoreError("INVALID", "Google returned invalid review pagination."); if (next) visited.add(next);
        // Google orders by modification and returns a rolling week. Read every page to capture edits.
      } while (next);
    },
    async response(reviewId) {
      const raw = await call<unknown>(`${base}/${encodeURIComponent(reviewId)}`); return mapGoogleReview(raw)?.reply ?? null;
    },
    async reply(reviewId, body) {
      const invalid = validateReply("GOOGLE", body); if (invalid) throw new StoreError("INVALID", invalid);
      const raw = await call<{ result?: { replyText: string; lastEdited: z.infer<typeof timestamp> } }>(`${base}/${encodeURIComponent(reviewId)}:reply`, { method: "POST", body: JSON.stringify({ replyText: body.trim() }) });
      if (!raw.result || typeof raw.result.replyText !== "string") throw new StoreError("INVALID", "Google didn't return a reply. Check the store before sending again.");
      return { body: raw.result.replyText, externalId: null, state: "PUBLISHED", sentAt: dateFrom(raw.result.lastEdited) };
    },
  };
}
