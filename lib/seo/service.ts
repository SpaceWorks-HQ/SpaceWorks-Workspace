import "server-only";
import { prisma } from "@/lib/db";
import { googleApi, searchConsoleUrl } from "@/lib/integrations/google/api";
import { withGuardedFetch } from "@/lib/integrations/guardedFetch";
import { checkPublicUrl } from "@/lib/integrations/ssrf";
import { readInboundBody } from "@/lib/messaging/inbound";
import { auditHtml, belongsToProperty } from "./audit";
import { dispatch } from "@/lib/notify";
export async function syncSeoSite(workspaceId: string, siteId: string, now = new Date()) {
  const site = await prisma.seoSite.findFirst({ where: { id: siteId, workspaceId, connection: { workspaceId, status: "ACTIVE" } } });
  if (!site?.connectionId) throw new Error("Connect this site to an active Google account first.");
  // Search Console data arrives late; replace the most recent seven complete data days.
  const hasHistory = await prisma.seoMetricDaily.findFirst({ where: { siteId, site: { workspaceId } }, select: { id: true } });
  const end = new Date(now.getTime() - 3 * 86400000).toISOString().slice(0, 10); const start = new Date(now.getTime() - (hasHistory ? 9 : 32) * 86400000).toISOString().slice(0, 10);
  type Row = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
  const rows: (Row & { query: string; page: string })[] = [];
  for (const dimension of [null, "query", "page"] as const) {
    for (let offset = 0; offset < 100000; offset += 25000) {
      const result = await googleApi<{ rows?: Row[] }>(workspaceId, searchConsoleUrl(site.siteUrl, "/searchAnalytics/query"), { method: "POST", connectionId: site.connectionId, body: { startDate: start, endDate: end, dimensions: dimension ? ["date", dimension] : ["date"], rowLimit: 25000, startRow: offset, dataState: "final" } });
      rows.push(...(result.rows ?? []).map(r => ({ ...r, query: dimension === "query" ? r.keys[1]! : "", page: dimension === "page" ? r.keys[1]! : "" })));
      if ((result.rows?.length ?? 0) < 25000) break;
    }
  }
  await prisma.$transaction(async tx => {
    await tx.seoMetricDaily.deleteMany({ where: { siteId, site: { workspaceId }, date: { gte: new Date(start), lte: new Date(end) } } });
    for (let index = 0; index < rows.length; index += 1000) await tx.seoMetricDaily.createMany({ data: rows.slice(index, index + 1000).filter(r => r.keys.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(r.keys[0]!)).map(r => ({ siteId, date: new Date(r.keys[0]!), query: r.query, page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })), skipDuplicates: true });
    await tx.seoSite.updateMany({ where: { id: siteId, workspaceId }, data: { lastSyncedAt: now } });
  }, { timeout: 30000 });
  await dispatch(workspaceId, { type: "seo.report_ready", title: "Search performance is ready", dedupeKey: `seo:${siteId}:${now.toISOString().slice(0, 10)}`, data: { siteId, auditId: null } });
}
export async function runSeoAudit(workspaceId: string, siteId: string, actorId: string, url: string) {
  const site = await prisma.seoSite.findFirst({ where: { id: siteId, workspaceId } }); if (!site) throw new Error("Site not found.");
  if (!belongsToProperty(site.siteUrl, url)) throw new Error("Use a page that belongs to this Search Console property.");
  const safe = await checkPublicUrl(url); if (!safe.ok) throw new Error(safe.error);
  const audit = await prisma.seoAudit.create({ data: { siteId, url: safe.url.toString(), status: "running", createdById: actorId } });
  try {
    const html = await withGuardedFetch(safe.url, { signal: AbortSignal.timeout(10000), headers: { "User-Agent": "SpaceWorks-Workspace-Audit" }, cache: "no-store" }, async response => {
      if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("text/html")) throw new Error("The page did not return HTML successfully.");
      return readInboundBody(new Request(url, { method: "POST", body: response.body, duplex: "half" } as RequestInit), 1000000);
    });
    const result = auditHtml(html, url);
    await prisma.seoAudit.updateMany({ where: { id: audit.id, site: { workspaceId } }, data: { status: "done", ...result } });
    return result;
  } catch { await prisma.seoAudit.updateMany({ where: { id: audit.id, site: { workspaceId } }, data: { status: "failed" } }); throw new Error("Couldn't audit this page. Check that it serves public HTML and try again."); }
}

export function seoPeriodStart() { const start = new Date(); start.setUTCHours(0, 0, 0, 0); start.setUTCDate(start.getUTCDate() - 29); return start; }
