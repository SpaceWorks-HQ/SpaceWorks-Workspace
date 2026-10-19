import "server-only";
import { maintenanceState } from "./maintenanceService";

import type { IncidentImpact, IncidentSeverity, Prisma } from "@prisma/client";
import { nextWorkspaceSequence } from "@/lib/counters";
import { prisma } from "@/lib/db";
import { indexSearchDocument } from "@/lib/search/documents";
import { CHECK_ERROR_LABEL } from "@/lib/monitor/types";
import { EventBatch, incidentResponders, incidentUrl, monitorScope, monitorUrl, type MonitorRef, type WorkspaceRef } from "@/lib/monitor/notify";

/**
 * Automatic incidents opened and resolved by the checker, plus reminders.
 * Everything runs inside the caller's transaction; events are dispatched
 * with `{ tx }` and nudged after commit through the EventBatch.
 */

export type EngineMonitor = MonitorRef & { severity: IncidentSeverity; reminderIntervalMin: number };

export const IMPACT_FOR_SEVERITY: Record<IncidentSeverity, IncidentImpact> = { MINOR: "MINOR", MAJOR: "MAJOR", CRITICAL: "CRITICAL" };

export async function indexIncident(ws: WorkspaceRef, incident: { id: string; number: number; title: string }, client: Prisma.TransactionClient | typeof prisma = prisma) {
  await indexSearchDocument(
    { workspaceId: ws.id, entityType: "incident", entityId: incident.id, title: `INC-${incident.number} ${incident.title}`, url: incidentUrl(ws, incident.number) },
    client,
  );
}

export async function openAutoIncident(
  tx: Prisma.TransactionClient,
  batch: EventBatch,
  ws: WorkspaceRef,
  monitor: EngineMonitor,
  check: { id: string; error?: string | null; message?: string | null; statusCode?: number | null },
  now: Date,
  options: { notify: boolean; consecutiveFailures: number },
) {
  const number = await nextWorkspaceSequence(tx, ws.id, "incident");
  const reason = check.error ? CHECK_ERROR_LABEL[check.error] ?? check.error : "Check failed";
  const incident = await tx.incident.create({
    data: {
      workspaceId: ws.id,
      number,
      title: `${monitor.name} is down`,
      source: "AUTO",
      status: "INVESTIGATING",
      severity: monitor.severity,
      impact: IMPACT_FOR_SEVERITY[monitor.severity],
      startedAt: now,
      firstCheckId: check.id,
      nextReminderAt: monitor.reminderIntervalMin > 0 ? new Date(now.getTime() + monitor.reminderIntervalMin * 60_000) : null,
      monitors: { create: { monitorId: monitor.id } },
      updates: {
        create: {
          status: "INVESTIGATING",
          bodyMd: `Opened automatically after ${options.consecutiveFailures} failed checks. ${reason}${check.message ? `: ${check.message}` : "."}`.slice(0, 2000),
          public: false,
        },
      },
    },
  });
  await indexIncident(ws, incident, tx);
  if (!options.notify) return incident;
  const fields = [
    { label: "Reason", value: reason },
    ...(check.statusCode ? [{ label: "Status code", value: String(check.statusCode) }] : []),
    { label: "Incident", value: `INC-${number}` },
  ];
  await batch.send(ws.id, {
    type: "monitor.down",
    title: `${monitor.name} is down`,
    body: check.message ?? undefined,
    url: monitorUrl(ws, monitor.id),
    resource: { type: "monitor", id: monitor.id },
    scope: monitorScope(monitor, incident.id),
    fields,
    dedupeKey: `monitor:${monitor.id}:down:${incident.id}`,
    threadKey: `incident:${incident.id}`,
    useWorkspaceRules: monitor.useWorkspaceRules,
    occurredAt: now,
    data: { monitorId: monitor.id, incidentId: incident.id, statusCode: check.statusCode ?? null, error: check.error ?? null },
  });
  await batch.send(ws.id, {
    type: "incident.opened",
    title: `INC-${number}: ${monitor.name} is down`,
    body: check.message ?? undefined,
    url: incidentUrl(ws, number),
    recipients: await incidentResponders(ws.id, tx),
    resource: { type: "incident", id: incident.id },
    scope: monitorScope(monitor, incident.id),
    fields,
    actions: [
      { id: "ack", label: "Acknowledge", url: incidentUrl(ws, number) },
      { id: "open", label: "Open incident", url: incidentUrl(ws, number) },
    ],
    dedupeKey: `incident:${incident.id}:opened`,
    threadKey: `incident:${incident.id}`,
    useWorkspaceRules: monitor.useWorkspaceRules,
    occurredAt: now,
    data: { incidentId: incident.id, number, status: "INVESTIGATING", monitorIds: [monitor.id] },
  });
  return incident;
}

export async function resolveAutoIncident(
  tx: Prisma.TransactionClient,
  batch: EventBatch,
  ws: WorkspaceRef,
  monitor: EngineMonitor,
  incident: { id: string; number: number; startedAt: Date },
  now: Date,
  options: { notify: boolean },
) {
  const durationSec = Math.max(0, Math.round((now.getTime() - incident.startedAt.getTime()) / 1000));
  const resolved = await tx.incident.updateMany({
    where: { id: incident.id, workspaceId: ws.id, status: { not: "RESOLVED" } },
    data: { status: "RESOLVED", resolvedAt: now, durationSec, nextReminderAt: null, nextEscalationAt: null },
  });
  if (resolved.count === 0) return;
  await tx.incidentUpdate.create({ data: { incidentId: incident.id, status: "RESOLVED", bodyMd: `${monitor.name} recovered. Resolved automatically.`, public: true } });
  if (!options.notify) return;
  await batch.send(ws.id, {
    type: "monitor.up",
    title: `${monitor.name} is back up`,
    url: monitorUrl(ws, monitor.id),
    resource: { type: "monitor", id: monitor.id },
    scope: monitorScope(monitor, incident.id),
    fields: [{ label: "Down for", value: formatDuration(durationSec) }],
    dedupeKey: `monitor:${monitor.id}:up:${incident.id}`,
    threadKey: `incident:${incident.id}`,
    useWorkspaceRules: monitor.useWorkspaceRules,
    occurredAt: now,
    data: { monitorId: monitor.id, incidentId: incident.id, downtimeSec: durationSec },
  });
  await batch.send(ws.id, {
    type: "incident.resolved",
    title: `INC-${incident.number} resolved: ${monitor.name} is back up`,
    url: incidentUrl(ws, incident.number),
    recipients: await incidentResponders(ws.id, tx),
    resource: { type: "incident", id: incident.id },
    scope: monitorScope(monitor, incident.id),
    dedupeKey: `incident:${incident.id}:resolved`,
    threadKey: `incident:${incident.id}`,
    useWorkspaceRules: monitor.useWorkspaceRules,
    occurredAt: now,
    data: { incidentId: incident.id, number: incident.number, status: "RESOLVED", monitorIds: [monitor.id], durationSec },
  });
}

export function formatDuration(totalSec: number): string {
  if (totalSec < 60) return `${totalSec} s`;
  const minutes = Math.round(totalSec / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

/**
 * Reminders for open, unacknowledged incidents: claim each due reminder with
 * a conditional update (safe across replicas), then re-send incident.opened
 * with a unique dedupe key.
 */
export async function sendIncidentReminders(now: Date, limit = 50): Promise<number> {
  const due = await prisma.incident.findMany({
    where: { status: { not: "RESOLVED" }, acknowledgedAt: null, nextReminderAt: { lte: now } },
    select: { id: true, workspaceId: true, number: true, title: true, nextReminderAt: true, reminderCount: true, monitors: { select: { monitor: { select: { id: true, name: true, tags: true, useWorkspaceRules: true, reminderIntervalMin: true, flapping: true } } } } },
    take: limit,
  });
  let sent = 0;
  for (const incident of due) {
    const monitor = incident.monitors[0]?.monitor;
    const interval = monitor?.reminderIntervalMin ?? 60;
    if (incident.monitors.some(row => row.monitor.flapping)) continue;
    const maintenance = await Promise.all(incident.monitors.map(row => maintenanceState(prisma, incident.workspaceId, row.monitor.id, now)));
    if (maintenance.some(state => state.suppress)) continue;
    const batches: EventBatch[] = [];
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.incident.updateMany({
        where: { id: incident.id, workspaceId: incident.workspaceId, nextReminderAt: incident.nextReminderAt, acknowledgedAt: null, status: { not: "RESOLVED" } },
        data: { nextReminderAt: interval > 0 ? new Date(now.getTime() + interval * 60_000) : null, reminderCount: { increment: 1 } },
      });
      if (claimed.count === 0) return;
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: incident.workspaceId }, select: { id: true, slug: true } });
      const batch = new EventBatch(tx);
      batches.push(batch);
      const count = incident.reminderCount + 1;
      await batch.send(ws.id, {
        type: "incident.opened",
        title: `Reminder: INC-${incident.number} ${incident.title} is still open`,
        url: incidentUrl(ws, incident.number),
        recipients: await incidentResponders(ws.id, tx),
        resource: { type: "incident", id: incident.id },
        scope: monitor ? monitorScope(monitor, incident.id) : { incidentId: incident.id },
        actions: [{ id: "ack", label: "Acknowledge", url: incidentUrl(ws, incident.number) }],
        dedupeKey: `incident:${incident.id}:reminder:${count}`,
        threadKey: `incident:${incident.id}`,
        useWorkspaceRules: monitor?.useWorkspaceRules ?? true,
        occurredAt: now,
        data: { incidentId: incident.id, number: incident.number, status: "INVESTIGATING", monitorIds: incident.monitors.map((row) => row.monitor.id) },
      });
      sent += 1;
    });
    for (const batch of batches) await batch.afterCommit();
  }
  return sent;
}
