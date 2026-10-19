import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
import { claimDueMonitors } from "@/lib/monitor/scheduler";
import { sendIncidentReminders } from "@/lib/monitor/incidents";
import { recordOutcome } from "@/lib/monitor/runner";
import { computeRollups, hourStart, runRetention } from "@/lib/monitor/rollups";
import { handlePing, newHeartbeatToken, sweepHeartbeats } from "@/lib/monitor/heartbeatService";
import { publicSummary } from "@/lib/monitor/public";
import { manageService, saveMonitor } from "@/lib/monitor/manage";
import { sealCloudCredentials, openCloudCredentials } from "@/lib/monitor/secrets";
import type { WorkspaceContext } from "@/lib/permissions";
import { canViewCosts, canViewServices } from "@/lib/roles";

const suffix = uniqueSuffix(), slug = `monitor-${suffix}`, otherSlug = `monitor-other-${suffix}`, domain = `@monitor-${suffix}.test`;
let ownerId: string, workspaceId: string, otherId: string, ctx: WorkspaceContext;
const at = new Date();
const createMonitor = (name: string, extra: object = {}) => prisma.monitor.create({ data: { workspaceId, name, type: 'HTTP', config: { url: 'https://example.com' }, nextCheckAt: new Date(at.getTime() + 86400000), ...extra } });

describe.sequential('monitor tenant lifecycle', () => {
  beforeAll(async () => {
    // No test in this suite is allowed to contact a real cloud API.
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound provider request'); }));
    ownerId = (await createUser(`owner${domain}`)).id;
    const workspace = await createWorkspace(slug, ownerId); workspaceId = workspace.id;
    otherId = (await createWorkspace(otherSlug, ownerId)).id;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } });
    const membership = await prisma.membership.findUniqueOrThrow({ where: { userId_workspaceId: { workspaceId, userId: ownerId } } });
    ctx = { user, workspace, membership } as WorkspaceContext;
  });
  afterAll(async () => { vi.unstubAllGlobals(); await cleanup([slug, otherSlug], domain); await prisma.$disconnect(); });

  it('claims each due monitor once across simultaneous replicas', async () => {
    const rows = await Promise.all(Array.from({ length: 8 }, (_, i) => createMonitor(`claim ${i}`, { nextCheckAt: new Date(at.getTime() - 1000) })));
    const claims = await Promise.all(Array.from({ length: 4 }, () => claimDueMonitors(at, 3)));
    const all = claims.flat().map(m => m.id).filter(id => rows.some(r => r.id === id));
    expect(all).toHaveLength(8); expect(new Set(all).size).toBe(8);
    await prisma.monitor.deleteMany({ where: { workspaceId, id: { in: rows.map(r => r.id) } } });
  });
  it('serializes failure confirmation, dispatches one opening and resolves after recovery', async () => {
    const m = await createMonitor('failure confirmation', { failureThreshold: 2, successThreshold: 2 });
    await Promise.all([recordOutcome(m.id, { status: 'DOWN', latencyMs: 5, error: 'TIMEOUT' }, at), recordOutcome(m.id, { status: 'DOWN', latencyMs: 8, error: 'TIMEOUT' }, at)]);
    const incidents = await prisma.incident.findMany({ where: { workspaceId, monitors: { some: { monitorId: m.id } } } });
    expect(incidents).toHaveLength(1);
    const events = await prisma.notificationEventRecord.findMany({ where: { workspaceId, dedupeKey: `incident:${incidents[0].id}:opened`, type: 'incident.opened' } }); expect(events).toHaveLength(1);
    await recordOutcome(m.id, { status: 'UP', latencyMs: 5 }, new Date(at.getTime() + 60000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incidents[0].id } })).status).toBe('INVESTIGATING');
    await recordOutcome(m.id, { status: 'UP', latencyMs: 5 }, new Date(at.getTime() + 120000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incidents[0].id } })).status).toBe('RESOLVED');
    expect(await prisma.notificationEventRecord.count({ where: { workspaceId, type: 'monitor.up', dedupeKey: `monitor:${m.id}:up:${incidents[0].id}` } })).toBe(1);
  });
  it('records maintenance outcomes without opening incidents or alerting', async () => {
    const m = await createMonitor('maintenance', { failureThreshold: 1 });
    const window = await prisma.maintenanceWindow.create({ data: { workspaceId, title: 'Upgrade', startsAt: new Date(at.getTime() - 60000), endsAt: new Date(at.getTime() + 60000), suppressAlerts: true, monitors: { create: { monitorId: m.id } } } });
    await recordOutcome(m.id, { status: 'DOWN', latencyMs: null }, at);
    expect(await prisma.incident.count({ where: { workspaceId, monitors: { some: { monitorId: m.id } } } })).toBe(0);
    expect((await prisma.monitorCheck.findFirstOrThrow({ where: { workspaceId, monitorId: m.id } })).inMaintenance).toBe(true);
    await prisma.maintenanceWindow.delete({ where: { id: window.id } });
  });
  it('requires elapsed stable recovery time for a flapping push monitor', async () => {
    const m = await createMonitor('fast flapping samples', { failureThreshold: 1, successThreshold: 2, intervalSec: 900, flapping: true });
    await recordOutcome(m.id, { status: 'DOWN', latencyMs: 2 }, at);
    const incident = await prisma.incident.findFirstOrThrow({ where: { workspaceId, monitors: { some: { monitorId: m.id } } } });
    await recordOutcome(m.id, { status: 'UP', latencyMs: 2 }, new Date(at.getTime() + 1000));
    await recordOutcome(m.id, { status: 'UP', latencyMs: 2 }, new Date(at.getTime() + 2000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe('INVESTIGATING');
    await recordOutcome(m.id, { status: 'UP', latencyMs: 2 }, new Date(at.getTime() + 901000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe('RESOLVED');
  });
  it('suppresses reminders during maintenance and flapping', async () => {
    const m = await createMonitor('reminder suppression', { failureThreshold: 1, reminderIntervalMin: 5 });
    await recordOutcome(m.id, { status: 'DOWN', latencyMs: 2 }, at);
    const incident = await prisma.incident.findFirstOrThrow({ where: { workspaceId, monitors: { some: { monitorId: m.id } } } });
    const window = await prisma.maintenanceWindow.create({ data: { workspaceId, title: 'Planned repair', startsAt: at, endsAt: new Date(at.getTime() + 600000), monitors: { create: { monitorId: m.id } } } });
    await sendIncidentReminders(new Date(at.getTime() + 360000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).reminderCount).toBe(0);
    await prisma.maintenanceWindow.delete({ where: { id: window.id } });
    await prisma.monitor.update({ where: { id: m.id }, data: { flapping: true } });
    await sendIncidentReminders(new Date(at.getTime() + 720000));
    expect((await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).reminderCount).toBe(0);
  });
  it('authenticates heartbeat hashes, rejects rotated tokens and handles cron grace', async () => {
    const token = newHeartbeatToken();
    const m = await createMonitor('nightly build', { type: 'HEARTBEAT', config: { periodSec: 60, graceSec: 10 }, heartbeatTokenHash: token.hash, heartbeatTokenHint: token.hint, expectedNextAt: at, failureThreshold: 1, successThreshold: 1 });
    expect(token.hash).not.toContain(token.token);
    expect((await handlePing({ token: token.token + 'x', now: at })).status).toBe(404);
    expect((await handlePing({ token: token.token, now: at })).status).toBe(200);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: m.id } })).lastStatus).toBe('UP');
    expect(await sweepHeartbeats(new Date(at.getTime() + 70000))).toBe(0);
    expect(await sweepHeartbeats(new Date(at.getTime() + 71000))).toBe(1);
    const result = await manageService(ctx, { command: 'rotateHeartbeat', id: m.id }); expect(result.ok).toBe(true);
    expect((await handlePing({ token: token.token })).status).toBe(404);
  });
  it('exports only chosen monitors and sanitized automatic incident text', async () => {
    const internal = await createMonitor('private database address', { config: { url: 'https://private.example.com/secret' } });
    const chosen = await createMonitor('internal host name', { failureThreshold: 1 });
    await recordOutcome(chosen.id, { status: 'DOWN', latencyMs: 1, message: 'sensitive.internal failed', error: 'TIMEOUT' }, at);
    await prisma.statusPage.create({ data: { workspaceId, slug, title: 'Community services', enabled: true, components: { create: { monitorId: chosen.id, key: 'website', displayName: 'Website' } } } });
    const summary = await publicSummary(slug, at); expect(summary?.components).toHaveLength(1); expect(summary?.components[0].displayName).toBe('Website');
    const serialized = JSON.stringify(summary); for (const privateValue of [internal.id, chosen.id, 'sensitive.internal', 'internal host name', 'secretEnc', 'private.example.com']) expect(serialized).not.toContain(privateValue);
    expect(await publicSummary(otherSlug)).toBeNull();
    await prisma.statusPage.update({ where: { workspaceId }, data: { enabled: false } }); expect(await publicSummary(slug)).toBeNull();
  });
  it('rejects cross-workspace mutations and monitor references', async () => {
    const foreign = await prisma.monitor.create({ data: { workspaceId: otherId, name: 'other tenant', type: 'HEARTBEAT' } });
    expect((await manageService(ctx, { command: 'pause', id: foreign.id, enabled: false })).ok).toBe(false);
    expect((await manageService(ctx, { command: 'createIncident', title: 'Invalid association', bodyMd: 'Check', monitorIds: [foreign.id] })).ok).toBe(false);
    expect((await manageService(ctx, { command: 'statusPage', enabled: true, title: 'Status', components: [{ monitorId: foreign.id, key: 'foreign', displayName: 'Foreign' }] })).ok).toBe(false);
    expect((await prisma.monitor.findUniqueOrThrow({ where: { id: foreign.id } })).enabled).toBe(true);
  });
  it('enforces admin management and optional member acknowledgement/cost access', async () => {
    const user = await createUser(`member${domain}`), membership = await addMember(workspaceId, user.id, 'MEMBER');
    const member = { ...ctx, user, membership } as WorkspaceContext;
    expect(canViewServices(membership)).toBe(true); expect(canViewServices({ ...membership, role: 'GUEST' })).toBe(false);
    expect(canViewCosts(membership, { costsVisibleToMembers: false })).toBe(false);
    expect((await saveMonitor(member, { name: 'Invalid', type: 'HEARTBEAT', config: {} })).ok).toBe(false);
    expect((await manageService(member, { command: 'settings', membersCanAckIncidents: true, costsVisibleToMembers: true, monitorRetentionDays: 14 })).ok).toBe(false);
    const incident = await prisma.incident.create({ data: { workspaceId, number: 999, title: 'Manual', source: 'MANUAL' } });
    expect((await manageService(member, { command: 'acknowledge', id: incident.id })).ok).toBe(false);
    const allowed = { ...member, workspace: { ...member.workspace, membersCanAckIncidents: true } };
    expect((await manageService(allowed, { command: 'acknowledge', id: incident.id })).ok).toBe(true);
  });
  it('encrypts cloud credentials, rejects tampering and denies member replacement before provider calls', async () => {
    const enc = sealCloudCredentials({ token: 'fixture-secret-token' }); expect(enc).not.toContain('fixture-secret-token'); expect(openCloudCredentials(enc)).toEqual({ token: 'fixture-secret-token' });
    expect(() => openCloudCredentials(enc.slice(0, -5) + 'xxxxx')).toThrow();
    const memberCtx = { ...ctx, membership: { ...ctx.membership, role: 'MEMBER' as const } };
    expect((await manageService(memberCtx, { command: 'cloudAccount', provider: 'DIGITALOCEAN', label: 'Denied', credentials: { token: 'fixture-secret-token' } })).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('verifies and saves admin cloud credentials as ciphertext using mocked fetch', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ account: { email: 'fixture@example.test' } }));
    const result = await manageService(ctx, { command: 'cloudAccount', provider: 'DIGITALOCEAN', label: 'Fixture account', credentials: { token: 'fixture-cloud-secret' } });
    expect(result.ok).toBe(true);
    const row = await prisma.cloudConnection.findFirstOrThrow({ where: { workspaceId, label: 'Fixture account' } });
    expect(row.credentialsEnc).not.toContain('fixture-cloud-secret'); expect(openCloudCredentials(row.credentialsEnc)).toEqual({ token: 'fixture-cloud-secret' }); expect(row.config).not.toHaveProperty('token');
    await prisma.cloudConnection.delete({ where: { id: row.id } });
    vi.mocked(fetch).mockImplementation(() => { throw new Error('Unexpected outbound provider request'); });
  });
  it('computes idempotent SQL rollups with interpolated percentiles', async () => {
    const m = await createMonitor('rollup fixture'); const start = hourStart(at), end = new Date(start.getTime() + 3600000);
    await prisma.monitorCheck.createMany({ data: [10, 20, 30, 40].map((latencyMs, i) => ({ monitorId: m.id, workspaceId, checkedAt: start, status: i === 0 ? 'DOWN' as const : 'UP' as const, latencyMs, inMaintenance: i === 0 })) });
    await computeRollups('HOUR', start, end, m.id); await computeRollups('HOUR', start, end, m.id);
    const rows = await prisma.monitorRollup.findMany({ where: { workspaceId, monitorId: m.id } }); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ total: 4, up: 3, down: 0, maintenance: 1, latencyP50: 25, latencyP95: 39 });
    const earlier = new Date(start.getTime() - 7200000);
    await prisma.monitorCheck.create({ data: { workspaceId, monitorId: m.id, checkedAt: earlier, status: 'UP', latencyMs: 8 } });
    await computeRollups('HOUR', earlier, end, m.id);
    expect(await prisma.monitorRollup.count({ where: { workspaceId, monitorId: m.id } })).toBe(2);
  });
  it('retains long-term summaries while purging old raw outcomes', async () => {
    const m = await createMonitor('retention fixture'), old = new Date(at.getTime() - 40 * 86400000);
    await prisma.monitorCheck.create({ data: { workspaceId, monitorId: m.id, checkedAt: old, status: 'UP' } });
    await computeRollups('DAY', old, new Date(old.getTime() + 86400000), m.id);
    await runRetention(at, { force: true });
    expect(await prisma.monitorCheck.count({ where: { workspaceId, monitorId: m.id } })).toBe(0); expect(await prisma.monitorRollup.count({ where: { workspaceId, monitorId: m.id } })).toBe(1);
  });
});
