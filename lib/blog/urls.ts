/** Public blog addresses (client-safe). */

export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3100").replace(/\/+$/, "");
}

export const blogPath = (workspaceSlug: string) => `/blog/${workspaceSlug}`;
export const postPath = (workspaceSlug: string, postSlug: string) => `/blog/${workspaceSlug}/${postSlug}`;
export const feedPath = (workspaceSlug: string) => `/blog/${workspaceSlug}/rss.xml`;
export const sitemapPath = (workspaceSlug: string) => `/blog/${workspaceSlug}/sitemap.xml`;
/** The cover route only ever serves a published post's cover; `v` busts caches when it changes. */
export const coverPath = (workspaceSlug: string, postSlug: string, coverFileId: string) => `/blog/${workspaceSlug}/${postSlug}/cover?v=${encodeURIComponent(coverFileId)}`;

export const absolute = (path: string) => `${siteOrigin()}${path}`;
