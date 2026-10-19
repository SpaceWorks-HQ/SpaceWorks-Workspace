/**
 * RSS 2.0 and sitemap XML for the public blog (pure). Every text node and
 * attribute is escaped; control characters that XML 1.0 forbids are removed.
 */

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

export function escapeXml(value: string): string {
  return value
    .replace(INVALID_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export type FeedItem = { title: string; url: string; description: string; publishedAt: Date; author?: string | null };

export function buildRssFeed(channel: { title: string; url: string; feedUrl: string; description: string; language?: string; updatedAt?: Date }, items: FeedItem[]): string {
  const lastBuild = channel.updatedAt ?? items[0]?.publishedAt ?? new Date(0);
  const entries = items
    .map(
      (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.url)}</link>
      <guid isPermaLink="true">${escapeXml(item.url)}</guid>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
      <description>${escapeXml(item.description)}</description>${item.author ? `\n      <dc:creator>${escapeXml(item.author)}</dc:creator>` : ""}
    </item>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <link>${escapeXml(channel.url)}</link>
    <description>${escapeXml(channel.description)}</description>
    <language>${escapeXml(channel.language ?? "en")}</language>
    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(channel.feedUrl)}" rel="self" type="application/rss+xml"/>
${entries}
  </channel>
</rss>
`;
}

export function buildSitemap(urls: Array<{ url: string; lastModified?: Date }>): string {
  const body = urls
    .map((entry) => `  <url>\n    <loc>${escapeXml(entry.url)}</loc>${entry.lastModified ? `\n    <lastmod>${entry.lastModified.toISOString()}</lastmod>` : ""}\n  </url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function buildSitemapIndex(urls: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <sitemap><loc>${escapeXml(url)}</loc></sitemap>`).join("\n")}
</sitemapindex>
`;
}
