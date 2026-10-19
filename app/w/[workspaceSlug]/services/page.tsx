import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card, EmptyState } from "@/components/ui/display";
import { ServicesNav, Status, Sparkline, UptimeBars } from "@/components/services/Display";
import { formatDayTime } from "@/lib/format/datetime";
import { checkerHealth } from "@/lib/monitor/scheduler";
import { dailyBars, mergeRollups, formatUptime, uptimePercent } from "@/lib/monitor/stats";
import { Input } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services">) {
 const { workspaceSlug } = await params, query = await searchParams;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
 if (!canViewServices(membership)) notFound();
 const manage = canManageServices(membership), costs = canViewCosts(membership, workspace), now = new Date();
 const q = typeof query.q === "string" ? query.q.slice(0, 100) : "", state = typeof query.status === "string" ? query.status : "";
 const monitors = await prisma.monitor.findMany({ where: { workspaceId: workspace.id, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 200, select: { id: true, name: true, type: true, tags: true, lastStatus: true, lastLatencyMs: true, rollups: { where: { workspaceId: workspace.id, granularity: "DAY", bucketStart: { gte: new Date(now.getTime() - 90 * 86400000) } }, orderBy: { bucketStart: "asc" } } } });
 const visible = monitors.filter(m => !state || m.lastStatus === state);
 const health = await checkerHealth();
 const incidents = await prisma.incident.count({ where: { workspaceId: workspace.id, status: { not: "RESOLVED" } } });
 return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-h1">Services</h1><p className="text-body-ui text-ink-muted">Keep an eye on the services the crew depends on.</p></div>{manage ? <Link className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-on-primary" href={`/w/${workspaceSlug}/services/monitors/new`}>Add monitor</Link> : null}</div>
 <ServicesNav slug={workspaceSlug} manage={manage} costs={costs} />
 {health.offline ? <div role="alert" className="rounded-lg bg-danger-bg p-4 text-danger-fg">Checker offline{health.lastHeartbeatAt ? ` since ${formatDayTime(health.lastHeartbeatAt, workspace.timezone)}` : ". No checker heartbeat yet"}. Ask an admin to check the worker.</div> : null}
 <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{["UP", "DEGRADED", "DOWN"].map(status => <Card key={status}><Status status={status} /><p className="mt-3 text-h2 tabular-nums">{monitors.filter(m => m.lastStatus === status).length}</p></Card>)}<Card><p className="text-label">Open incidents</p><p className="mt-3 text-h2 tabular-nums">{incidents}</p></Card></div>
 <form className="flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-label">Find a monitor<Input name="q" defaultValue={q} placeholder="Monitor name" /></label><label className="text-label">Status<Dropdown name="status" defaultValue={state}><option value="">All statuses</option>{["UP", "DEGRADED", "DOWN", "PENDING", "PAUSED", "MAINTENANCE", "UNKNOWN"].map(s => <option key={s}>{s}</option>)}</Dropdown></label><button className="min-h-11 self-end rounded-md border border-line px-4 font-semibold">Filter</button></form>
 <div className="grid gap-4 md:grid-cols-2">{visible.map(m => { const summary = mergeRollups(m.rollups); return <Card key={m.id}><div className="flex items-start justify-between gap-3"><Link className="min-w-0 flex-1 break-words text-title text-accent-text hover:underline" href={`/w/${workspaceSlug}/services/monitors/${m.id}`}>{m.name}</Link><Status status={m.lastStatus} /></div><p className="mt-2 text-caption text-ink-muted">{m.type} · {m.lastLatencyMs === null ? "No latency yet" : `${m.lastLatencyMs} ms`} · {formatUptime(uptimePercent(summary))} uptime</p><Sparkline values={m.rollups.map(r => r.latencyAvg)} /><UptimeBars bars={dailyBars(m.rollups, 30, now).map(b => ({ day: b.day.toISOString().slice(0, 10), uptime: b.uptime }))} /><p className="mt-3 text-caption text-ink-muted">{m.tags.join(" · ")}</p></Card>; })}</div>
 {monitors.length > 0 && !visible.length ? <EmptyState title="No monitors match these filters." action={<Link href={`/w/${workspaceSlug}/services`}>Clear filters</Link>} /> : null}
 {!monitors.length ? <EmptyState title="No monitors yet. Add one for your next launch." action={manage ? <Link href={`/w/${workspaceSlug}/services/monitors/new`}>Add monitor</Link> : undefined} /> : null}
 {manage ? <Link className="inline-flex min-h-11 items-center text-accent-text hover:underline" href={`/w/${workspaceSlug}/settings/cloud-accounts`}>Connect a cloud account</Link> : null}</div>;
}
