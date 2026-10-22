import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { WorkspaceContext } from "@/lib/permissions";
import { canManageServices, canAckIncidents, canManageCloudAccounts } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument, removeSearchDocument } from "@/lib/search/documents";
import { nextWorkspaceSequence } from "@/lib/counters";
import { dispatch } from "@/lib/notify";
import { setScopedDestinations, getScopedDestinationIds } from "@/lib/notify/scopedRules";
import { monitorInputSchema, parseMonitorConfig, DEFAULT_INTERVAL_SEC, type HeartbeatConfig, type MonitorSecret } from "./schemas";
import { actionError, validationError, NOT_ALLOWED, type ActionResult } from "@/lib/actionResult";
import { parseAssertion } from "./assertions";
import { nextExpectedAt, validateCron } from "./heartbeat";
import { newHeartbeatToken } from "./heartbeatService";
import { sealMonitorSecret, loadNetworkPolicy, openMonitorSecret, sealCloudCredentials, credentialHint } from "./secrets";
import { checkAddress, resolveTarget, normalizeAllowlistEntry, privateTargetsEnabled } from "./ssrf";
import { parseRrule } from "./maintenance";
import { EventBatch, incidentResponders, incidentUrl, monitorUrl } from "./notify";
import { indexIncident } from "./incidents";
import { runCheckOnce } from "./checks";
import { contextForMonitor } from "./runner";
import { serviceCommandSchema } from "./inputs";
import { providerAdapter } from "./cloud";
import { createProviderHttp } from "./cloud/http";
import { catalogEntry } from "./cloud/catalog";

type Result = ActionResult<Record<string, string>>;
class InputError extends Error {}
const json = (value: unknown) => value as Prisma.InputJsonValue;
const maxMonitors = () => Math.max(1, Number.parseInt(process.env.MONITOR_MAX_PER_WORKSPACE ?? "100", 10) || 100);
async function lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string) { await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR NO KEY UPDATE`; }
async function audit(tx: Prisma.TransactionClient, ctx: WorkspaceContext, action: string, targetType: string, targetId: string) {
  await recordAuditEvent({ workspaceId: ctx.workspace.id, actorId: ctx.user.id, action, targetType, targetId, client: tx });
}
async function requireMonitors(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (await tx.monitor.count({ where: { workspaceId, id: { in: unique } } }) !== unique.length) throw new InputError("Choose monitors from this workspace.");
  return unique;
}
export async function validateTarget(workspaceId: string, type: string, config: Record<string, unknown>, secret: MonitorSecret | null) {
  const policy = await loadNetworkPolicy(workspaceId);
  if (type === "HEARTBEAT") {
    const hb = config as HeartbeatConfig;
    try { new Intl.DateTimeFormat("en", { timeZone: hb.timezone }); } catch { throw new InputError("Choose a valid time zone."); }
    if (hb.schedule === "CRON") { const error = validateCron(hb.cronExpr ?? "", hb.timezone); if (error) throw new InputError(error); }
    return;
  }
  if (type === "CLOUD_RESOURCE") return;
  let host = String(config.host ?? config.hostname ?? config.domain ?? "");
  if (type === "HTTP" || type === "PROMQL" || type === "POSTGRES" || type === "REDIS") {
    const raw = type === "HTTP" ? config.url : type === "PROMQL" ? config.baseUrl : secret?.connectionString;
    if (typeof raw !== "string") throw new InputError("Add the connection details.");
    const url = new URL(raw);
    const schemes = type === "POSTGRES" ? ["postgres:", "postgresql:"] : type === "REDIS" ? ["redis:", "rediss:"] : ["http:", "https:"];
    if (!schemes.includes(url.protocol)) throw new InputError("Use a supported connection scheme.");
    if ((type === "HTTP" || type === "PROMQL") && (url.username || url.password)) throw new InputError("Put credentials in secret headers.");
    host = url.hostname;
  }
  // DNS queries do not connect to their answers. The selected resolver is guarded independently.
  if (type !== "DNS" && type !== "DOMAIN_EXPIRY") { const resolved = await resolveTarget(host, policy); if (!resolved.ok) throw new InputError(resolved.message); }
  if (type === "DNS" && config.resolver) { const v = checkAddress(String(config.resolver), policy); if (!v.ok) throw new InputError(v.message); }
  for (const expression of Array.isArray(config.assertions) ? config.assertions : []) { const parsed = parseAssertion(String(expression)); if (!parsed.ok) throw new InputError(parsed.error); }
}
export async function saveMonitor(ctx: WorkspaceContext, raw: unknown, monitorId?: string): Promise<Result> {
  if (!canManageServices(ctx.membership)) return actionError(NOT_ALLOWED);
  const parsed = monitorInputSchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);
  const input = parsed.data;
  const config = parseMonitorConfig(input.type, input.config);
  if (!config.success) return validationError(config.error);
  const ws = ctx.workspace;
  try {
    const existing = monitorId ? await prisma.monitor.findFirst({ where: { id: monitorId, workspaceId: ws.id } }) : null;
    if (monitorId && !existing) return actionError("Monitor not found.");
    if (existing && existing.type !== input.type) return actionError("Create a new monitor to change its type.");
    let secret = input.secret === undefined ? openMonitorSecret(existing?.secretEnc ?? null) : input.secret;
    if (input.type === "HTTP") {
      const http = config.data as import("./schemas").HttpConfig;
      if (http.headers.length) {
        const headers = new Map([...(secret?.headers ?? []), ...http.headers].map(h => [h.name.toLowerCase(), h]));
        secret = { ...secret, headers: [...headers.values()] };
        http.headers = [];
      }
    }
    await validateTarget(ws.id, input.type, config.data as Record<string, unknown>, secret ?? null);
    const token = input.type === "HEARTBEAT" && !existing ? newHeartbeatToken() : null;
    const row = await prisma.$transaction(async tx => {
      await lockWorkspace(tx, ws.id);
      if (!existing && await tx.monitor.count({ where: { workspaceId: ws.id } }) >= maxMonitors()) throw new InputError("This workspace has reached its monitor limit. Remove a monitor or ask the instance admin to raise it.");
      if (input.projectId && !await tx.project.findFirst({ where: { id: input.projectId, workspaceId: ws.id }, select: { id: true } })) throw new InputError("Choose a project from this workspace.");
      if (input.cloudResourceId && !await tx.cloudResource.findFirst({ where: { id: input.cloudResourceId, workspaceId: ws.id }, select: { id: true } })) throw new InputError("Choose a cloud resource from this workspace.");
      const data = { name: input.name, type: input.type, tags: [...new Set([...input.tags.filter(t => !t.startsWith("env:")), ...(input.environment ? [`env:${input.environment}`] : [])])], projectId: input.projectId || null, severity: input.severity, config: json(config.data), secretEnc: sealMonitorSecret(secret ?? null), intervalSec: input.intervalSec ?? DEFAULT_INTERVAL_SEC[input.type], timeoutMs: input.timeoutMs, retries: input.retries, retryIntervalSec: input.retryIntervalSec, failureThreshold: input.failureThreshold, successThreshold: input.successThreshold, degradedLatencyMs: input.degradedLatencyMs ?? null, incidentOnDegraded: input.incidentOnDegraded, reminderIntervalMin: input.reminderIntervalMin, useWorkspaceRules: input.useWorkspaceRules, cloudResourceId: input.cloudResourceId || null };
      const row = existing ? await tx.monitor.update({ where: { id: existing.id, workspaceId: ws.id }, data }) : await tx.monitor.create({ data: { ...data, workspaceId: ws.id, createdById: ctx.user.id, ...(token ? { heartbeatTokenHash: token.hash, heartbeatTokenHint: token.hint, expectedNextAt: nextExpectedAt(config.data as HeartbeatConfig, new Date()) } : {}) } });
      await setScopedDestinations(tx, { workspaceId: ws.id, scopeType: "MONITOR", scopeId: row.id, destinationIds: input.destinationIds, actorId: ctx.user.id });
      await indexSearchDocument({ workspaceId: ws.id, entityType: "monitor", entityId: row.id, title: row.name, url: monitorUrl(ws, row.id) }, tx);
      await recordActivity({ workspaceId: ws.id, actorId: ctx.user.id, verb: existing ? "updated" : "created", entityType: "monitor", entityId: row.id, summary: `${existing ? "Updated" : "Created"} monitor ${row.name}` }, tx);
      await audit(tx, ctx, existing ? "monitor.updated" : "monitor.created", "monitor", row.id);
      return row;
    });
    return { ok: true, data: { id: row.id, ...(token ? { token: token.token } : {}) } };
  } catch (error) { return actionError(error instanceof InputError ? error.message : "Couldn't save the monitor. Check the details and try again."); }
}
export async function manageService(ctx: WorkspaceContext, raw: unknown): Promise<Result> {
  const parsed = serviceCommandSchema.safeParse(raw);
  if (!parsed.success) return validationError(parsed.error);
  const c = parsed.data, ws = ctx.workspace, workspaceId = ws.id;
  if (c.command === "acknowledge" ? !canAckIncidents(ctx.membership, ws) : !canManageServices(ctx.membership)) return actionError(NOT_ALLOWED);
  try {
    if (c.command === "cloudAccount") {
      if (!canManageCloudAccounts(ctx.membership)) return actionError(NOT_ALLOWED);
      const adapter = providerAdapter(c.provider);
      const fields = catalogEntry(c.provider).credentialFields;
      const config = Object.fromEntries(fields.filter(f => !f.secret).map(f => [f.key, c.config[f.key]]).filter(([, v]) => v !== undefined));
      const credentials = Object.fromEntries(fields.filter(f => f.secret).map(f => [f.key, c.credentials[f.key] ?? ""]));
      for (const f of fields) if (!f.optional && !(f.secret ? credentials[f.key] : config[f.key])) throw new InputError(`Add ${f.label.toLowerCase()}.`);
      if (c.id && !await prisma.cloudConnection.findFirst({ where: { id: c.id, workspaceId, provider: c.provider }, select: { id: true } })) throw new InputError("Cloud account not found.");
      if (c.provider === "AWS" && ((!credentials.accessKeyId || !credentials.secretAccessKey) && !config.roleArn)) throw new InputError("Add both AWS access keys or a role ARN with an External ID.");
      if (c.provider === "AWS" && config.roleArn && !credentials.externalId) throw new InputError("Add the External ID from the role trust policy.");
      const signal = AbortSignal.timeout(40000);
      const verified = await adapter.verify({ credentials, config, http: createProviderHttp({ key: `verify:${workspaceId}:${c.provider}`, spacingMs: adapter.minRequestSpacingMs, signal }), now: new Date(), signal });
      if (!verified.ok) return actionError(verified.error);
      const row = await prisma.$transaction(async tx => {
        const data = { provider: c.provider, label: c.label, credentialsEnc: sealCloudCredentials(credentials), credentialsHint: credentialHint(credentials, fields.filter(f => f.secret).map(f => f.key)), config: json({ ...config, autoCreateMonitors: c.autoCreateMonitors }), accountLabel: verified.accountLabel, lastVerifiedAt: new Date(), lastError: null, nextSyncAt: new Date() };
        const row = c.id ? await tx.cloudConnection.update({ where: { id: c.id, workspaceId }, data }) : await tx.cloudConnection.create({ data: { ...data, workspaceId, createdById: ctx.user.id } });
        await audit(tx, ctx, c.id ? "cloud_connection.credentials_replaced" : "cloud_connection.created", "cloud_connection", row.id); return row;
      });
      return { ok: true, data: { id: row.id } };
    }
    if (c.command === "syncCloud") {
      const row = await prisma.cloudConnection.findFirst({ where: { id: c.id, workspaceId }, select: { id: true } });
      if (!row) throw new InputError("Cloud account not found.");
      await prisma.cloudConnection.updateMany({ where: { id: c.id, workspaceId }, data: { nextSyncAt: new Date() } });
      // The worker performs provider calls outside the request lifetime.
      await recordAuditEvent({ workspaceId, actorId: ctx.user.id, action: "cloud_connection.sync_requested", targetType: "cloud_connection", targetId: c.id });
      return { ok: true };
    }
    const batches: EventBatch[] = [];
    const after: Array<() => Promise<void>> = [];
    const data = await prisma.$transaction(async tx => {
      const batch = new EventBatch(tx); batches.push(batch);
      if (["pause", "deleteMonitor", "rotateHeartbeat", "testMonitor", "testAlert"].includes(c.command) && "id" in c) {
        const monitor = await tx.monitor.findFirst({ where: { id: c.id, workspaceId } });
        if (!monitor) throw new InputError("Monitor not found.");
        if (c.command === "pause") { await tx.monitor.update({ where: { id: c.id, workspaceId }, data: { enabled: c.enabled, lastStatus: c.enabled ? "PENDING" : "PAUSED", consecutiveFailures: 0, consecutiveSuccesses: 0, nextCheckAt: new Date(), ...(monitor.type === "HEARTBEAT" && c.enabled ? { expectedNextAt: nextExpectedAt(monitor.config as HeartbeatConfig, new Date()) } : {}) } }); await audit(tx, ctx, "monitor.paused", "monitor", c.id); }
        if (c.command === "deleteMonitor") {
          await tx.monitor.delete({ where: { id: c.id, workspaceId } });
          await setScopedDestinations(tx, { workspaceId, scopeType: "MONITOR", scopeId: c.id, destinationIds: [], actorId: ctx.user.id });
          await removeSearchDocument("monitor", c.id, tx); await audit(tx, ctx, "monitor.deleted", "monitor", c.id);
        }
        if (c.command === "rotateHeartbeat") {
          if (monitor.type !== "HEARTBEAT") throw new InputError("Choose a heartbeat monitor.");
          const token = newHeartbeatToken();
          await tx.monitor.update({ where: { id: c.id, workspaceId }, data: { heartbeatTokenHash: token.hash, heartbeatTokenHint: token.hint } }); await audit(tx, ctx, "monitor.token_rotated", "monitor", c.id); return { token: token.token };
        }
        if (c.command === "testAlert") {
          const ids = await getScopedDestinationIds(workspaceId, "MONITOR", c.id, tx);
          const result = await dispatch(workspaceId, { type: "monitor.test", title: `Test alert for ${monitor.name}`, actorId: ctx.user.id, scope: { monitorId: c.id }, data: { monitorId: c.id } }, { tx, test: true, onlyDestinationIds: ids });
          // dispatch's afterCommit is called below through a separate result.
          after.push(result.afterCommit); await audit(tx, ctx, "monitor.test_alert", "monitor", c.id);
        }
        if (c.command === "testMonitor") return { testMonitorId: c.id };
      } else if (c.command === "acknowledge" || c.command === "updateIncident" || c.command === "postmortem" || c.command === "followUp") {
        await tx.$queryRaw`SELECT "id" FROM "Incident" WHERE "id" = ${c.id} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
        const incident = await tx.incident.findFirst({ where: { id: c.id, workspaceId }, include: { monitors: { select: { monitorId: true } } } });
        if (!incident) throw new InputError("Incident not found.");
        const ref = { incidentId: incident.id, number: incident.number, status: incident.status, monitorIds: incident.monitors.map(m => m.monitorId) };
        const event = { title: `INC-${incident.number}: ${incident.title}`, url: incidentUrl(ws, incident.number), actorId: ctx.user.id, recipients: await incidentResponders(workspaceId, tx), resource: { type: "incident", id: incident.id }, scope: { incidentId: incident.id }, threadKey: `incident:${incident.id}` };
        if (c.command === "acknowledge") {
          if (!incident.acknowledgedAt && incident.status !== "RESOLVED") {
            await tx.incident.update({ where: { id: c.id, workspaceId }, data: { acknowledgedAt: new Date(), acknowledgedById: ctx.user.id, nextReminderAt: null, nextEscalationAt: null } });
            await tx.incidentUpdate.create({ data: { incidentId: c.id, status: incident.status, bodyMd: `${ctx.user.name ?? "A member"} acknowledged the incident.`, public: false, authorId: ctx.user.id } });
            await batch.send(workspaceId, { ...event, type: "incident.acknowledged", dedupeKey: `incident:${c.id}:ack`, data: { ...ref, acknowledgedById: ctx.user.id } });
          }
        } else if (c.command === "updateIncident") {
          if (incident.status === "RESOLVED" && c.status !== "RESOLVED") throw new InputError("Create a new incident for a new outage.");
          const now = new Date(), durationSec = Math.round((now.getTime() - incident.startedAt.getTime()) / 1000);
          await tx.incident.update({ where: { id: c.id, workspaceId }, data: { status: c.status, ...(c.status === "RESOLVED" ? { resolvedAt: now, durationSec, nextReminderAt: null, nextEscalationAt: null } : {}) } });
          await tx.incidentUpdate.create({ data: { incidentId: c.id, status: c.status, bodyMd: c.bodyMd, public: c.public, authorId: ctx.user.id } });
          if (c.status === "RESOLVED" && incident.status !== "RESOLVED") await batch.send(workspaceId, { ...event, type: "incident.resolved", data: { ...ref, status: c.status, durationSec } });
          else await batch.send(workspaceId, { ...event, type: "incident.updated", data: { ...ref, status: c.status } });
        } else if (c.command === "postmortem") {
          if (c.postmortemDocId && !await tx.doc.findFirst({ where: { id: c.postmortemDocId, workspaceId }, select: { id: true } })) throw new InputError("Choose a document from this workspace.");
          await tx.incident.update({ where: { id: c.id, workspaceId }, data: { postmortemMd: c.postmortemMd, postmortemDocId: c.postmortemDocId || null } });
        } else {
          if (c.projectId && !await tx.project.findFirst({ where: { id: c.projectId, workspaceId }, select: { id: true } })) throw new InputError("Choose a project from this workspace.");
          const number = await nextWorkspaceSequence(tx, workspaceId, "task");
          const task = await tx.task.create({ data: { workspaceId, number, title: c.title, projectId: c.projectId || null, creatorId: ctx.user.id } });
          await tx.recordLink.create({ data: { workspaceId, fromType: "incident", fromId: c.id, toType: "task", toId: task.id, createdById: ctx.user.id } });
          await audit(tx, ctx, "incident.follow_up_created", "incident", c.id); return { id: task.id };
        }
        await audit(tx, ctx, `incident.${c.command === "acknowledge" ? "acknowledged" : "updated"}`, "incident", c.id);
      } else if (c.command === "createIncident") {
        const ids = await requireMonitors(tx, workspaceId, c.monitorIds);
        if (c.escalationPolicyId && !await tx.escalationPolicy.findFirst({ where: { id: c.escalationPolicyId, workspaceId }, select: { id: true } })) throw new InputError("Choose a policy from this workspace.");
        const number = await nextWorkspaceSequence(tx, workspaceId, "incident");
        const row = await tx.incident.create({ data: { workspaceId, number, title: c.title, source: "MANUAL", public: c.public, impact: c.impact, createdById: ctx.user.id, escalationPolicyId: c.escalationPolicyId, nextEscalationAt: c.escalationPolicyId ? new Date() : null, monitors: { create: ids.map(monitorId => ({ monitorId })) }, updates: { create: { status: "INVESTIGATING", bodyMd: c.bodyMd, public: c.public, authorId: ctx.user.id } } } });
        await indexIncident(ws, row, tx); await audit(tx, ctx, "incident.created", "incident", row.id);
        await recordActivity({ workspaceId, actorId: ctx.user.id, verb: "created", entityType: "incident", entityId: row.id, summary: `Opened INC-${number}: ${row.title}` }, tx);
        await batch.send(workspaceId, { type: "incident.opened", title: row.title, actorId: ctx.user.id, recipients: await incidentResponders(workspaceId, tx), scope: { incidentId: row.id }, threadKey: `incident:${row.id}`, data: { incidentId: row.id, number, status: row.status, monitorIds: ids } }); return { id: row.id, number: String(number) };
      } else if (c.command === "maintenance") {
        try { new Intl.DateTimeFormat("en", { timeZone: c.timezone }); } catch { throw new InputError("Choose a valid time zone."); }
        if (c.rrule ? !parseRrule(c.rrule) || !c.durationMin : !c.endsAt || new Date(c.endsAt) <= new Date(c.startsAt)) throw new InputError("Set an end after the start, or a supported recurrence and duration.");
        if (c.endsAt && new Date(c.endsAt) <= new Date(c.startsAt)) throw new InputError("Set an end after the start.");
        const ids = await requireMonitors(tx, workspaceId, c.monitorIds);
        if (!c.allMonitors && !ids.length) throw new InputError("Choose affected monitors or select all monitors.");
        const row = await tx.maintenanceWindow.create({ data: { workspaceId, title: c.title, descriptionMd: c.descriptionMd, startsAt: new Date(c.startsAt), endsAt: c.endsAt ? new Date(c.endsAt) : null, rrule: c.rrule || null, durationMin: c.durationMin, timezone: c.timezone, allMonitors: c.allMonitors, suppressAlerts: c.suppressAlerts, showOnStatusPage: c.showOnStatusPage, createdById: ctx.user.id, monitors: { create: ids.map(monitorId => ({ monitorId })) } } });
        await audit(tx, ctx, "maintenance.created", "maintenance", row.id); return { id: row.id };
      } else if (c.command === "deleteMaintenance") { await tx.maintenanceWindow.deleteMany({ where: { id: c.id, workspaceId } }); await audit(tx, ctx, "maintenance.deleted", "maintenance", c.id);
      } else if (c.command === "settings") { await tx.workspace.update({ where: { id: workspaceId }, data: { membersCanAckIncidents: c.membersCanAckIncidents, costsVisibleToMembers: c.costsVisibleToMembers, monitorRetentionDays: c.monitorRetentionDays } }); await audit(tx, ctx, "monitor.settings_updated", "workspace", workspaceId);
      } else if (c.command === "allowlist") {
        const entry = normalizeAllowlistEntry(c.cidrOrHost);
        if (!privateTargetsEnabled() || !entry) throw new InputError("Private targets must be enabled by the instance admin. Enter a valid host or CIDR.");
        await tx.monitorNetworkAllowlist.upsert({ where: { workspaceId_cidrOrHost: { workspaceId, cidrOrHost: entry } }, create: { workspaceId, cidrOrHost: entry, note: c.note, createdById: ctx.user.id }, update: { note: c.note } }); await audit(tx, ctx, "allowlist.changed", "workspace", workspaceId);
      } else if (c.command === "deleteAllowlist") { await tx.monitorNetworkAllowlist.deleteMany({ where: { id: c.id, workspaceId } }); await audit(tx, ctx, "allowlist.changed", "workspace", workspaceId);
      } else if (c.command === "statusPage") {
        await lockWorkspace(tx, workspaceId);
        await requireMonitors(tx, workspaceId, c.components.map(x => x.monitorId));
        if (new Set(c.components.map(x => x.key)).size !== c.components.length) throw new InputError("Give each component a unique badge key.");
        const data = { enabled: c.enabled, title: c.title, descriptionMd: c.descriptionMd, footerMd: c.footerMd, noindex: c.noindex, showUptimePercent: c.showUptimePercent };
        const row = await tx.statusPage.upsert({ where: { workspaceId }, create: { workspaceId, slug: ws.slug, ...data }, update: data });
        await tx.statusPageComponent.deleteMany({ where: { statusPageId: row.id } });
        await tx.statusPageComponent.createMany({ data: c.components.map((component, sortOrder) => ({ ...component, statusPageId: row.id, sortOrder })) }); await audit(tx, ctx, "status_page.updated", "status_page", row.id);
      } else if (c.command === "deleteCloud") { await tx.cloudConnection.deleteMany({ where: { id: c.id, workspaceId } }); await audit(tx, ctx, "cloud_connection.deleted", "cloud_connection", c.id);
      } else if (c.command === "budget") {
        if (c.connectionId && !await tx.cloudConnection.findFirst({ where: { id: c.connectionId, workspaceId }, select: { id: true } })) throw new InputError("Choose a cloud account from this workspace.");
        const row = await tx.costBudget.create({ data: { workspaceId, connectionId: c.connectionId || null, monthlyLimitMinor: c.monthlyLimitMinor, currency: c.currency, thresholdsPct: [...new Set(c.thresholdsPct)] } });
        await setScopedDestinations(tx, { workspaceId, scopeType: "COST_BUDGET", scopeId: row.id, destinationIds: c.destinationIds, actorId: ctx.user.id }); await audit(tx, ctx, "monitor.budget_created", "cost_budget", row.id);
      } else if (c.command === "onCall") {
        const users = [...new Set([...c.participants, ...c.overrides.map(o => o.userId)])];
        if (await tx.membership.count({ where: { workspaceId, status: "ACTIVE", role: { not: "GUEST" }, userId: { in: users } } }) !== users.length) throw new InputError("Choose active members from this workspace.");
        try { new Intl.DateTimeFormat("en", { timeZone: c.timezone }); } catch { throw new InputError("Choose a valid time zone."); }
        if (c.overrides.some(o => new Date(o.end) <= new Date(o.start))) throw new InputError("Override end must follow its start.");
        const row = await tx.onCallSchedule.create({ data: { workspaceId, name: c.name, timezone: c.timezone, rotation: c.rotation, handoffTime: c.handoffTime, participants: c.participants, overrides: c.overrides } }); await audit(tx, ctx, "monitor.on_call_created", "on_call", row.id);
      } else if (c.command === "escalationPolicy") {
        for (const step of c.steps) for (const target of step.targets) {
          const found = target.type === "USER" ? await tx.membership.findFirst({ where: { workspaceId, userId: target.id, status: "ACTIVE", role: { not: "GUEST" } } }) : target.type === "SCHEDULE" ? await tx.onCallSchedule.findFirst({ where: { id: target.id, workspaceId } }) : await tx.notificationDestination.findFirst({ where: { id: target.id, workspaceId, enabled: true } });
          if (!found) throw new InputError("Choose escalation targets from this workspace.");
        }
        const row = await tx.escalationPolicy.create({ data: { workspaceId, name: c.name, steps: c.steps, repeat: c.repeat } }); await audit(tx, ctx, "monitor.policy_created", "escalation_policy", row.id);
      }
      return {};
    }, { timeout: 20000 });
    for (const batch of batches) await batch.afterCommit();
    for (const fn of after.splice(0)) await fn();
    if (data.testMonitorId) {
      const monitor = await prisma.monitor.findFirstOrThrow({ where: { id: data.testMonitorId, workspaceId } });
      const outcome = await runCheckOnce({ type: monitor.type, config: monitor.config, retries: 0, retryIntervalSec: 0 }, await contextForMonitor(monitor, new Date()));
      return { ok: true, data: { status: outcome.status, message: outcome.message ?? "Check completed." } };
    }
    return { ok: true, data: data as Record<string, string> };
  } catch (error) { return actionError(error instanceof InputError ? error.message : "Couldn't save. Check the details and try again."); }
}
