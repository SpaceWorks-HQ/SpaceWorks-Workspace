/**
 * Blog rules (pure, client-safe): post slugs, SEO length hints, status words
 * and plain-text helpers.
 *
 * Post states:
 * - Draft: status DRAFT, publishedAt null.
 * - Scheduled: status DRAFT with publishedAt in the future; the finance-blog
 *   job publishes it when publishedAt passes.
 * - Published: status PUBLISHED and publishedAt ≤ now. Only these are public.
 * Unpublishing clears publishedAt, so a draft never publishes itself.
 */

import { slugify, slugPattern, withSlugSuffix } from "@/lib/slug";

export const POSTS_PER_PAGE = 10;
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;
export const EXCERPT_MAX = 300;
export const TITLE_MAX = 150;
export const MAX_POST_HTML = 500_000;

/** Paths under /blog/<workspace>/ that are routes, not posts. */
export const RESERVED_POST_SLUGS: ReadonlySet<string> = new Set(["rss", "feed", "sitemap", "page", "cover", "preview", "new", "edit"]);

export function postSlugFromTitle(title: string): string {
  return slugify(title, "post");
}

/** null when fine, else a UI-safe reason. */
export function postSlugProblem(slug: string): string | null {
  if (!slug) return "Enter a web address for the post.";
  if (!slugPattern.test(slug)) return "Use lowercase letters, numbers and single hyphens, up to 60 characters.";
  if (RESERVED_POST_SLUGS.has(slug)) return "That address is reserved. Pick another.";
  return null;
}

/** First free slug: `base`, `base-2`, `base-3`, … (never reserved, always ≤ 60 chars). */
export function uniquePostSlug(base: string, taken: ReadonlySet<string>): string {
  const root = RESERVED_POST_SLUGS.has(base) ? `${base}-post` : base;
  for (let n = 0; n < 10_000; n += 1) {
    const suffix = n === 0 ? 0 : n + 1;
    const tail = suffix ? `-${suffix}` : "";
    const candidate = withSlugSuffix(root.slice(0, 60 - tail.length).replace(/-+$/, ""), suffix);
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 50)}-${Date.now().toString(36)}`;
}

export type PostStatusWord = "Draft" | "Scheduled" | "Published";

export function postState(post: { status: "DRAFT" | "PUBLISHED"; publishedAt: Date | null }, now: Date = new Date()): PostStatusWord {
  if (post.status === "PUBLISHED") return post.publishedAt && post.publishedAt > now ? "Scheduled" : "Published";
  // A draft with a date is waiting for the job (even if the minute just passed).
  return post.publishedAt ? "Scheduled" : "Draft";
}

export type LengthHint = { length: number; max: number; tone: "ok" | "short" | "long"; message: string };

/** Friendly length hint for SEO fields: search engines cut longer text. */
export function seoLengthHint(value: string, max: number, min = Math.round(max / 2)): LengthHint {
  const length = value.trim().length;
  if (length === 0) return { length, max, tone: "short", message: `Empty: the ${max === SEO_TITLE_MAX ? "post title" : "excerpt"} is used instead.` };
  if (length > max) return { length, max, tone: "long", message: `${length} of ${max} characters. Search results will cut it off.` };
  if (length < min) return { length, max, tone: "short", message: `${length} of ${max} characters. A little more helps people choose it.` };
  return { length, max, tone: "ok", message: `${length} of ${max} characters. Good length.` };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Sanitised HTML → plain text (block tags become spaces). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|h[1-6]|li|ul|ol|blockquote|pre|br|hr|div)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Excerpt (or the opening of the body) trimmed on a word boundary. */
export function summarise(text: string, max = SEO_DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`;
}

/** About 220 words a minute, at least one. */
export function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
