import "server-only";

import type { MonitorStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { worstStatus } from "@/lib/monitor/stats";

/**
 * Cross-area write (docs/ROADMAP-BUILD.md): `ServiceCatalogItem.cachedStatus`
 * is the worst-of its linked monitors and cloud resources.
 */

const RESOURCE_TO_MONITOR: Record<string, MonitorStatus> = { HEALTHY: "UP", DEGRADED: "DEGRADED", UNHEALTHY: "DOWN", STOPPED: "DOWN", UNKNOWN: "UNKNOWN" };

export async function refreshCatalogueStatus(workspaceId: string, target: string, targetType: "MONITOR" | "CLOUD_RESOURCE" = "MONITOR") {
  const links = await prisma.serviceLink.findMany({ where: { targetType, targetId: target, service: { workspaceId } }, select: { serviceId: true } });
  for (const serviceId of new Set(links.map((link) => link.serviceId))) {
    const all = await prisma.serviceLink.findMany({ where: { serviceId, targetType: { in: ["MONITOR", "CLOUD_RESOURCE"] } }, select: { targetType: true, targetId: true } });
    const monitorIds = all.filter((link) => link.targetType === "MONITOR").map((link) => link.targetId);
    const resourceIds = all.filter((link) => link.targetType === "CLOUD_RESOURCE").map((link) => link.targetId);
    const [monitors, resources] = await Promise.all([
      prisma.monitor.findMany({ where: { workspaceId, id: { in: monitorIds }, enabled: true }, select: { lastStatus: true } }),
      prisma.cloudResource.findMany({ where: { workspaceId, id: { in: resourceIds }, goneAt: null }, select: { status: true } }),
    ]);
    const statuses = [...monitors.map((monitor) => monitor.lastStatus as string), ...resources.map((resource) => RESOURCE_TO_MONITOR[resource.status] as string)];
    const worst = worstStatus(statuses) as MonitorStatus | null;
    await prisma.serviceCatalogItem.updateMany({ where: { id: serviceId, workspaceId }, data: { cachedStatus: worst } });
  }
}
