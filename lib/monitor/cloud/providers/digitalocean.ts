import "server-only";

import { catalogEntry } from "@/lib/monitor/cloud/catalog";
import { bearer, MAX_PAGES, monthStartUtc, nextMonthStartUtc, safeVerify, toNumber } from "@/lib/monitor/cloud/providers/common";
import { CloudApiError, trimRaw, type AdapterContext, type CloudProviderAdapter, type CostInput, type MetricPoint, type ResourceHealth, type ResourceSnapshot } from "@/lib/monitor/cloud/types";

/** DigitalOcean (read-only token). Limits: 5 000 requests/hour and 250/minute per token. */

const BASE = "https://api.digitalocean.com";
const METRIC_DROPLET_CAP = 10;
const WINDOW_MS = 15 * 60_000;

type Obj = Record<string, unknown>;
type Pages = { links?: { pages?: { next?: string } } };
type Series = { metric?: Record<string, string>; values?: Array<[number, string]> };
type MetricResponse = { data?: { result?: Series[] } };

async function get<T>(ctx: AdapterContext, path: string) {
  return (await ctx.http.json<T>(`${BASE}${path}`, { headers: bearer(ctx, "personal access token") })).data;
}

async function list(ctx: AdapterContext, path: string, key: string): Promise<Obj[]> {
  const items: Obj[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await get<Obj & Pages>(ctx, `${path}?page=${page}&per_page=200`);
    const batch = Array.isArray(data?.[key]) ? (data[key] as Obj[]) : [];
    items.push(...batch);
    if (!data?.links?.pages?.next || batch.length === 0) break;
    if (page === MAX_PAGES) throw new CloudApiError("Inventory exceeds the sync page limit. Use a more narrowly scoped account.", "config");
  }
  return items;
}

const DROPLET: Record<string, ResourceHealth> = { active: "HEALTHY", off: "STOPPED", new: "DEGRADED", archive: "STOPPED" };
const LOAD_BALANCER: Record<string, ResourceHealth> = { active: "HEALTHY", new: "DEGRADED", errored: "UNHEALTHY" };
const DATABASE: Record<string, ResourceHealth> = { online: "HEALTHY", creating: "DEGRADED", resizing: "DEGRADED", migrating: "DEGRADED", forking: "DEGRADED" };

const slug = (region: unknown) => (region && typeof region === "object" ? String((region as Obj).slug ?? "") || null : typeof region === "string" ? region : null);
const phase = (deployment: unknown) => (deployment && typeof deployment === "object" ? String((deployment as Obj).phase ?? "") : "");

/** App status from its deployments: the active one decides; a first deploy still running is DEGRADED. */
export function appHealth(app: Obj): { status: ResourceHealth; detail: string } {
  const active = phase(app.active_deployment);
  const inProgress = phase(app.in_progress_deployment);
  const detail = [active && `active ${active}`, inProgress && `deploying ${inProgress}`].filter(Boolean).join(" / ") || "no deployment";
  if (active === "ACTIVE") return { status: "HEALTHY", detail };
  if (active === "ERROR") return { status: "UNHEALTHY", detail };
  if (inProgress) return { status: "DEGRADED", detail };
  return { status: "UNKNOWN", detail };
}

async function listResources(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const [droplets, apps, databases, balancers] = [
    await list(ctx, "/v2/droplets", "droplets"),
    await list(ctx, "/v2/apps", "apps"),
    await list(ctx, "/v2/databases", "databases"),
    await list(ctx, "/v2/load_balancers", "load_balancers"),
  ];
  return [
    ...droplets.map((d) => ({
      externalId: String(d.id),
      kind: "droplet",
      name: String(d.name ?? d.id),
      region: slug(d.region),
      status: DROPLET[String(d.status)] ?? "UNKNOWN",
      statusDetail: String(d.status ?? ""),
      raw: trimRaw(d),
    })),
    ...apps.map((a) => {
      const { status, detail } = appHealth(a);
      const spec = (a.spec ?? {}) as Obj;
      return { externalId: String(a.id), kind: "app", name: String(spec.name ?? a.id), region: slug(a.region), status, statusDetail: detail, url: typeof a.live_url === "string" ? a.live_url : null, raw: trimRaw(a) };
    }),
    ...databases.map((db) => ({
      externalId: String(db.id),
      kind: "database",
      name: String(db.name ?? db.id),
      region: slug(db.region),
      status: DATABASE[String(db.status)] ?? "UNKNOWN",
      statusDetail: [db.engine, db.status].filter(Boolean).join(" / "),
      raw: trimRaw({ id: db.id, name: db.name, engine: db.engine, version: db.version, status: db.status, size: db.size, num_nodes: db.num_nodes }),
    })),
    ...balancers.map((lb) => ({
      externalId: String(lb.id),
      kind: "load_balancer",
      name: String(lb.name ?? lb.id),
      region: slug(lb.region),
      status: LOAD_BALANCER[String(lb.status)] ?? "UNKNOWN",
      statusDetail: String(lb.status ?? ""),
      raw: trimRaw(lb),
    })),
  ];
}

const series = (data: MetricResponse | null) => (data?.data?.result ?? []).filter((s) => (s.values?.length ?? 0) > 0);
const latest = (s: Series | undefined) => {
  const last = s?.values?.[s.values.length - 1];
  return last ? { ts: new Date(last[0] * 1000), value: Number(last[1]) } : null;
};

/** CPU % from per-mode counters: 100 × (1 − Δidle / Δtotal) across the window. */
export function cpuPercent(result: Series[]): { ts: Date; value: number } | null {
  let total = 0;
  let idle = 0;
  let ts = 0;
  for (const s of result) {
    const values = s.values ?? [];
    if (values.length < 2) continue;
    const delta = Number(values[values.length - 1][1]) - Number(values[0][1]);
    if (!Number.isFinite(delta)) continue;
    total += delta;
    if (s.metric?.mode === "idle") idle += delta;
    ts = Math.max(ts, values[values.length - 1][0]);
  }
  if (total <= 0) return null;
  return { ts: new Date(ts * 1000), value: Math.round((1 - idle / total) * 10_000) / 100 };
}

/** Root filesystem series when the agent reports several devices. */
const rootFs = (result: Series[]) => result.find((s) => s.metric?.mountpoint === "/") ?? result[0];

async function getMetrics(ctx: AdapterContext, resources: ResourceSnapshot[]): Promise<MetricPoint[]> {
  const end = Math.floor(ctx.now.getTime() / 1000);
  const start = end - WINDOW_MS / 1000;
  const points: MetricPoint[] = [];
  const droplets = resources.filter((r) => r.kind === "droplet" && r.status === "HEALTHY").slice(0, METRIC_DROPLET_CAP);
  for (const droplet of droplets) {
    const id = droplet.externalId;
    const metric = async (name: string, extra = "") => series(await get<MetricResponse>(ctx, `/v2/monitoring/metrics/droplet/${name}?host_id=${encodeURIComponent(id)}&start=${start}&end=${end}${extra}`));
    const push = (name: string, point: { ts: Date; value: number } | null) => {
      if (point && Number.isFinite(point.value)) points.push({ externalId: id, metric: name, ts: point.ts, value: point.value });
    };

    push("cpu_pct", cpuPercent(await metric("cpu")));
    // Memory and disk come from do-agent; an empty answer means it isn't installed.
    const memTotal = latest((await metric("memory_total"))[0]);
    if (memTotal && memTotal.value > 0) {
      const available = latest((await metric("memory_available"))[0]);
      if (available) push("mem_pct", { ts: available.ts, value: Math.round((1 - available.value / memTotal.value) * 10_000) / 100 });
      const size = latest(rootFs(await metric("filesystem_size")));
      const free = size && size.value > 0 ? latest(rootFs(await metric("filesystem_free"))) : null;
      if (size && free) push("disk_free_pct", { ts: free.ts, value: Math.round((free.value / size.value) * 10_000) / 100 });
    }
    push("net_in_mbps", latest((await metric("bandwidth", "&interface=public&direction=inbound"))[0]));
    push("net_out_mbps", latest((await metric("bandwidth", "&interface=public&direction=outbound"))[0]));
  }
  return points;
}

async function getCosts(ctx: AdapterContext): Promise<CostInput[]> {
  const monthStart = monthStartUtc(ctx.now);
  const costs: CostInput[] = [];
  const balance = await get<Obj>(ctx, "/v2/customers/my/balance");
  const generatedAt = typeof balance?.generated_at === "string" ? new Date(balance.generated_at) : ctx.now;
  const usage = toNumber(balance?.month_to_date_usage);
  if (usage !== null) costs.push({ granularity: "MTD", periodStart: monthStart, periodEnd: generatedAt, amount: usage, currency: "USD" });
  const accountBalance = toNumber(balance?.account_balance);
  if (accountBalance !== null) costs.push({ granularity: "BALANCE", periodStart: generatedAt, periodEnd: generatedAt, amount: accountBalance, currency: "USD" });

  // The invoice list carries a preview of the running month's invoice (amount only, no item breakdown).
  const invoices = await get<{ invoice_preview?: Obj }>(ctx, "/v2/customers/my/invoices?per_page=1");
  const previewAmount = toNumber(invoices?.invoice_preview?.amount);
  if (previewAmount !== null) {
    costs.push({ granularity: "MONTH", periodStart: monthStart, periodEnd: nextMonthStartUtc(ctx.now), amount: previewAmount, currency: "USD", isEstimate: true });
  }
  return costs;
}

export const digitalOceanAdapter: CloudProviderAdapter = {
  ...catalogEntry("DIGITALOCEAN"),
  minRequestSpacingMs: 750,
  verify: (ctx) =>
    safeVerify(async () => {
      const data = await get<{ account?: { email?: string; uuid?: string } }>(ctx, "/v2/account");
      return data?.account?.email ?? data?.account?.uuid ?? null;
    }),
  listResources,
  getMetrics,
  getCosts,
  // DO alert policies (/v2/monitoring/alerts) only describe rules; the API exposes no firing state, so there is nothing to report.
  listAlarms: async () => [],
};
