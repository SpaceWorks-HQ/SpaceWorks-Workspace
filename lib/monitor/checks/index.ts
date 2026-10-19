import "server-only";

import type { CheckContext } from "@/lib/monitor/checks/context";
import { runHttpCheck } from "@/lib/monitor/checks/http";
import { icmpPing, runDnsCheck, runPingCheck, runTcpCheck, runTlsCheck } from "@/lib/monitor/checks/network";
import { runCloudResourceCheck, runDomainCheck, runPostgresCheck, runPromqlCheck, runRedisCheck } from "@/lib/monitor/checks/other";
import { cacheGet, cacheSet } from "@/lib/monitor/coord";
import { parseMonitorConfig, type DnsConfig, type DomainConfig, type HttpConfig, type MonitorTypeName, type PingConfig, type PromqlConfig, type TcpConfig, type TlsConfig } from "@/lib/monitor/schemas";
import type { CheckOutcome } from "@/lib/monitor/types";

export type RunnableMonitor = {
  type: MonitorTypeName;
  config: unknown;
  retries: number;
  retryIntervalSec: number;
};

const NO_RETRY = new Set(["SSRF_BLOCKED", "CONFIG", "STATUS_MISMATCH", "ASSERTION_FAILED", "CERT_EXPIRING", "DOMAIN_EXPIRING", "TLS_INVALID"]);
const ICMP_KEY = Symbol.for("sww.monitorIcmp");

/** Can this host send ICMP? Self-tested once (ping 127.0.0.1) and shared through Redis. */
export async function icmpAvailable(): Promise<boolean> {
  const g = globalThis as typeof globalThis & { [ICMP_KEY]?: Promise<boolean> };
  g[ICMP_KEY] ??= (async () => {
    const result = await icmpPing("127.0.0.1", 2000);
    await cacheSet("capabilities:icmp", { icmp: result.ok, checkedAt: new Date().toISOString() }, 24 * 3_600_000);
    return result.ok;
  })();
  return g[ICMP_KEY];
}

/** What the monitor form shows ("ICMP unavailable on this host…"); null until a worker has run the self-test. */
export async function icmpCapability(): Promise<boolean | null> {
  const cached = await cacheGet<{ icmp: boolean }>("capabilities:icmp");
  return cached ? cached.icmp : null;
}

/** One attempt, no retries. Heartbeat monitors are push-based and never run here. */
export async function runCheckOnce(monitor: RunnableMonitor, ctx: CheckContext): Promise<CheckOutcome> {
  const parsed = parseMonitorConfig(monitor.type, monitor.config);
  if (!parsed.success) return { status: "DOWN", latencyMs: null, error: "CONFIG", message: parsed.error.issues[0]?.message ?? "The monitor settings are not valid." };
  const config = parsed.data;
  try {
    switch (monitor.type) {
      case "HTTP":
        return await runHttpCheck(config as HttpConfig, ctx);
      case "TCP":
        return await runTcpCheck(config as TcpConfig, ctx);
      case "PING":
        return await runPingCheck(config as PingConfig, { ...ctx, icmpAvailable: await icmpAvailable() });
      case "DNS":
        return await runDnsCheck(config as DnsConfig, ctx);
      case "TLS_CERT":
        return await runTlsCheck(config as TlsConfig, ctx);
      case "DOMAIN_EXPIRY":
        return await runDomainCheck(config as DomainConfig, ctx);
      case "POSTGRES":
        return await runPostgresCheck(ctx);
      case "REDIS":
        return await runRedisCheck(ctx);
      case "PROMQL":
        return await runPromqlCheck(config as PromqlConfig, ctx);
      case "CLOUD_RESOURCE":
        return runCloudResourceCheck(ctx);
      case "HEARTBEAT":
        return { status: "UNKNOWN", latencyMs: null, error: "CONFIG", message: "Heartbeat monitors wait for pings." };
    }
  } catch {
    return { status: "DOWN", latencyMs: null, error: "NETWORK_ERROR", message: "The check failed unexpectedly." };
  }
}

/**
 * Run with immediate re-checks on failure; only the final attempt is the
 * stored result (earlier attempts go to `meta.attempts`). `maxWaitMs` caps
 * the time spent waiting between attempts so a run fits its budget.
 */
export async function runCheckWithRetries(
  monitor: RunnableMonitor,
  ctx: CheckContext,
  options: { sleep?: (ms: number) => Promise<void>; maxWaitMs?: number } = {},
): Promise<CheckOutcome> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let budget = options.maxWaitMs ?? 30_000;
  const attempts: Array<{ status: string; error?: string }> = [];
  let outcome = await runCheckOnce(monitor, ctx);
  for (let attempt = 0; attempt < monitor.retries && outcome.status === "DOWN" && !NO_RETRY.has(outcome.error ?? ""); attempt += 1) {
    const wait = Math.min(monitor.retryIntervalSec * 1000, budget);
    if (wait <= 0) break;
    attempts.push({ status: outcome.status, error: outcome.error });
    budget -= wait;
    await sleep(wait);
    outcome = await runCheckOnce(monitor, { ...ctx, now: new Date(ctx.now.getTime() + wait) });
  }
  if (attempts.length > 0) outcome = { ...outcome, meta: { ...(outcome.meta ?? {}), attempts } };
  return outcome;
}
