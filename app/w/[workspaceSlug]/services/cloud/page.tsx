import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewServices, canManageServices, canViewCosts } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card, EmptyState } from "@/components/ui/display";
import { ServicesNav, Status } from "@/components/services/Display";

export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/services/cloud">) {
 const { workspaceSlug } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER"); if (!canViewServices(membership)) notFound();
 const resources = await prisma.cloudResource.findMany({ where: { workspaceId: workspace.id, goneAt: null }, orderBy: { name: "asc" }, take: 300, select: { id: true, name: true, kind: true, region: true, status: true, statusDetail: true, metrics: { orderBy: { ts: "desc" }, take: 4, select: { metric: true, value: true } }, connection: { select: { label: true } } } });
 const manage = canManageServices(membership);
 return <div className="space-y-6"><h1 className="text-h1">Cloud resources</h1><ServicesNav slug={workspaceSlug} manage={manage} costs={canViewCosts(membership, workspace)} />{manage ? <Link className="inline-flex min-h-11 items-center text-accent-text" href={`/w/${workspaceSlug}/settings/cloud-accounts`}>Manage cloud accounts</Link> : null}<div className="grid gap-4 md:grid-cols-2">{resources.map(r => <Card key={r.id}><div className="flex justify-between gap-3"><h2 className="min-w-0 break-words text-title">{r.name}</h2><Status status={r.status} /></div><p className="mt-2 text-caption text-ink-muted">{r.connection.label} · {r.kind} · {r.region ?? "Global"}</p><p className="mt-3 text-body-ui">{r.statusDetail}</p><ul className="mt-2 text-caption">{r.metrics.map((m, i) => <li key={i}>{m.metric}: {m.value.toFixed(2)}</li>)}</ul>{manage ? <Link className="mt-3 inline-flex min-h-11 items-center text-accent-text" href={`/w/${workspaceSlug}/services/monitors/new?resource=${r.id}`}>Create monitor from this resource</Link> : null}</Card>)}</div>{!resources.length ? <EmptyState title="No cloud resources yet. Connect an account to sync them." /> : null}</div>;
}
