import type { SocialPlatform } from "@prisma/client";
// Pinned contract; review before upgrading: https://developers.facebook.com/docs/graph-api/changelog/
export const META_VERSION = "v24.0";
// A supported version, explicitly pinned: https://learn.microsoft.com/linkedin/marketing/versioning
export const LINKEDIN_VERSION = "202605";
export const PLATFORM_LABELS: Record<SocialPlatform, string> = { YOUTUBE: "YouTube", FACEBOOK: "Facebook", INSTAGRAM: "Instagram", LINKEDIN: "LinkedIn", X: "X (Twitter)" };
export const PLATFORMS = Object.keys(PLATFORM_LABELS) as SocialPlatform[];
export const SCOPES: Record<SocialPlatform, string[]> = {
  YOUTUBE: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly", "https://www.googleapis.com/auth/youtube.force-ssl"],
  FACEBOOK: ["pages_show_list", "pages_read_engagement", "pages_read_user_content", "pages_manage_engagement", "read_insights", "business_management"],
  INSTAGRAM: ["pages_show_list", "pages_read_engagement", "instagram_basic", "instagram_manage_insights", "instagram_manage_comments", "business_management"],
  LINKEDIN: ["rw_organization_admin", "r_organization_social", "w_organization_social", "r_organization_social_feed", "w_organization_social_feed"],
  X: ["tweet.read", "users.read", "offline.access", "tweet.write"],
};
export const REPLY_LIMITS: Record<SocialPlatform, number> = { YOUTUBE: 10000, FACEBOOK: 8000, INSTAGRAM: 2200, LINKEDIN: 1250, X: 280 };
// Conservative weighted X count: https://docs.x.com/fundamentals/counting-characters
export function replyLength(platform: SocialPlatform, text: string) {
  if (platform !== "X") return Array.from(text).length;
  const normal = text.normalize("NFC").replace(/https?:\/\/[^\s]+/gu, "x".repeat(23));
  return Array.from(normal).reduce((total, char) => { const c = char.codePointAt(0)!; return total + (c <= 0x10ff || c >= 0x2000 && c <= 0x200d || c >= 0x2010 && c <= 0x201f || c >= 0x2032 && c <= 0x2037 ? 1 : 2); }, 0);
}
export function replyError(platform: SocialPlatform, text: string) { return !text.trim() ? "Write a reply first." : replyLength(platform, text) > REPLY_LIMITS[platform] ? `Keep the reply within ${REPLY_LIMITS[platform]} characters (${platform === "X" ? "weighted" : "including spaces"}).` : null; }
export function moderationActions(platform: SocialPlatform): readonly string[] { return platform === "YOUTUBE" ? ["hide", "unhide", "reject"] : platform === "FACEBOOK" || platform === "INSTAGRAM" ? ["hide", "unhide", "delete"] : []; }
