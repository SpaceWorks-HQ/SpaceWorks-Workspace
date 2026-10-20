import type { MetadataRoute } from "next";

/** Internal tool: no pages are crawlable. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
