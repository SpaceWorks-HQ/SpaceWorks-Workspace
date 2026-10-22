// Generated from app/w/[workspaceSlug]/seo/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageIntegrations } from "@/lib/roles";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { seoPeriodStart } from "@/lib/seo/service";

export async function loadSeoPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/seo">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageIntegrations(membership)) notFound();
const sites = await prisma.seoSite.findMany({ where: { workspaceId: workspace.id }, orderBy: { siteUrl: "asc" } });
const query = await searchParams;
const selected = sites.find(s => s.id === query.site) ?? sites[0];
const [metrics, audits] = selected ? await Promise.all([
    prisma.seoMetricDaily.findMany({ where: { siteId: selected.id, site: { workspaceId: workspace.id }, date: { gte: seoPeriodStart() } }, orderBy: { date: "asc" }, take: 100000 }),
    prisma.seoAudit.findMany({ where: { siteId: selected.id, site: { workspaceId: workspace.id } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]) : [[], []];
return viewDto({ workspace, sites, selected, metrics, audits } as const);
}
