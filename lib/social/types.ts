import type { SocialAccount, SocialPlatform } from "@prisma/client";
export type Metrics = Partial<Record<"likes" | "comments" | "shares" | "views" | "impressions" | "reach", number>> & Record<string, number | undefined>;
export type RemotePost = { externalId: string; url?: string; text: string; mediaType: string; publishedAt: Date; metrics: Metrics };
export type RemoteComment = { externalId: string; postExternalId: string; parentExternalId?: string; authorName: string; authorHandle?: string; authorAvatarUrl?: string; text: string; publishedAt: Date; likeCount: number; hidden?: boolean; ours?: boolean };
export type DailyMetric = { date: Date; metric: string; value: number };
export type Snapshot = { posts: RemotePost[]; comments: RemoteComment[]; metrics: DailyMetric[]; warnings: string[]; cursor: Record<string, string>; metricsComplete: boolean; error?: Error };
export type Candidate = { platform: SocialPlatform; externalId: string; parentExternalId?: string; displayName: string; handle?: string; avatarUrl?: string; token: string; refreshToken?: string; expiresAt?: string; scopes: string[] };
export type SyncInput = { account: SocialAccount; token: string; daily: boolean; now: Date; recentPosts: { externalId: string; publishedAt: Date }[] };
export const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
export const string = (v: unknown, fallback = ""): string => typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
export const number = (v: unknown): number | undefined => (typeof v === "number" || typeof v === "string" && v.trim() !== "") && Number.isFinite(Number(v)) ? Number(v) : undefined;
export function date(v: unknown): Date { const d = new Date(typeof v === "number" ? v : string(v)); if (!Number.isFinite(d.getTime())) throw new Error("The platform returned an invalid date. Try syncing again."); return d; }
export const day = (d: Date) => new Date(d.toISOString().slice(0, 10));
export function cleanMetrics(values: Metrics): Record<string, number> { return Object.fromEntries(Object.entries(values).filter((p): p is [string, number] => typeof p[1] === "number" && Number.isFinite(p[1]))); }
export function snapshot(): Snapshot { return { posts: [], comments: [], metrics: [], warnings: [], cursor: {}, metricsComplete: false }; }
export async function section(out: Snapshot, label: string, run: () => Promise<void>) {
  try { await run(); } catch (e) { const error = e instanceof Error ? e : new Error("The platform could not finish syncing."); out.warnings.push(`${label}: ${error.message}`); const priority: Record<string, number> = { TOKEN: 4, RATE_LIMIT: 3, ACCESS: 2 };
    if (!out.error || (priority[string((error as { kind?: string }).kind)] ?? 1) > (priority[string((out.error as { kind?: string }).kind)] ?? 1)) out.error = error; }
}
