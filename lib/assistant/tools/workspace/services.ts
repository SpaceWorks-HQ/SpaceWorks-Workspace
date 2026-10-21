import "server-only";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { canViewServices } from "@/lib/roles";
import { defineTool, plural } from "@/lib/assistant/tools/types";

/* ───────────── Services monitor (read models; empty until monitors exist) ───────────── */

export const listMonitors = defineTool({
  name: "sw_list_monitors",
  title: "Monitors",
  description: "List service monitors with their latest status (up, degraded, down, paused).",
  input: z.object({ status: z.enum(["any", "UP", "DEGRADED", "DOWN", "PAUSED", "MAINTENANCE", "PENDING", "UNKNOWN"]).default("any"), limit: z.number().int().min(1).max(100).default(50) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: (principal) => canViewServices(principal),
  async run(ctx, input) {
    const rows = await prisma.monitor.findMany({
      where: { workspaceId: ctx.principal.workspace.id, ...(input.status === "any" ? {} : { lastStatus: input.status }) },
      orderBy: [{ lastStatus: "asc" }, { name: "asc" }],
      take: input.limit,
      select: { id: true, name: true, type: true, enabled: true, lastStatus: true, lastCheckedAt: true, lastLatencyMs: true, tags: true },
    });
    return {
      summary: rows.length ? `Looked up ${plural(rows.length, "monitor")}` : "No monitors set up yet",
      data: {
        monitors: rows.map((m) => ({ id: m.id, name: m.name, type: m.type, enabled: m.enabled, status: m.lastStatus, lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null, latencyMs: m.lastLatencyMs, tags: m.tags })),
      },
    };
  },
});

export const listIncidents = defineTool({
  name: "sw_list_incidents",
  title: "Incidents",
  description: "List service incidents, open ones by default.",
  input: z.object({ status: z.enum(["open", "resolved", "all"]).default("open"), limit: z.number().int().min(1).max(50).default(20) }),
  write: false,
  scope: null,
  minRole: "MEMBER",
  available: (principal) => canViewServices(principal),
  async run(ctx, input) {
    const rows = await prisma.incident.findMany({
      where: {
        workspaceId: ctx.principal.workspace.id,
        ...(input.status === "open" ? { status: { not: "RESOLVED" } } : input.status === "resolved" ? { status: "RESOLVED" } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: input.limit,
      select: { number: true, title: true, status: true, severity: true, impact: true, startedAt: true, acknowledgedAt: true, resolvedAt: true },
    });
    return {
      summary: rows.length ? `Looked up ${plural(rows.length, "incident")}` : "No incidents",
      data: {
        incidents: rows.map((i) => ({
          number: i.number,
          title: i.title,
          status: i.status,
          severity: i.severity,
          impact: i.impact,
          startedAt: i.startedAt.toISOString(),
          acknowledged: Boolean(i.acknowledgedAt),
          resolvedAt: i.resolvedAt?.toISOString() ?? null,
          url: `/w/${ctx.principal.workspace.slug}/services`,
        })),
      },
    };
  },
});
