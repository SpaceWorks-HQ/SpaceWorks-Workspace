import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { canManageAppReviews, canViewAppReviews } from "@/lib/roles";
import { listPickableDestinations, getScopedDestinationIds } from "@/lib/notify/scopedRules";
import { filtersSchema } from "./validation";
import { parseRuleFilters } from "@/lib/notify/match";

export const appSelect = { id: true, name: true, platform: true } as const;
export function reviewWhere(workspaceId: string, raw: unknown): Prisma.AppReviewWhereInput {
  const f = filtersSchema.parse(raw);
  return { workspaceId, ...(f.app ? { appId: f.app } : {}), ...(f.platform ? { platform: f.platform } : {}), ...(f.rating ? { rating: f.rating } : {}), ...(f.status ? { status: f.status } : {}), ...(f.language ? { language: f.language } : {}), ...(f.replied === "yes" ? { replyStatus: "SENT" } : f.replied === "no" ? { replyStatus: { not: "SENT" } } : {}), ...(f.q ? { OR: ["body", "title", "author"].map(field => ({ [field]: { contains: f.q, mode: "insensitive" } })) } : {}) };
}
export async function listReviews(ctx: WorkspaceContext, raw: unknown = {}) {
  if (!canViewAppReviews(ctx.membership)) return null;
  const parsed = filtersSchema.safeParse(raw); if (!parsed.success) return null;
  const f = parsed.data; const where = reviewWhere(ctx.workspace.id, f);
  const orderBy: Prisma.AppReviewOrderByWithRelationInput[] = f.sort === "lowest" || f.sort === "highest" ? [{ rating: f.sort === "lowest" ? "asc" : "desc" }, { storeCreatedAt: "desc" }, { id: "asc" }] : [{ storeCreatedAt: f.sort === "oldest" ? "asc" : "desc" }, { id: "asc" }];
  const [reviews, total, apps] = await Promise.all([
    prisma.appReview.findMany({ where, include: { app: { select: appSelect } }, orderBy, skip: (f.page - 1) * 30, take: 30 }),
    prisma.appReview.count({ where }), prisma.reviewedApp.findMany({ where: { workspaceId: ctx.workspace.id }, select: appSelect, orderBy: { name: "asc" } }),
  ]);
  return { reviews, total, apps, filters: f };
}
export async function getReview(ctx: WorkspaceContext, id: string) {
  if (!canViewAppReviews(ctx.membership)) return null;
  return prisma.appReview.findFirst({ where: { workspaceId: ctx.workspace.id, id }, include: { app: { select: appSelect }, attempts: { where: { workspaceId: ctx.workspace.id }, orderBy: { createdAt: "desc" }, take: 50 } } });
}
export async function reviewMembers(ctx: WorkspaceContext) {
  if (!canViewAppReviews(ctx.membership)) return [];
  return prisma.membership.findMany({ where: { workspaceId: ctx.workspace.id, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { userId: true, user: { select: { name: true, email: true } } }, orderBy: { user: { name: "asc" } } });
}
export async function reviewSettings(ctx: WorkspaceContext) {
  if (!canManageAppReviews(ctx.membership)) return null;
  const workspaceId = ctx.workspace.id;
  const [accounts, apps, slack, destinations, projects, services, slackMembers, members] = await Promise.all([
    prisma.appStoreAccount.findMany({ where: { workspaceId }, select: { id: true, platform: true, name: true, active: true, lastError: true }, orderBy: { name: "asc" } }),
    prisma.reviewedApp.findMany({ where: { workspaceId }, select: { id: true, accountId: true, platform: true, name: true, appIdentifier: true, active: true, allowNoProxy: true, pollIntervalMinutes: true, slackChannelId: true, lastPolledAt: true, lastError: true, linkedProjectId: true, linkedServiceId: true, translationLanguage: true }, orderBy: { name: "asc" } }),
    prisma.appReviewSlackConfig.findUnique({ where: { workspaceId }, select: { active: true, teamId: true, replyTriggerEmoji: true } }),
    listPickableDestinations(workspaceId, ctx.membership.role),
    prisma.project.findMany({ where: { workspaceId, status: { not: "ARCHIVED" } }, select: { id: true, name: true } }),
    prisma.serviceCatalogItem.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
    prisma.appReviewSlackMember.findMany({ where: { workspaceId }, select: { slackUserId: true, userId: true } }), reviewMembers(ctx),
  ]);
  return { accounts, apps: await Promise.all(apps.map(async a => {
    const rule = await prisma.notificationRule.findUnique({ where: { workspaceId_scopeType_scopeId: { workspaceId, scopeType: "REVIEWED_APP", scopeId: a.id } }, select: { filters: true } });
    return { ...a, routingRatings: parseRuleFilters(rule?.filters).ratings ?? [], destinationIds: await getScopedDestinationIds(workspaceId, "REVIEWED_APP", a.id) };
  })), slack, destinations, projects, services, slackMembers, members };
}
export async function reviewInsights(ctx: WorkspaceContext, days = 90) {
  if (!canViewAppReviews(ctx.membership)) return null;
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 365)) * 86_400_000);
  const workspaceId = ctx.workspace.id;
  const [summary, daily, distribution, volumes] = await Promise.all([
    prisma.$queryRaw<{ total: number; average: number | null; replied: number; medianMinutes: number | null }[]>`SELECT count(*)::int AS total, avg(rating)::float AS average, count(*) FILTER (WHERE "replyStatus" = 'SENT')::int AS replied, (percentile_cont(0.5) WITHIN GROUP (ORDER BY greatest(0, extract(epoch FROM ("replySentAt" - "storeCreatedAt"))/60)) FILTER (WHERE "replyStatus" = 'SENT' AND "replySentAt" IS NOT NULL))::float AS "medianMinutes" FROM "AppReview" WHERE "workspaceId" = ${workspaceId} AND "storeCreatedAt" >= ${since}`,
    prisma.$queryRaw<{ day: string; total: number; average: number }[]>`SELECT to_char("storeCreatedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${ctx.workspace.timezone}, 'YYYY-MM-DD') AS day, count(*)::int AS total, avg(rating)::float AS average FROM "AppReview" WHERE "workspaceId" = ${workspaceId} AND "storeCreatedAt" >= ${since} GROUP BY day ORDER BY day`,
    prisma.appReview.groupBy({ by: ["rating"], where: { workspaceId, storeCreatedAt: { gte: since } }, _count: true, orderBy: { rating: "asc" } }),
    prisma.appReview.groupBy({ by: ["appId", "platform", "appVersion"], where: { workspaceId, storeCreatedAt: { gte: since } }, _count: true }),
  ]);
  const apps = await prisma.reviewedApp.findMany({ where: { workspaceId }, select: appSelect });
  return { summary: summary[0]!, daily, distribution, volumes: volumes.map(v => ({ ...v, appName: apps.find(a => a.id === v.appId)?.name ?? "Removed app" })) };
}
