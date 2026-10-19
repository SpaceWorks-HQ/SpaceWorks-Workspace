export class StoreError extends Error {
  constructor(readonly code: "AUTH" | "TIMEOUT" | "NETWORK" | "RATE_LIMIT" | "NOT_FOUND" | "INVALID" | "PROXY_REQUIRED" | "STORE", message: string) {
    super(message); this.name = "StoreError";
  }
}
export function safeStoreError(error: unknown): string {
  return error instanceof StoreError ? error.message : "Couldn't contact the store. Check your connection and try again.";
}
export type PublishState = "PUBLISHED" | "PENDING" | "UNKNOWN";
export type StoreReply = { body: string; externalId: string | null; state: PublishState; sentAt: Date | null };
export type StoreReview = {
  externalReviewId: string; author: string; title: string; body: string; rating: number;
  language: string | null; territory: string | null; appVersion: string | null;
  storeCreatedAt: Date; storeUpdatedAt: Date; reply?: StoreReply;
};
export type StoreClient = {
  reviews: (known?: (review: StoreReview) => Promise<boolean>, heartbeat?: () => Promise<void>) => AsyncGenerator<StoreReview>;
  reply: (reviewId: string, body: string, previousId?: string | null) => Promise<StoreReply>;
  response: (reviewId: string) => Promise<StoreReply | null>;
};
export type Transport = { proxyUrl?: string | null; allowNoProxy: boolean };
