import "server-only";
import { catalogEntry } from "@/lib/monitor/cloud/catalog";
import { bearer, configList, configString, monthStartUtc, nextMonthStartUtc, safeVerify, withQuery, httpsUrl } from "./common";
import { guardedRequest } from "@/lib/monitor/net/http";
import { STRICT_POLICY } from "@/lib/monitor/ssrf";
import { CloudApiError, type AdapterContext, type CloudProviderAdapter, type CloudProviderKind, type ResourceHealth, type ResourceSnapshot, type MetricPoint } from "../types";

type Obj = Record<string, unknown>;
export const object = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
export const array = (v: unknown): Obj[] => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v) : "";
export function providerHealth(state: unknown): ResourceHealth {
  const s = text(state).toLowerCase();
  if (["active", "running", "started", "ready", "live", "available", "success", "healthy", "ok", "online"].includes(s)) return "HEALTHY";
  if (["failed", "failure", "error", "crashed", "unhealthy", "build_failed", "update_failed", "timed_out", "action_required", "stale", "storage-full", "inaccessible-encryption-credentials", "incompatible-network"].includes(s)) return "UNHEALTHY";
  if (["off", "stopped", "suspended", "deactivated", "canceled", "cancelled"].includes(s)) return "STOPPED";
  if (["building", "queued", "initializing", "starting", "stopping", "pending", "degraded", "deploying", "migrating", "rebuilding", "in_progress"].includes(s)) return "DEGRADED";
  return "UNKNOWN";
}
const id = (v: unknown) => encodeURIComponent(text(v));
async function request(ctx: AdapterContext, url: string, body?: Obj): Promise<Obj> {
  const r = await ctx.http.json<unknown>(url, { headers: { ...bearer(ctx), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  const data = object(r.data);
  if (data.success === false || (Array.isArray(data.errors) && data.errors.length)) throw new CloudApiError("The provider rejected the read query. Check permissions and configuration.", "http");
  return Array.isArray(r.data) ? { items: r.data } : data;
}
function resource(kind: string, row: Obj, state: unknown, extra: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
  return { externalId: `${kind}:${text(row.id ?? row.name)}`, kind, name: text(row.name ?? row.id), status: providerHealth(state), statusDetail: text(state), ...extra };
}

async function render(ctx: AdapterContext) {
  const result: ResourceSnapshot[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const rows = array((await request(ctx, withQuery("https://api.render.com/v1/services", { limit: 100, cursor }))).items);
    for (const entry of rows) {
      const row = object(entry.service);
      const deployments = array((await request(ctx, `https://api.render.com/v1/services/${id(row.id)}/deploys?limit=1`)).items);
      const state = row.suspended === "suspended" ? "suspended" : object(deployments[0]?.deploy).status;
      result.push(resource("service", row, state, { url: httpsUrl(object(row.serviceDetails).url), region: text(object(row.serviceDetails).region) || null }));
    }
    cursor = text(rows.at(-1)?.cursor);
    if (rows.length < 100 || !cursor) break;
  }
  return result;
}
async function cloudflare(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await request(ctx, `https://api.cloudflare.com/client/v4/zones?per_page=50&page=${page}`);
    out.push(...array(response.result).map(r => resource("zone", r, r.status)));
    if (page >= Number(object(response.result_info).total_pages ?? 1)) break;
  }
  const account = id(configString(ctx, "accountId"));
  const workers = await request(ctx, `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts`);
  out.push(...array(workers.result).map(r => resource("worker", { ...r, name: r.id }, "active")));
  const buckets = await request(ctx, `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`);
  out.push(...array(object(buckets.result).buckets).map(r => resource("r2_bucket", { ...r, id: r.name }, "active")));
  return out;
}
async function hetzner(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  for (const [path, key, kind] of [["servers", "servers", "server"], ["load_balancers", "load_balancers", "load_balancer"]]) {
    for (let page = 1; page <= 10; page++) {
      const response = await request(ctx, `https://api.hetzner.cloud/v1/${path}?per_page=50&page=${page}`);
      for (const row of array(response[key])) {
        const targets = array(row.targets);
        const unhealthy = targets.some(t => array(t.health_status).some(h => h.status === "unhealthy"));
        const state = kind === "server" ? row.status : unhealthy ? "unhealthy" : "active";
        const type = object(row.server_type);
        const prices = array(type.prices);
        const location = object(object(row.datacenter).location);
        const price = prices.find(p => p.location === location.name) ?? prices[0];
        out.push(resource(kind, row, state, { region: text(location.name || object(row.location).name) || null, raw: { monthlyPrice: Number(object(price?.price_monthly).gross ?? 0), currency: "EUR" } }));
      }
      if (!object(object(response.meta).pagination).next_page) break;
    }
  }
  return out;
}
async function vercel(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  let until: number | null = null;
  for (let page = 0; page < 10; page++) {
    const response = await request(ctx, withQuery("https://api.vercel.com/v9/projects", { limit: 100, teamId: configString(ctx, "teamId"), until }));
    for (const row of array(response.projects)) {
      const deployment = array((await request(ctx, withQuery("https://api.vercel.com/v6/deployments", { projectId: text(row.id), limit: 1, teamId: configString(ctx, "teamId") }))).deployments)[0];
      out.push(resource("project", row, deployment?.readyState ?? deployment?.state, { url: httpsUrl(deployment?.url) }));
    }
    until = Number(object(response.pagination).next) || null;
    if (!until) break;
  }
  return out;
}
async function netlify(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  for (let page = 1; page <= 10; page++) {
    const rows = array((await request(ctx, `https://api.netlify.com/api/v1/sites?per_page=100&page=${page}`)).items);
    for (const row of rows) {
      const deploy = array((await request(ctx, `https://api.netlify.com/api/v1/sites/${id(row.id)}/deploys?per_page=1`)).items)[0];
      out.push(resource("site", row, deploy?.state, { url: httpsUrl(row.ssl_url ?? row.url) }));
    }
    if (rows.length < 100) break;
  }
  return out;
}
async function fly(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  for (const app of configList(ctx, "apps")) {
    const rows = array((await request(ctx, `https://api.machines.dev/v1/apps/${id(app)}/machines`)).items);
    out.push(...rows.map(r => resource("machine", r, array(r.checks).some(c => c.status === "critical") ? "unhealthy" : r.state, { externalId: `${app}:${text(r.id)}`, name: `${app} / ${text(r.name ?? r.id)}`, region: text(r.region) })));
  }
  return out;
}
async function railway(ctx: AdapterContext) {
  const response = await request(ctx, "https://backboard.railway.com/graphql/v2", { query: "query { projects { edges { node { id name services { edges { node { id name deployments(first: 1) { edges { node { id status } } } } } } } } } }" });
  const out: ResourceSnapshot[] = [];
  for (const project of array(object(object(response.data).projects).edges)) {
    const p = object(project.node);
    for (const service of array(object(p.services).edges)) {
      const row = object(service.node);
      const deployment = object(array(object(row.deployments).edges)[0]?.node);
      out.push(resource("service", row, deployment.status, { name: `${text(p.name)} / ${text(row.name)}` }));
    }
  }
  return out;
}
async function github(ctx: AdapterContext) {
  const out: ResourceSnapshot[] = [];
  for (const repo of configList(ctx, "repos")) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new CloudApiError("Use repositories in owner/repo format.", "config");
    const response = await request(ctx, withQuery(`https://api.github.com/repos/${repo}/actions/runs`, { branch: configString(ctx, "branch") ?? "main", per_page: 100 }));
    const latest = new Map<string, Obj>();
    for (const row of array(response.workflow_runs)) if (!latest.has(text(row.workflow_id))) latest.set(text(row.workflow_id), row);
    out.push(...[...latest.values()].map(r => resource("workflow", r, r.conclusion ?? r.status, { externalId: `${repo}:${text(r.workflow_id)}`, name: `${repo} / ${text(r.name)}`, url: httpsUrl(r.html_url) })));
  }
  return out;
}
async function prometheus(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const base = configString(ctx, "baseUrl");
  if (!base) throw new CloudApiError("Enter the Prometheus base URL.", "config");
  const url = new URL("api/v1/query?query=up", base.endsWith("/") ? base : `${base}/`);
  const response = await guardedRequest({ url: url.toString(), headers: ctx.credentials.token ? bearer(ctx) : {}, timeoutMs: 10000, policy: STRICT_POLICY });
  if (!response.ok || response.status !== 200) throw new CloudApiError("Prometheus did not answer the health query.", "network");
  const parsed = object(JSON.parse(response.body));
  if (parsed.status !== "success") throw new CloudApiError("Prometheus rejected the query.", "http");
  return array(object(parsed.data).result).map((r, i) => { const metric = object(r.metric); const value = Array.isArray(r.value) ? Number(r.value[1]) : 0; return resource("target", { id: text(metric.instance) || i, name: text(metric.instance) || text(metric.job) }, value > 0 ? "healthy" : "unhealthy"); });
}
const inventories: Partial<Record<CloudProviderKind, (ctx: AdapterContext) => Promise<ResourceSnapshot[]>>> = { RENDER: render, CLOUDFLARE: cloudflare, HETZNER: hetzner, VERCEL: vercel, NETLIFY: netlify, FLY: fly, RAILWAY: railway, GITHUB_ACTIONS: github, PROMETHEUS: prometheus };

async function hetznerMetrics(ctx: AdapterContext, resources: ResourceSnapshot[]): Promise<MetricPoint[]> {
  const out: MetricPoint[] = [];
  for (const r of resources.filter(r => r.status === "HEALTHY").slice(0, 20)) {
    const path = r.kind === "server" ? "servers" : "load_balancers";
    const response = await request(ctx, withQuery(`https://api.hetzner.cloud/v1/${path}/${id(r.externalId.split(":").at(-1))}/metrics`, { type: r.kind === "server" ? "cpu,disk,network" : "open_connections,requests_per_second,bandwidth", start: new Date(ctx.now.getTime() - 900000).toISOString(), end: ctx.now.toISOString(), step: 300 }));
    for (const [metric, data] of Object.entries(object(object(response.metrics).time_series))) {
      const values = object(data).values;
      for (const p of Array.isArray(values) ? values : []) if (Array.isArray(p) && Number.isFinite(Number(p[1]))) out.push({ externalId: r.externalId, metric, ts: new Date(Number(p[0]) * 1000), value: Number(p[1]) });
    }
  }
  return out;
}
async function cloudflareMetrics(ctx: AdapterContext): Promise<MetricPoint[]> {
  const account = configString(ctx, "accountId");
  const since = new Date(ctx.now.getTime() - 900000).toISOString();
  const response = await request(ctx, "https://api.cloudflare.com/client/v4/graphql", { query: `query($account: String!, $since: Time!) { viewer { accounts(filter: {accountTag: $account}) { workersInvocationsAdaptive(limit: 100, filter: {datetime_geq: $since}) { dimensions { scriptName } sum { requests errors } } r2StorageAdaptiveGroups(limit: 100, filter: {datetime_geq: $since}) { dimensions { bucketName } max { payloadSize objectCount } } } } }`, variables: { account, since } });
  const out: MetricPoint[] = [];
  for (const account of array(object(object(response.data).viewer).accounts)) {
    for (const row of array(account.workersInvocationsAdaptive)) for (const [metric, value] of Object.entries(object(row.sum))) if (Number.isFinite(Number(value))) out.push({ externalId: `worker:${text(object(row.dimensions).scriptName)}`, metric, ts: ctx.now, value: Number(value) });
    for (const row of array(account.r2StorageAdaptiveGroups)) for (const [metric, value] of Object.entries(object(row.max))) if (Number.isFinite(Number(value))) out.push({ externalId: `r2_bucket:${text(object(row.dimensions).bucketName)}`, metric, ts: ctx.now, value: Number(value) });
  }
  return out;
}
export function restAdapter(provider: CloudProviderKind): CloudProviderAdapter {
  const inventory = inventories[provider];
  if (!inventory) throw new CloudApiError("Unsupported provider.", "config");
  return { ...catalogEntry(provider), minRequestSpacingMs: provider === "RAILWAY" ? 36000 : ["HETZNER", "FLY"].includes(provider) ? 1100 : provider === "GITHUB_ACTIONS" ? 750 : 350,
    verify: ctx => safeVerify(async () => { await inventory(ctx); return catalogEntry(provider).label; }),
    listResources: inventory,
    ...(provider === "HETZNER" ? { getMetrics: hetznerMetrics, getCosts: async (ctx: AdapterContext) => { const resources = await hetzner(ctx); return [{ granularity: "MONTH" as const, periodStart: monthStartUtc(ctx.now), periodEnd: nextMonthStartUtc(ctx.now), amount: resources.filter(r => r.kind === "server" && r.status !== "STOPPED").reduce((s, r) => s + Number(r.raw?.monthlyPrice ?? 0), 0), currency: "EUR", isEstimate: true }]; } } : {}),
    ...(provider === "CLOUDFLARE" ? { getMetrics: cloudflareMetrics } : {}),
  };
}
