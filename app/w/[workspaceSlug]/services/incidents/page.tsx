import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";
import { ServicesNav, Status } from "@/components/services/Display";
import { CommandForm } from "@/components/services/CommandForm";
import { formatDayTime } from "@/lib/format/datetime";
export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/services/incidents">) {
 const { workspaceSlug } = await params, query = await searchParams;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER"); if (!canViewServices(membership)) notFound();
 const manage = canManageServices(membership);
 const [incidents, monitors] = await Promise.all([prisma.incident.findMany({ where: { workspaceId: workspace.id, status: query.status === "resolved" ? "RESOLVED" : { not: "RESOLVED" } }, orderBy: { startedAt: "desc" }, take: 100 }), prisma.monitor.findMany({ where: { workspaceId: workspace.id }, select: { id: true, name: true } })]);
 return <div className="space-y-6"><h1 className="text-h1">Incidents</h1><ServicesNav slug={workspaceSlug} manage={manage} costs={canViewCosts(membership, workspace)} /><nav className="flex gap-4"><Link className="min-h-11 text-accent-text" href="?status=open">Open</Link><Link className="min-h-11 text-accent-text" href="?status=resolved">Resolved</Link></nav><Card>{incidents.map(i => <div key={i.id} className="flex flex-wrap justify-between gap-3 border-b border-line py-4"><div><Link className="text-title text-accent-text" href={`/w/${workspaceSlug}/services/incidents/${i.number}`}>INC-{i.number}: {i.title}</Link><p className="text-caption text-ink-muted">{formatDayTime(i.startedAt, workspace.timezone)} · {i.source.toLowerCase()}</p></div><Status status={i.status} /></div>)}{!incidents.length ? <p>No incidents in this view.</p> : null}</Card>{manage ? <Card><h2 className="mb-4 text-h3">Open an incident</h2><CommandForm slug={workspaceSlug} command="createIncident" label="Open incident" fields={[{ name: "title", label: "Incident title", required: true }, { name: "bodyMd", label: "First update", kind: "textarea", required: true }, { name: "monitorIds", label: "Affected monitors", kind: "ids", options: monitors.map(m => ({ value: m.id, label: m.name })) }, { name: "impact", label: "Impact", kind: "select", value: "MAJOR", options: ["NONE", "MINOR", "MAJOR", "CRITICAL"].map(s => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() })) }, { name: "public", label: "Publish on the status page", kind: "checkbox", value: false }]} /></Card> : null}</div>;
}
