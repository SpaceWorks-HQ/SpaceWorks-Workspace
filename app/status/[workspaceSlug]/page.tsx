import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { publicSummary, publicRateAllowed } from "@/lib/monitor/public";
import { Status, Sparkline, UptimeBars } from "@/components/services/Display";
import { Card } from "@/components/ui/display";
import { formatUptime } from "@/lib/monitor/stats";
import { formatDayTime } from "@/lib/format/datetime";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: PageProps<"/status/[workspaceSlug]">): Promise<Metadata> {
 const summary = await publicSummary((await params).workspaceSlug);
 return { title: summary?.title ?? "Service status", robots: summary?.noindex !== false ? { index: false, follow: false } : undefined };
}
export default async function Page({ params }: PageProps<"/status/[workspaceSlug]">) {
 const { workspaceSlug } = await params;
 if (!await publicRateAllowed(new Headers(await headers()))) notFound();
 const summary = await publicSummary(workspaceSlug); if (!summary) notFound();
 const banner: Record<string, string> = { UP: "All systems operational", DOWN: "Service interruption", DEGRADED: "Some services are degraded", MAINTENANCE: "Scheduled maintenance", UNKNOWN: "Service status unavailable", PENDING: "Waiting for the first check", PAUSED: "Monitoring paused" };
 return <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 text-ink"><p className="text-label text-ink-muted">Space Works</p><h1 className="text-h1">{summary.title}</h1><p className="whitespace-pre-wrap text-body-ui text-ink-secondary">{summary.description}</p><Card><h2 className="text-h3">{banner[summary.overallStatus] ?? "Service status"}</h2></Card>{summary.components.map(c => <Card key={c.key}><p className="text-caption text-ink-muted">{c.group}</p><div className="mb-4 flex flex-wrap justify-between gap-3"><h2 className="text-title">{c.displayName}</h2><Status status={c.status} /></div><UptimeBars bars={c.bars} />{c.uptime !== null ? <p className="mt-3 text-caption text-ink-muted">{formatUptime(c.uptime)} uptime over 90 days</p> : null}{"latency" in c ? <Sparkline values={c.latency ?? []} /> : null}</Card>)}{summary.incidents.length ? <section className="space-y-4"><h2 className="text-h2">Incidents</h2>{summary.incidents.map(i => <Card key={i.number}><h3 className="text-h3">{i.title}</h3><Status status={i.status} /><p className="mt-2 text-caption text-ink-muted">{formatDayTime(i.startedAt, "UTC")} UTC</p>{i.updates.map((u, n) => <div key={n} className="mt-4 border-t border-line pt-3"><p className="text-caption text-ink-muted">{formatDayTime(u.createdAt, "UTC")} UTC</p><p className="mt-2 whitespace-pre-wrap break-words text-body-ui">{u.body}</p></div>)}</Card>)}</section> : <p className="text-body-ui text-ink-muted">No recent incidents.</p>}{summary.maintenance.map((w, i) => <Card key={i}><h2 className="text-h3">{w.title}</h2><p className="mt-2">{formatDayTime(w.startsAt, "UTC")} – {formatDayTime(w.endsAt, "UTC")} UTC</p><p className="mt-3 whitespace-pre-wrap">{w.description}</p></Card>)}<footer className="whitespace-pre-wrap text-caption text-ink-muted">{summary.footer || "Service status from Space Works."}</footer></main>;
}
