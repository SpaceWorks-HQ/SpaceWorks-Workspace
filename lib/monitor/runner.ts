import "server-only";

import type { Prisma } from "@prisma/client";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { runCheckWithRetries } from "@/lib/monitor/checks";
import type { CheckContext } from "@/lib/monitor/checks/context";
import { refreshCatalogueStatus } from "@/lib/monitor/catalogue";
import { crossedThreshold } from "@/lib/monitor/expiry";
import { openAutoIncident, resolveAutoIncident } from "@/lib/monitor/incidents";
import { maintenanceState } from "@/lib/monitor/maintenanceService";
import { EventBatch, monitorScope, monitorUrl } from "@/lib/monitor/notify";
import type { MonitorTypeName, TlsConfig, DomainConfig } from "@/lib/monitor/schemas";
import { loadNetworkPolicy, openMonitorSecret } from "@/lib/monitor/secrets";
import { nextMonitorState, type MonitorState } from "@/lib/monitor/stateMachine";
import type { LookupFn } from "@/lib/monitor/ssrf";
import type { CheckOutcome } from "@/lib/monitor/types";

/**
 * Turns one check outcome into a stored MonitorCheck, the monitor's new
 * state, incidents and notifications, all in one transaction (the monitor
 * row is locked FOR UPDATE so heartbeat pings and scheduled checks never
 * interleave).
 */

const HOUR_MS = 3_600_000;

function jitteredNext(now: Date, intervalSec: number, random = Math.random) {
  const jitter = intervalSec * 0.1 * (random() * 2 - 1);
  return new Date(now.getTime() + Math.max(5, intervalSec + jitter) * 1000);
}

function daysLeftFromMeta(meta: unknown, key: "certDaysLeft" | "domainDaysLeft"): number | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "number" ? value : null;
}

export type RecordOptions = {
  /** Scheduled checks set the next run (with jitter); heartbeat pings leave it alone. */
  schedule?: boolean;
  /** Heartbeat: update lastPingAt / expectedNextAt in the same transaction. */
  heartbeat?: { lastPingAt?: Date; expectedNextAt?: Date | null };
  random?: () => number;
  tx?: Prisma.TransactionClient;
  batches?: EventBatch[];
  expectedNextAt?: Date;
};

export async function recordOutcome(monitorId: string, outcome: CheckOutcome, now: Date, options: RecordOptions = {}) {
  let batch: EventBatch | null = null;
  const work = async (tx: Prisma.TransactionClient) => {
      await tx.$queryRaw`SELECT "id" FROM "Monitor" WHERE "id" = ${monitorId} FOR UPDATE`;
      const monitor = await tx.monitor.findUnique({ where: { id: monitorId }, include: { workspace: { select: { id: true, slug: true } } } });
      if (!monitor) return null;
      if (options.expectedNextAt && monitor.expectedNextAt?.getTime() !== options.expectedNextAt.getTime()) return null;
      if (!monitor.enabled) {
        await tx.monitor.update({ where: { id: monitorId }, data: { leaseUntil: null } });
        return null;
      }
      const ws = monitor.workspace;
      batch = new EventBatch(tx);
      const maintenance = await maintenanceState(tx, ws.id, monitor.id, now);
      const openIncident = await tx.incident.findFirst({
        where: { workspaceId: ws.id, source: "AUTO", status: { not: "RESOLVED" }, monitors: { some: { monitorId: monitor.id } } },
        orderBy: { startedAt: "desc" },
        select: { id: true, number: true, startedAt: true },
      });
      const recentIncidentCount = await tx.incident.count({ where: { workspaceId: ws.id, source: "AUTO", startedAt: { gte: new Date(now.getTime() - HOUR_MS) }, monitors: { some: { monitorId: monitor.id } } } });
      const previous = await tx.monitorCheck.findFirst({ where: { monitorId: monitor.id, workspaceId: ws.id }, orderBy: { checkedAt: "desc" }, select: { error: true, meta: true } });

      const check = await tx.monitorCheck.create({
        data: {
          monitorId: monitor.id,
          workspaceId: ws.id,
          checkedAt: now,
          status: outcome.status,
          latencyMs: outcome.latencyMs,
          statusCode: outcome.statusCode ?? null,
          error: outcome.error ?? null,
          message: outcome.message?.slice(0, 500) ?? null,
          inMaintenance: maintenance.inMaintenance,
          meta: { ...(outcome.meta ?? {}), ...(outcome.resolvedIp ? { ip: outcome.resolvedIp } : {}), ...(outcome.assertions ? { assertions: outcome.assertions } : {}) } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });

      let stableForSec: number | undefined;
      if (monitor.flapping && openIncident && outcome.status !== "DOWN" && !(outcome.status === "DEGRADED" && monitor.incidentOnDegraded)) {
        const failure = await tx.monitorCheck.findFirst({ where: { workspaceId: ws.id, monitorId: monitor.id, status: { in: monitor.incidentOnDegraded ? ["DOWN", "DEGRADED"] : ["DOWN"] } }, orderBy: { checkedAt: "desc" }, select: { checkedAt: true } });
        const recovery = await tx.monitorCheck.findFirst({ where: { workspaceId: ws.id, monitorId: monitor.id, checkedAt: { gt: failure?.checkedAt ?? openIncident.startedAt }, status: { in: monitor.incidentOnDegraded ? ["UP"] : ["UP", "DEGRADED"] } }, orderBy: { checkedAt: "asc" }, select: { checkedAt: true } });
        stableForSec = recovery ? Math.max(0, (now.getTime() - recovery.checkedAt.getTime()) / 1000) : 0;
      }
      const machine = nextMonitorState({
        monitor: {
          lastStatus: monitor.lastStatus as MonitorState,
          consecutiveFailures: monitor.consecutiveFailures,
          consecutiveSuccesses: monitor.consecutiveSuccesses,
          failureThreshold: monitor.failureThreshold,
          successThreshold: monitor.successThreshold,
          incidentOnDegraded: monitor.incidentOnDegraded,
          flapping: monitor.flapping,
          intervalSec: monitor.intervalSec,
        },
        outcome: outcome.status,
        inMaintenance: maintenance.suppress,
        hasOpenIncident: Boolean(openIncident),
        recentIncidentCount,
        stableForSec,
      });
      const status = maintenance.inMaintenance ? "MAINTENANCE" : machine.status;

      await tx.monitor.update({
        where: { id: monitor.id },
        data: {
          lastStatus: status,
          lastCheckedAt: now,
          lastLatencyMs: outcome.latencyMs,
          consecutiveFailures: machine.consecutiveFailures,
          consecutiveSuccesses: machine.consecutiveSuccesses,
          flapping: machine.flapping,
          leaseUntil: null,
          ...(options.schedule ? { nextCheckAt: jitteredNext(now, monitor.intervalSec, options.random) } : {}),
          ...(options.heartbeat?.lastPingAt ? { lastPingAt: options.heartbeat.lastPingAt } : {}),
          ...(options.heartbeat && options.heartbeat.expectedNextAt !== undefined ? { expectedNextAt: options.heartbeat.expectedNextAt } : {}),
        },
      });

      const engineMonitor = { id: monitor.id, name: monitor.name, tags: monitor.tags, useWorkspaceRules: monitor.useWorkspaceRules, severity: monitor.severity, reminderIntervalMin: monitor.reminderIntervalMin };
      if (machine.openIncident) {
        await openAutoIncident(tx, batch, ws, engineMonitor, { id: check.id, error: outcome.error, message: outcome.message, statusCode: outcome.statusCode }, now, {
          notify: machine.notify,
          consecutiveFailures: machine.consecutiveFailures,
        });
      }
      if (machine.resolveIncident && openIncident) await resolveAutoIncident(tx, batch, ws, engineMonitor, openIncident, now, { notify: machine.notify });
      if (machine.emitDegraded) {
        await batch.send(ws.id, {
          type: "monitor.degraded",
          title: `${monitor.name} is degraded`,
          body: outcome.message,
          url: monitorUrl(ws, monitor.id),
          resource: { type: "monitor", id: monitor.id },
          scope: monitorScope(engineMonitor),
          dedupeKey: `monitor:${monitor.id}:degraded`,
          useWorkspaceRules: monitor.useWorkspaceRules,
          occurredAt: now,
          data: { monitorId: monitor.id, latencyMs: outcome.latencyMs },
        });
      }

      if (!maintenance.suppress) await expiryEvents(batch, ws, monitor, engineMonitor, outcome, previous?.meta ?? null, now);

      if (outcome.error === "SSRF_BLOCKED" && previous?.error !== "SSRF_BLOCKED") {
        await recordAuditEvent({ action: "monitor.ssrf_blocked", workspaceId: ws.id, targetType: "monitor", targetId: monitor.id, metadata: { type: monitor.type }, client: tx });
      }
      return { checkId: check.id, status, previousStatus: monitor.lastStatus, workspaceId: ws.id };
    };
  const result = options.tx ? await work(options.tx) : await prisma.$transaction(work, { timeout: 20_000 });
  if (batch && options.batches) options.batches.push(batch);
  if (batch && !options.tx) await (batch as EventBatch).afterCommit();
  if (!options.tx && result && result.status !== result.previousStatus) await refreshCatalogueStatus(result.workspaceId, monitorId).catch(() => undefined);
  return result;
}

async function expiryEvents(
  batch: EventBatch,
  ws: { id: string; slug: string },
  monitor: { id: string; type: string; config: Prisma.JsonValue; name: string; useWorkspaceRules: boolean },
  engineMonitor: { id: string; name: string; tags: string[]; useWorkspaceRules: boolean },
  outcome: CheckOutcome,
  previousMeta: Prisma.JsonValue | null,
  now: Date,
) {
  const config = (monitor.config ?? {}) as Partial<TlsConfig & DomainConfig>;
  const certDays = daysLeftFromMeta(outcome.meta, "certDaysLeft");
  if (certDays !== null && (monitor.type === "TLS_CERT" || monitor.type === "HTTP")) {
    const warn = config.warnDays ?? 21;
    const critical = config.criticalDays ?? 7;
    const crossed = crossedThreshold(daysLeftFromMeta(previousMeta, "certDaysLeft"), certDays, warn, critical);
    const validTo = typeof outcome.meta?.certValidTo === "string" ? outcome.meta.certValidTo : now.toISOString();
    if (crossed !== null) {
      const host = monitor.type === "TLS_CERT" ? String(config.host ?? monitor.name) : safeHost((monitor.config as { url?: string } | null)?.url) ?? monitor.name;
      await batch.send(ws.id, {
        type: "cert.expiring",
        severity: certDays <= critical ? "critical" : "warning",
        title: certDays < 0 ? `The certificate for ${host} has expired` : `The certificate for ${host} expires in ${certDays} days`,
        url: monitorUrl(ws, monitor.id),
        resource: { type: "monitor", id: monitor.id },
        scope: monitorScope(engineMonitor),
        dedupeKey: `cert:${monitor.id}:${crossed}`,
        useWorkspaceRules: monitor.useWorkspaceRules,
        occurredAt: now,
        data: { monitorId: monitor.id, host, daysLeft: certDays, validTo },
      });
    }
  }
  const domainDays = daysLeftFromMeta(outcome.meta, "domainDaysLeft");
  if (domainDays !== null && monitor.type === "DOMAIN_EXPIRY") {
    const warn = config.warnDays ?? 30;
    const critical = config.criticalDays ?? 7;
    const crossed = crossedThreshold(daysLeftFromMeta(previousMeta, "domainDaysLeft"), domainDays, warn, critical);
    if (crossed !== null) {
      const domain = typeof outcome.meta?.domain === "string" ? outcome.meta.domain : String(config.domain ?? monitor.name);
      await batch.send(ws.id, {
        type: "domain.expiring",
        severity: domainDays <= critical ? "critical" : "warning",
        title: domainDays < 0 ? `${domain} has expired` : `${domain} expires in ${domainDays} days`,
        url: monitorUrl(ws, monitor.id),
        resource: { type: "monitor", id: monitor.id },
        scope: monitorScope(engineMonitor),
        dedupeKey: `domain:${monitor.id}:${crossed}`,
        useWorkspaceRules: monitor.useWorkspaceRules,
        occurredAt: now,
        data: { monitorId: monitor.id, domain, daysLeft: domainDays, expiresAt: typeof outcome.meta?.domainExpiresAt === "string" ? outcome.meta.domainExpiresAt : now.toISOString() },
      });
    }
  }
}

function safeHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Build the check context for a stored monitor (policy, decrypted secret, cloud resource). */
export async function contextForMonitor(
  monitor: { id: string; workspaceId: string; type: string; timeoutMs: number; degradedLatencyMs: number | null; secretEnc: string | null; cloudResourceId: string | null },
  now: Date,
  lookup?: LookupFn,
): Promise<CheckContext> {
  const [policy, resource] = await Promise.all([
    loadNetworkPolicy(monitor.workspaceId),
    monitor.type === "CLOUD_RESOURCE" && monitor.cloudResourceId
      ? prisma.cloudResource.findFirst({
          where: { id: monitor.cloudResourceId, workspaceId: monitor.workspaceId },
          select: { status: true, statusDetail: true, lastSeenAt: true, goneAt: true, connection: { select: { lastSyncAt: true } } },
        })
      : Promise.resolve(null),
  ]);
  return {
    policy,
    timeoutMs: monitor.timeoutMs,
    degradedLatencyMs: monitor.degradedLatencyMs,
    secret: openMonitorSecret(monitor.secretEnc),
    now,
    lookup,
    cloudResource: resource ? { status: resource.status, statusDetail: resource.statusDetail, lastSeenAt: resource.lastSeenAt, goneAt: resource.goneAt, connectionLastSyncAt: resource.connection.lastSyncAt } : null,
  };
}

/** Run one claimed monitor end to end. */
export async function executeMonitor(monitorId: string, now = new Date(), options: { lookup?: LookupFn; maxRetryWaitMs?: number } = {}) {
  const monitor = await prisma.monitor.findUnique({ where: { id: monitorId } });
  if (!monitor || !monitor.enabled || monitor.type === "HEARTBEAT") {
    await prisma.monitor.updateMany({ where: { id: monitorId }, data: { leaseUntil: null } });
    return null;
  }
  const startedAt = Date.now();
  const ctx = await contextForMonitor(monitor, now, options.lookup);
  const outcome = await runCheckWithRetries({ type: monitor.type as MonitorTypeName, config: monitor.config, retries: monitor.retries, retryIntervalSec: monitor.retryIntervalSec }, ctx, { maxWaitMs: options.maxRetryWaitMs });
  return recordOutcome(monitorId, outcome, new Date(now.getTime() + (Date.now() - startedAt)), { schedule: true });
}
