import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageServices } from "@/lib/roles";
import { prisma } from "@/lib/db";
import { Card } from "@/components/ui/display";
import { ServicesNav } from "@/components/services/Display";

import { StatusPageForm } from "@/components/services/StatusPageForm";
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/services/status-page">) {
 const { workspaceSlug } = await params;
 const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN"); if (!canManageServices(membership)) notFound();
 const [page, monitors] = await Promise.all([prisma.statusPage.findUnique({ where: { workspaceId: workspace.id }, include: { components: { orderBy: { sortOrder: "asc" } } } }), prisma.monitor.findMany({ where: { workspaceId: workspace.id }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
 return <div className="space-y-6"><h1 className="text-h1">Public status page</h1><ServicesNav slug={workspaceSlug} manage costs /><Card><StatusPageForm slug={workspaceSlug} title={page?.title ?? `${workspace.name} status`} description={page?.descriptionMd ?? ""} footer={page?.footerMd ?? ""} enabled={page?.enabled ?? false} noindex={page?.noindex ?? true} showUptime={page?.showUptimePercent ?? true} monitors={monitors} components={page?.components ?? []} /></Card>{page?.enabled ? <Link className="text-accent-text" href={`/status/${workspaceSlug}`}>View public status page</Link> : null}<p className="text-body-ui text-ink-muted">Only selected monitors and public incident updates appear here. Badges: /status/{workspaceSlug}/badge/your-component-key.svg?type=uptime</p></div>;
}
