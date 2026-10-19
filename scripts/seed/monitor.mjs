import { createHash, randomBytes } from "node:crypto";

/** Demonstration history only; never connects to a cloud provider. */
export default async function seedMonitor(prisma, { workspaceId, workspace, users }) {
  if (await prisma.monitor.count({ where: { workspaceId } })) return;
  const now = new Date(), dayMs = 86400000;
  const definitions = [
    { name: "Community website", type: "HTTP", config: { url: "https://example.com", method: "GET", expectedStatus: "200-299", followRedirects: true, ignoreTls: false, assertions: [] }, lastStatus: "UP", lastLatencyMs: 124, tags: ["env:production", "public"] },
    { name: "Build night API", type: "HTTP", config: { url: "https://example.com", method: "GET", expectedStatus: "200-299", followRedirects: true, ignoreTls: false, assertions: [] }, lastStatus: "DEGRADED", lastLatencyMs: 780, degradedLatencyMs: 600, tags: ["env:staging"] },
    { name: "Nightly backup", type: "HEARTBEAT", config: { schedule: "CRON", cronExpr: "0 3 * * *", timezone: workspace.timezone, periodSec: 86400, graceSec: 900, maxRunSec: 3600 }, lastStatus: "UP", lastLatencyMs: 420, tags: ["env:production", "backup"], heartbeatTokenHash: createHash("sha256").update(randomBytes(32)).digest("hex") },
  ];
  const monitors = [];
  for (const definition of definitions) {
    const monitor = await prisma.monitor.create({ data: { workspaceId, ...definition, lastCheckedAt: now, lastPingAt: definition.type === "HEARTBEAT" ? now : null, nextCheckAt: new Date(now.getTime() + 3600000) } });
    monitors.push(monitor);
    const buckets = [];
    for (let day = 89; day >= 0; day--) {
      const bucketStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
      const down = day === 3 && definition.type === "HTTP" ? 4 : 0, latency = 100 + (day % 7) * 12;
      buckets.push({ workspaceId, monitorId: monitor.id, granularity: "DAY", bucketStart, total: 1440, up: 1440 - down, degraded: 0, down, maintenance: 0, downtimeSec: down * 60, latencyAvg: latency, latencyMin: latency - 20, latencyMax: latency + 120, latencyP50: latency, latencyP95: latency + 60 });
    }
    await prisma.monitorRollup.createMany({ data: buckets });
    await prisma.monitorCheck.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ workspaceId, monitorId: monitor.id, checkedAt: new Date(now.getTime() - (59 - i) * 60000), status: definition.lastStatus, latencyMs: definition.lastLatencyMs + (i % 7) * 5 })) });
  }
  const counter = await prisma.workspaceCounter.upsert({ where: { workspaceId_name: { workspaceId, name: "incident" } }, create: { workspaceId, name: "incident", value: 1 }, update: { value: { increment: 1 } } });
  await prisma.incident.create({ data: { workspaceId, number: counter.value, title: "Website response delay", source: "MANUAL", status: "RESOLVED", impact: "MINOR", public: true, startedAt: new Date(now.getTime() - 3 * dayMs), resolvedAt: new Date(now.getTime() - 3 * dayMs + 240000), durationSec: 240, monitors: { create: { monitorId: monitors[0].id } }, updates: { create: [{ status: "INVESTIGATING", bodyMd: "We are investigating slow responses on the community website.", public: true, createdAt: new Date(now.getTime() - 3 * dayMs) }, { status: "RESOLVED", bodyMd: "Responses returned to normal. We will review the cache settings before the next build night.", public: true, createdAt: new Date(now.getTime() - 3 * dayMs + 240000) }] } } });
  await prisma.maintenanceWindow.create({ data: { workspaceId, title: "Weekly service care", startsAt: new Date(now.getTime() + dayMs), endsAt: new Date(now.getTime() + dayMs + 1800000), timezone: workspace.timezone, allMonitors: true, suppressAlerts: true } });
  // Public sharing stays opt-in even for demo workspaces.
  await prisma.statusPage.upsert({ where: { workspaceId }, create: { workspaceId, slug: workspace.slug, title: "Space Works service status", enabled: false, components: { create: [{ monitorId: monitors[0].id, key: "website", displayName: "Community website" }] } }, update: {} });
  const participants = Object.values(users).map(u => u.id).filter(Boolean).slice(0, 3);
  if (participants.length) await prisma.onCallSchedule.create({ data: { workspaceId, name: "Service crew", participants, timezone: workspace.timezone } });
}
