import { z } from "zod";

export const platformSchema = z.enum(["APPLE", "GOOGLE"]);
export const statusSchema = z.enum(["NEW", "IN_PROGRESS", "DONE", "IGNORED"]);
const id = z.string().trim().min(1).max(100);
const optionalId = z.string().trim().max(100).nullish();
const secret = z.string().trim().max(30_000).optional();
export const proxySchema = z.string().trim().max(2000).refine((value) => {
  if (!value) return true;
  try { const u = new URL(value); return ["http:", "https:"].includes(u.protocol) && u.pathname === "/" && !u.search && !u.hash; } catch { return false; }
}, "Use an HTTP or HTTPS proxy URL without a path.");
export const accountSchema = z.object({
  id: id.optional(), name: z.string().trim().min(1).max(100), platform: platformSchema,
  issuerId: secret, keyId: secret, privateKeyP8: secret, serviceAccountJson: secret,
  proxyUrl: proxySchema.optional(), clearProxy: z.boolean().default(false), active: z.boolean().default(true),
});
export const appSchema = z.object({
  id: id.optional(), accountId: id, name: z.string().trim().min(1).max(100), platform: platformSchema,
  appIdentifier: z.string().trim().min(1).max(250), active: z.boolean().default(true),
  pollIntervalMinutes: z.coerce.number().int().min(5).max(1440).default(15),
  allowNoProxy: z.boolean().default(false), proxyUrl: proxySchema.optional(), clearProxy: z.boolean().default(false),
  slackChannelId: z.string().trim().max(100).regex(/^[CG][A-Z0-9]+$|^$/, "Enter a Slack channel ID.").optional(),
  linkedProjectId: optionalId, linkedServiceId: optionalId,
  translationLanguage: z.string().trim().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$|^$/, "Enter a language code such as en.").optional(),
  destinationIds: z.array(id).max(50).default([]),
  routingRatings: z.array(z.number().int().min(1).max(5)).max(5).default([]),
}).superRefine((v, ctx) => {
  if (!(v.platform === "APPLE" ? /^\d+$/.test(v.appIdentifier) : /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(v.appIdentifier))) ctx.addIssue({ code: "custom", path: ["appIdentifier"], message: "Enter the numeric Apple app ID or Google package name." });
});
export const REPLY_LIMITS = { APPLE: 5970, GOOGLE: 350 } as const;
export function replyLength(body: string) { return Array.from(body).length; }
export function validateReply(platform: "APPLE" | "GOOGLE", body: string) {
  if (!body.trim()) return "Write a reply first.";
  if (replyLength(body.trim()) > REPLY_LIMITS[platform]) return `Keep your reply within ${REPLY_LIMITS[platform]} characters.`;
  return null;
}
export const replySchema = z.object({ reviewId: id, body: z.string().trim().min(1).max(12_000), triggerKey: z.string().uuid() });
export const triageSchema = z.object({ reviewId: id, status: statusSchema, assigneeId: optionalId, tags: z.array(z.string().trim().min(1).max(40)).max(20) });
export const filtersSchema = z.object({
  app: z.string().max(100).optional(), platform: platformSchema.optional(), rating: z.coerce.number().int().min(1).max(5).optional(),
  status: statusSchema.optional(), replied: z.enum(["yes", "no"]).optional(), language: z.string().max(30).optional(),
  q: z.string().trim().max(200).optional(), sort: z.enum(["newest", "oldest", "lowest", "highest"]).default("newest"), page: z.coerce.number().int().min(1).max(10000).default(1),
});
export const slackConfigSchema = z.object({ botToken: secret, signingSecret: secret, replyTriggerEmoji: z.string().trim().regex(/^[a-z0-9_+-]{1,80}$/).default("white_check_mark"), active: z.boolean().default(true) });
export const slackMemberSchema = z.object({ slackUserId: z.string().max(100).regex(/^[UW][A-Z0-9]+$/), userId: id });
