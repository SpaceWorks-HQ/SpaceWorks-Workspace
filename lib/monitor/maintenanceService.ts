import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isWindowActive } from "./maintenance";

/** Active maintenance for a monitor: `inMaintenance` excludes the check from uptime, `suppress` also silences incidents/alerts. */
export async function maintenanceState(client: Prisma.TransactionClient | typeof prisma, workspaceId: string, monitorId: string, at: Date) {
  const windows = await client.maintenanceWindow.findMany({
    where: { workspaceId, OR: [{ allMonitors: true }, { monitors: { some: { monitorId } } }], AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: new Date(at.getTime() - 7 * 86_400_000) } }] }] },
    select: { startsAt: true, endsAt: true, rrule: true, durationMin: true, timezone: true, suppressAlerts: true },
  });
  const active = windows.filter((window) => isWindowActive(window, at));
  return { inMaintenance: active.length > 0, suppress: active.some((window) => window.suppressAlerts) };
}

