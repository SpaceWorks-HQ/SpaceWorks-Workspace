import type { MetadataRoute } from "next";

/** Internal tool: nothing is crawlable except the public blog. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/blog/", disallow: "/" } };
}
