import { requireWorkspace } from "@/lib/permissions";
import { canManageIntegrations } from "@/lib/roles";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { seoPeriodStart } from "@/lib/seo/service";
import { summariseMetrics } from "@/lib/seo/metrics";
import type { AuditFinding } from "@/lib/seo/audit";
import { SeoDashboard } from "@/components/integrations/SeoDashboard";
export const metadata = { title: "SEO" };
export default async function SeoPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/seo">) {
  const { workspaceSlug } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageIntegrations(membership)) notFound();
  const sites = await prisma.seoSite.findMany({ where: { workspaceId: workspace.id }, orderBy: { siteUrl: "asc" } });
  const query = await searchParams; const selected = sites.find(s => s.id === query.site) ?? sites[0];
  const [metrics, audits] = selected ? await Promise.all([
    prisma.seoMetricDaily.findMany({ where: { siteId: selected.id, site: { workspaceId: workspace.id }, date: { gte: seoPeriodStart() } }, orderBy: { date: "asc" }, take: 100000 }),
    prisma.seoAudit.findMany({ where: { siteId: selected.id, site: { workspaceId: workspace.id } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]) : [[], []];
  return <div className="min-w-0 space-y-6"><h1 className="text-h1">SEO analyst</h1><p className="text-ink-secondary">Understand search performance and improve the pages your community shares.</p><SeoDashboard slug={workspaceSlug} sites={sites.map(s => ({ id: s.id, siteUrl: s.siteUrl, lastSyncedAt: s.lastSyncedAt?.toISOString() ?? null }))} selected={selected?.id ?? ""} summary={summariseMetrics(metrics)} timeZone={workspace.timezone} audits={audits.map(a => ({ id: a.id, url: a.url, status: a.status, score: a.score, at: a.createdAt.toISOString(), findings: (Array.isArray(a.findings) ? a.findings : []) as AuditFinding[] }))} /></div>;
}
