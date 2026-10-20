import "server-only";
import { randomUUID } from "node:crypto";
import { catalogEntry } from "@/lib/monitor/cloud/catalog";
import { CloudApiError, type AdapterContext, type CloudProviderAdapter, type CloudProviderKind, type CostInput, type ResourceHealth, type ResourceSnapshot } from "../types";
import { bearer, configList, MAX_PAGES, requireCredential, safeVerify, toNumber, withQuery } from "./common";
import { array, object, providerHealth } from "./rest";

/**
 * Read-only inventory for VPS and hosting platforms that communities run on:
 * Contabo, Linode (Akamai), Vultr, Scaleway and Supabase. Each adapter lists
 * servers or projects and maps their state to a health; Linode and Vultr also
 * report the account balance and pending charges.
 */

type Obj = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : "");

const EXTRA_STATES: Record<string, ResourceHealth> = {
  provisioning: "DEGRADED",
  installing: "DEGRADED",
  booting: "DEGRADED",
  rebooting: "DEGRADED",
  resizing: "DEGRADED",
  restoring: "DEGRADED",
  cloning: "DEGRADED",
  coming_up: "DEGRADED",
  upgrading: "DEGRADED",
  pausing: "DEGRADED",
  "stopped in place": "STOPPED",
  offline: "STOPPED",
  shutting_down: "DEGRADED",
  uninstalled: "STOPPED",
  inactive: "STOPPED",
  paused: "STOPPED",
  active_healthy: "HEALTHY",
  active_unhealthy: "UNHEALTHY",
  init_failed: "UNHEALTHY",
  removed: "STOPPED",
  locked: "UNHEALTHY",
  pending_payment: "UNHEALTHY",
};

export function vpsHealth(state: unknown): ResourceHealth {
  const key = text(state).toLowerCase();
  return EXTRA_STATES[key] ?? providerHealth(key);
}

function server(provider: string, kind: string, row: { id: unknown; name: unknown; state: unknown; region?: unknown; ip?: unknown; detail?: string }): ResourceSnapshot {
  return {
    externalId: `${kind}:${text(row.id)}`,
    kind,
    name: text(row.name) || text(row.id),
    region: text(row.region) || null,
    status: vpsHealth(row.state),
    statusDetail: row.detail ?? text(row.state),
    raw: { provider, ...(text(row.ip) ? { ip: text(row.ip) } : {}) },
  };
}

async function get(ctx: AdapterContext, url: string, headers: Record<string, string>): Promise<Obj> {
  const response = await ctx.http.json<unknown>(url, { headers });
  return Array.isArray(response.data) ? { items: response.data } : object(response.data);
}

/* ---------- Contabo ---------- */

async function contaboHeaders(ctx: AdapterContext): Promise<Record<string, string>> {
  const body = new URLSearchParams({
    client_id: requireCredential(ctx, "clientId", "client ID"),
    client_secret: requireCredential(ctx, "clientSecret", "client secret"),
    username: requireCredential(ctx, "apiUser", "API user"),
    password: requireCredential(ctx, "apiPassword", "API password"),
    grant_type: "password",
  });
  const response = await ctx.http.json<Obj>("https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const token = text(object(response.data).access_token);
  if (!token) throw new CloudApiError("Contabo didn't issue an access token.", "auth");
  return { authorization: `Bearer ${token}`, "x-request-id": randomUUID() };
}

async function contabo(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const headers = await contaboHeaders(ctx);
  const out: ResourceSnapshot[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await get(ctx, withQuery("https://api.contabo.com/v1/compute/instances", { page, size: 100 }), { ...headers, "x-request-id": randomUUID() });
    for (const row of array(response.data)) {
      out.push(server("contabo", "instance", { id: row.instanceId, name: row.displayName || row.name, state: row.status, region: row.region, ip: object(object(row.ipConfig).v4).ip }));
    }
    if (page >= (toNumber(object(response._pagination).totalPages) ?? 1)) break;
  }
  return out;
}

/* ---------- Linode (Akamai) ---------- */

async function linode(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const out: ResourceSnapshot[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const response = await get(ctx, withQuery("https://api.linode.com/v4/linode/instances", { page, page_size: 100 }), bearer(ctx));
    for (const row of array(response.data)) out.push(server("linode", "linode", { id: row.id, name: row.label, state: row.status, region: row.region, ip: Array.isArray(row.ipv4) ? row.ipv4[0] : null }));
    if (page >= (toNumber(response.pages) ?? 1)) break;
  }
  return out;
}

async function linodeCosts(ctx: AdapterContext): Promise<CostInput[]> {
  const account = await get(ctx, "https://api.linode.com/v4/account", bearer(ctx));
  const balance = toNumber(account.balance);
  const pending = toNumber(account.balance_uninvoiced);
  const out: CostInput[] = [];
  if (pending !== null) out.push({ granularity: "MTD", periodStart: new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1)), periodEnd: ctx.now, amount: pending, currency: "USD", isEstimate: true });
  if (balance !== null) out.push({ granularity: "BALANCE", periodStart: ctx.now, periodEnd: ctx.now, amount: balance, currency: "USD" });
  return out;
}

/* ---------- Vultr ---------- */

function vultrState(row: Obj): { state: string; detail: string } {
  const status = text(row.status);
  const power = text(row.power_status);
  const serverStatus = text(row.server_status);
  const detail = [status, power, serverStatus].filter(Boolean).join(" / ");
  if (status !== "active") return { state: status || "pending", detail };
  if (power === "stopped") return { state: "stopped", detail };
  if (serverStatus && serverStatus !== "ok") return { state: "degraded", detail };
  return { state: "running", detail };
}

async function vultr(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const out: ResourceSnapshot[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await get(ctx, withQuery("https://api.vultr.com/v2/instances", { per_page: 100, cursor }), bearer(ctx, "API key"));
    for (const row of array(response.instances)) {
      const { state, detail } = vultrState(row);
      out.push(server("vultr", "instance", { id: row.id, name: row.label || row.hostname, state, region: row.region, ip: row.main_ip, detail }));
    }
    cursor = text(object(object(response.meta).links).next) || null;
    if (!cursor) break;
  }
  return out;
}

async function vultrCosts(ctx: AdapterContext): Promise<CostInput[]> {
  const account = object((await get(ctx, "https://api.vultr.com/v2/account", bearer(ctx, "API key"))).account);
  const out: CostInput[] = [];
  const pending = toNumber(account.pending_charges);
  const balance = toNumber(account.balance);
  if (pending !== null) out.push({ granularity: "MTD", periodStart: new Date(Date.UTC(ctx.now.getUTCFullYear(), ctx.now.getUTCMonth(), 1)), periodEnd: ctx.now, amount: pending, currency: "USD", isEstimate: true });
  // Vultr reports prepaid credit as a negative balance; it is shown as reported.
  if (balance !== null) out.push({ granularity: "BALANCE", periodStart: ctx.now, periodEnd: ctx.now, amount: balance, currency: "USD" });
  return out;
}

/* ---------- Scaleway ---------- */

async function scaleway(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const headers = { "x-auth-token": requireCredential(ctx, "secretKey", "secret key") };
  const zones = configList(ctx, "zones");
  const out: ResourceSnapshot[] = [];
  for (const zone of zones.length ? zones : ["fr-par-1"]) {
    if (!/^[a-z]{2}-[a-z]{3}-\d$/.test(zone)) throw new CloudApiError("Use Scaleway zones like fr-par-1, nl-ams-1 or pl-waw-1.", "config");
    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await get(ctx, withQuery(`https://api.scaleway.com/instance/v1/zones/${zone}/servers`, { per_page: 100, page }), headers);
      const rows = array(response.servers);
      for (const row of rows) out.push(server("scaleway", "server", { id: `${zone}/${text(row.id)}`, name: row.name, state: row.state, region: zone, ip: object(row.public_ip).address }));
      if (rows.length < 100) break;
    }
  }
  return out;
}

/* ---------- Supabase ---------- */

async function supabase(ctx: AdapterContext): Promise<ResourceSnapshot[]> {
  const projects = array((await get(ctx, "https://api.supabase.com/v1/projects", bearer(ctx, "access token"))).items);
  return projects.map((row) => ({
    ...server("supabase", "project", { id: row.id ?? row.ref, name: row.name, state: row.status, region: row.region }),
    url: text(row.id ?? row.ref) ? `https://${text(row.id ?? row.ref)}.supabase.co` : null,
  }));
}

/* ---------- Adapter ---------- */

const inventories: Partial<Record<CloudProviderKind, (ctx: AdapterContext) => Promise<ResourceSnapshot[]>>> = {
  CONTABO: contabo,
  LINODE: linode,
  VULTR: vultr,
  SCALEWAY: scaleway,
  SUPABASE: supabase,
};

/** Spacing between requests, from each provider's published limits. */
const SPACING_MS: Partial<Record<CloudProviderKind, number>> = { CONTABO: 400, LINODE: 250, VULTR: 600, SCALEWAY: 250, SUPABASE: 1100 };

export const VPS_PROVIDERS = Object.keys(inventories) as CloudProviderKind[];

export function vpsAdapter(provider: CloudProviderKind): CloudProviderAdapter {
  const inventory = inventories[provider];
  if (!inventory) throw new CloudApiError("Unsupported provider.", "config");
  return {
    ...catalogEntry(provider),
    minRequestSpacingMs: SPACING_MS[provider] ?? 500,
    verify: (ctx) => safeVerify(async () => {
      await inventory(ctx);
      return catalogEntry(provider).label;
    }),
    listResources: inventory,
    ...(provider === "LINODE" ? { getCosts: linodeCosts } : {}),
    ...(provider === "VULTR" ? { getCosts: vultrCosts } : {}),
  };
}
