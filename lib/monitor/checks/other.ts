import "server-only";

import Redis from "ioredis";
import { Client as PgClient } from "pg";
import { getDomain } from "tldts";
import { down, latencyStatus, type CheckContext } from "@/lib/monitor/checks/context";
import { cacheGet, cacheSet, waitForSlot } from "@/lib/monitor/coord";
import { daysUntil, expiryStatus, parseRdapBootstrap, rdapBaseFor, rdapExpiration, rdapRegistrar, type RdapBootstrap } from "@/lib/monitor/expiry";
import { guardedRequest } from "@/lib/monitor/net/http";
import type { DomainConfig, PromqlConfig } from "@/lib/monitor/schemas";
import { checkPort, resolveTarget, STRICT_POLICY } from "@/lib/monitor/ssrf";
import type { CheckOutcome } from "@/lib/monitor/types";

const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const DAY_MS = 86_400_000;

async function rdapBootstrap(timeoutMs: number): Promise<RdapBootstrap> {
  const cached = await cacheGet<RdapBootstrap>("rdap:bootstrap");
  if (cached && cached.length > 0) return cached;
  const response = await guardedRequest({ url: RDAP_BOOTSTRAP_URL, timeoutMs, policy: STRICT_POLICY, headers: { accept: "application/json" } });
  if (!response.ok || response.status !== 200) return [];
  let parsed: RdapBootstrap = [];
  try {
    parsed = parseRdapBootstrap(JSON.parse(response.body));
  } catch {
    parsed = [];
  }
  if (parsed.length > 0) await cacheSet("rdap:bootstrap", parsed, DAY_MS);
  return parsed;
}

/** Domain expiry through RDAP (IANA bootstrap, 1 request/second per RDAP host). */
export async function runDomainCheck(config: DomainConfig, ctx: CheckContext): Promise<CheckOutcome & { daysLeft?: number; validTo?: Date }> {
  const domain = getDomain(config.domain, { allowPrivateDomains: false }) ?? config.domain.toLowerCase();
  const bootstrap = await rdapBootstrap(ctx.timeoutMs);
  if (bootstrap.length === 0) return { status: "UNKNOWN", latencyMs: null, error: "RDAP_UNAVAILABLE", message: "Couldn't load the RDAP directory. Trying again later." };
  const base = rdapBaseFor(domain, bootstrap);
  if (!base) return { status: "UNKNOWN", latencyMs: null, error: "RDAP_UNAVAILABLE", message: "This TLD is not in the RDAP directory, so its expiry can't be read." };
  const url = `${base}domain/${encodeURIComponent(domain)}`;
  if (!(await waitForSlot(`rdap:${new URL(base).host}`, 1000, 3000))) return { status: "UNKNOWN", latencyMs: null, error: "RDAP_UNAVAILABLE", message: "RDAP is busy. Trying again later." };
  const response = await guardedRequest({ url, timeoutMs: ctx.timeoutMs, policy: STRICT_POLICY, headers: { accept: "application/rdap+json, application/json" } });
  if (!response.ok) return { status: "UNKNOWN", latencyMs: null, error: response.error, message: `The RDAP server did not answer: ${response.message}` };
  if (response.status === 404) return down("DNS_FAIL", `${domain} is not registered.`, { latencyMs: response.latencyMs, statusCode: 404 });
  if (response.status !== 200) return { status: "UNKNOWN", latencyMs: response.latencyMs, statusCode: response.status, error: "RDAP_UNAVAILABLE", message: `The RDAP server answered ${response.status}.` };
  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch {
    return { status: "UNKNOWN", latencyMs: response.latencyMs, error: "RDAP_UNAVAILABLE", message: "The RDAP answer was not JSON." };
  }
  const expires = rdapExpiration(json);
  if (!expires) return { status: "UNKNOWN", latencyMs: response.latencyMs, error: "RDAP_UNAVAILABLE", message: "The registry does not publish an expiry date." };
  const daysLeft = daysUntil(expires, ctx.now);
  const status = expiryStatus(daysLeft, config.warnDays, config.criticalDays);
  return {
    status,
    latencyMs: response.latencyMs,
    ...(status === "UP" ? {} : { error: "DOMAIN_EXPIRING", message: daysLeft < 0 ? `${domain} has expired.` : `${domain} expires in ${daysLeft} days.` }),
    meta: { domain, domainDaysLeft: daysLeft, domainExpiresAt: expires.toISOString(), registrar: rdapRegistrar(json) },
    daysLeft,
    validTo: expires,
  };
}

function parseDbUrl(raw: string | undefined, schemes: string[]): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return schemes.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** PostgreSQL: connect to the validated IP, `SELECT 1`, close. */
export async function runPostgresCheck(ctx: CheckContext): Promise<CheckOutcome> {
  const url = parseDbUrl(ctx.secret?.connectionString, ["postgres:", "postgresql:"]);
  if (!url) return down("CONFIG", "Add a connection string like postgresql://user:password@host:5432/db.");
  const port = url.port ? Number(url.port) : 5432;
  const portVerdict = checkPort(port);
  if (!portVerdict.ok) return down(portVerdict.error, portVerdict.message);
  const target = await resolveTarget(url.hostname, ctx.policy, ctx.lookup);
  if (!target.ok) return down(target.error, target.message);
  const address = target.addresses[0].address;
  const sslmode = url.searchParams.get("sslmode");
  const client = new PgClient({
    host: address,
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined,
    connectionTimeoutMillis: ctx.timeoutMs,
    query_timeout: ctx.timeoutMs,
    statement_timeout: ctx.timeoutMs,
    ssl: sslmode && sslmode !== "disable" ? { rejectUnauthorized: sslmode === "verify-full", servername: target.hostname } : undefined,
  });
  client.on("error", () => undefined);
  const started = Date.now();
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void client.end().catch(() => undefined); }, ctx.timeoutMs);
  try {
    await client.connect();
    await client.query("SELECT 1");
    const latencyMs = Date.now() - started;
    return { status: latencyStatus(latencyMs, ctx.degradedLatencyMs), latencyMs, resolvedIp: address };
  } catch (error) {
    if (timedOut) return down("TIMEOUT", "No answer before the timeout.", { resolvedIp: address });
    const err = error as { code?: string; message?: string };
    if (err.code === "28P01" || err.code === "28000") return down("QUERY_FAILED", "The server rejected the credentials.", { resolvedIp: address });
    if (/timeout/i.test(err.message ?? "")) return down("TIMEOUT", "No answer before the timeout.", { resolvedIp: address });
    if (err.code === "ECONNREFUSED") return down("CONN_REFUSED", "The server refused the connection.", { resolvedIp: address });
    return down("QUERY_FAILED", "Couldn't connect and run SELECT 1.", { resolvedIp: address });
  } finally {
    clearTimeout(deadline);
    await client.end().catch(() => undefined);
  }
}

/** Redis: connect to the validated IP, `PING`, quit. */
export async function runRedisCheck(ctx: CheckContext): Promise<CheckOutcome> {
  const url = parseDbUrl(ctx.secret?.connectionString, ["redis:", "rediss:"]);
  if (!url) return down("CONFIG", "Add a connection string like redis://:password@host:6379/0.");
  const port = url.port ? Number(url.port) : 6379;
  const portVerdict = checkPort(port);
  if (!portVerdict.ok) return down(portVerdict.error, portVerdict.message);
  const target = await resolveTarget(url.hostname, ctx.policy, ctx.lookup);
  if (!target.ok) return down(target.error, target.message);
  const address = target.addresses[0].address;
  const client = new Redis({
    host: address,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.replace(/^\//, "")) || 0,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: ctx.timeoutMs,
    commandTimeout: ctx.timeoutMs,
    retryStrategy: () => null,
    tls: url.protocol === "rediss:" ? { servername: target.hostname } : undefined,
  });
  client.on("error", () => undefined);
  const started = Date.now();
  try {
    await client.connect();
    const reply = await client.ping();
    const latencyMs = Date.now() - started;
    if (reply !== "PONG") return down("QUERY_FAILED", "Redis did not answer PONG.", { latencyMs, resolvedIp: address });
    return { status: latencyStatus(latencyMs, ctx.degradedLatencyMs), latencyMs, resolvedIp: address };
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (/NOAUTH|WRONGPASS|invalid password/i.test(message)) return down("QUERY_FAILED", "Redis rejected the credentials.", { resolvedIp: address });
    if (/timeout|timed out/i.test(message)) return down("TIMEOUT", "No answer before the timeout.", { resolvedIp: address });
    return down("CONN_REFUSED", "Couldn't connect to Redis.", { resolvedIp: address });
  } finally {
    client.disconnect();
  }
}

/** Compare a number with a PromQL-style threshold. */
export function compareThreshold(value: number, op: PromqlConfig["op"], threshold: number): boolean {
  switch (op) {
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
  }
}

/** First sample value of a Prometheus instant-query answer. */
export function promqlValue(json: unknown): number | null {
  const data = (json as { status?: string; data?: { resultType?: string; result?: unknown } } | null) ?? null;
  if (!data || data.status !== "success" || !data.data) return null;
  const { resultType, result } = data.data;
  if (resultType === "scalar" && Array.isArray(result)) return Number.isFinite(Number(result[1])) ? Number(result[1]) : null;
  if (resultType === "vector" && Array.isArray(result) && result.length > 0) {
    const value = (result[0] as { value?: unknown[] }).value;
    if (Array.isArray(value)) {
      const number = Number(value[1]);
      return Number.isFinite(number) ? number : null;
    }
  }
  return null;
}

/** PROMQL: the condition (value op threshold) must hold for UP. */
export async function runPromqlCheck(config: PromqlConfig, ctx: CheckContext): Promise<CheckOutcome> {
  const url = new URL("api/v1/query", config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
  url.searchParams.set("query", config.query);
  const headers: Record<string, string> = { accept: "application/json" };
  for (const header of ctx.secret?.headers ?? []) headers[header.name.toLowerCase()] = header.value;
  const response = await guardedRequest({ url: url.toString(), timeoutMs: ctx.timeoutMs, policy: ctx.policy, lookup: ctx.lookup, headers });
  if (!response.ok) return down(response.error, response.message);
  if (response.status !== 200) return down("QUERY_FAILED", `Prometheus answered ${response.status}.`, { latencyMs: response.latencyMs, statusCode: response.status });
  let value: number | null = null;
  try {
    value = promqlValue(JSON.parse(response.body));
  } catch {
    value = null;
  }
  if (value === null) return down("QUERY_FAILED", "The query returned no numeric sample.", { latencyMs: response.latencyMs });
  const ok = compareThreshold(value, config.op, config.threshold);
  return {
    status: ok ? latencyStatus(response.latencyMs, ctx.degradedLatencyMs) : "DOWN",
    latencyMs: response.latencyMs,
    ...(ok ? {} : { error: "THRESHOLD", message: `Value ${value} does not satisfy ${config.op} ${config.threshold}.` }),
    meta: { value },
  };
}

const CLOUD_STATUS: Record<string, CheckOutcome["status"]> = { HEALTHY: "UP", DEGRADED: "DEGRADED", UNHEALTHY: "DOWN", STOPPED: "DOWN", UNKNOWN: "UNKNOWN" };

/** CLOUD_RESOURCE: mirror the synced resource health (stale data after 30 minutes → UNKNOWN). */
export function runCloudResourceCheck(ctx: CheckContext): CheckOutcome {
  const resource = ctx.cloudResource;
  if (!resource) return { status: "UNKNOWN", latencyMs: null, error: "CONFIG", message: "The linked cloud resource no longer exists." };
  if (resource.goneAt) return down("UNHEALTHY", "The resource disappeared from the provider.");
  const freshness = resource.connectionLastSyncAt ?? resource.lastSeenAt;
  if (ctx.now.getTime() - freshness.getTime() > 30 * 60_000) return { status: "UNKNOWN", latencyMs: null, error: "STALE", message: "No fresh data from the provider in the last 30 minutes." };
  const status = CLOUD_STATUS[resource.status] ?? "UNKNOWN";
  return {
    status,
    latencyMs: null,
    ...(status === "DOWN" ? { error: "UNHEALTHY", message: `Provider reports ${resource.statusDetail ?? resource.status.toLowerCase()}.` } : {}),
    meta: { providerStatus: resource.statusDetail },
  };
}
