import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { canConnectSocial } from "@/lib/roles";
import { filterSchema, socialOverview } from "@/lib/social/queries";
import { PLATFORM_LABELS } from "@/lib/social/config";
import { SocialNav, AccountStatus } from "@/components/social/SocialNav";
import { MetricChart } from "@/components/social/MetricChart";
import { PostTable } from "@/components/social/PostTable";
import { Card } from "@/components/ui/display";
import { Field, Dropdown } from "@/components/ui/field";
import { Button, buttonClasses } from "@/components/ui/button";
import { formatDayTime } from "@/lib/format/datetime";
export default async function SocialAccountPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/social/accounts/[accountId]">) {
  const { workspaceSlug, accountId } = await params; const ctx = await requireWorkspace(workspaceSlug, "MEMBER"); const raw = await searchParams;
  const f = filterSchema.parse({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v !== "")), account: accountId }); const data = await socialOverview(ctx, f); const account = data?.accounts[0]; if (!account || !data) notFound();
  const sorts = ["publishedAt", "likes", "comments", "shares", "views", "reach"] as const; const sort = sorts.find(v => v === raw.sort) ?? "publishedAt";
  const where = { workspaceId: ctx.workspace.id, accountId }; const [posts, total] = await Promise.all([prisma.socialPost.findMany({ where, orderBy: sort === "publishedAt" ? { publishedAt: "desc" } : { [sort]: { sort: "desc", nulls: "last" } }, take: 50, skip: (f.page - 1) * 50 }), prisma.socialPost.count({ where })]);
  return <div className="min-w-0 space-y-5"><SocialNav slug={workspaceSlug} active="account" admin={canConnectSocial(ctx.membership)} /><Card><p className="text-caption text-ink-muted">{PLATFORM_LABELS[account.platform]} {account.handle ? `· ${account.handle}` : ""}</p><h2 className="my-2 text-h2">{account.displayName}</h2><AccountStatus status={account.status} /><p className="mt-3 text-caption text-ink-muted">Last complete sync: {account.lastSyncedAt ? formatDayTime(account.lastSyncedAt, ctx.workspace.timezone) : "Waiting for sync"}</p>{account.lastError ? <p className="mt-2 text-body-ui text-danger-fg">{account.lastError}</p> : null}{account.warnings.length ? <details className="mt-3"><summary className="cursor-pointer py-2 text-label">Data availability</summary><ul className="list-disc space-y-2 pl-5 text-caption text-ink-muted">{account.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}</Card><form className="flex flex-wrap items-end gap-3"><Field label="Metrics period"><Dropdown name="days" defaultValue={f.days}>{[7, 28, 90].map(d => <option key={d} value={d}>{d} days</option>)}</Dropdown></Field><Field label="Sort posts"><Dropdown name="sort" defaultValue={sort}>{sorts.map(v => <option value={v} key={v}>{v === "publishedAt" ? "Newest first" : `${v} (highest first)`}</option>)}</Dropdown></Field><Button type="submit" variant="secondary">Apply</Button></form><MetricChart daily={data.daily} /><h2 className="text-h4">Posts</h2>{posts.length ? <PostTable posts={posts} timezone={ctx.workspace.timezone} caption="All synced posts" /> : <Card>No posts synced yet. Check the connection status above.</Card>}<nav aria-label="Post pages" className="flex flex-wrap items-center gap-3">{f.page > 1 ? <Link className={buttonClasses()} href={`?days=${f.days}&sort=${sort}&page=${f.page - 1}`}>Previous</Link> : null}<span className="text-label">Page {f.page} · {total} posts</span>{f.page * 50 < total ? <Link className={buttonClasses()} href={`?days=${f.days}&sort=${sort}&page=${f.page + 1}`}>Next</Link> : null}</nav></div>;
}
