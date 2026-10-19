import "server-only";
import type { AppReview } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { dispatch } from "@/lib/notify";
export function reviewUrl(slug: string, id: string) { return `/w/${encodeURIComponent(slug)}/app-reviews/${encodeURIComponent(id)}`; }
export function reviewEvent(review: AppReview, app: { name: string; id: string }, slug: string, type: "app_review.received" | "app_review.replied" | "app_review.reply_failed", key: string, tx: DbClient) {
  const link = reviewUrl(slug, review.id);
  return dispatch(review.workspaceId, {
    type, title: `${app.name}: ${type === "app_review.received" ? `${review.rating} out of 5 review` : type === "app_review.replied" ? "Reply published" : "Reply couldn't be sent"}`.slice(0, 150),
    body: review.body.slice(0, 300), url: link, resource: { type: "app_review", id: review.id },
    scope: { reviewedAppId: app.id, rating: review.rating, tags: review.tags },
    fields: [{ label: "Rating", value: `${review.rating} out of 5` }, { label: "Platform", value: review.platform === "APPLE" ? "App Store" : "Google Play" }],
    dedupeKey: key, threadKey: `app-review:${review.id}`,
    data: { app: app.name, platform: review.platform, rating: review.rating, author: review.author, excerpt: review.body.slice(0, 300), link },
  }, { tx });
}
