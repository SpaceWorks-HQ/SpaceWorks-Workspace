import type { MonitorStatus } from "@prisma/client";
const scores: Record<MonitorStatus, number> = { PAUSED: 0, MAINTENANCE: 1, UP: 2, PENDING: 3, UNKNOWN: 4, DEGRADED: 5, DOWN: 6 };
export function worstStatus(statuses: MonitorStatus[]): MonitorStatus {
 return statuses.reduce<MonitorStatus>((worst, s) => scores[s] > scores[worst] ? s : worst, statuses[0] ?? "UNKNOWN");
}
export function cloudStatus(status: string): MonitorStatus {
 return ({ HEALTHY: "UP", RUNNING: "UP", ACTIVE: "UP", DEGRADED: "DEGRADED", UNHEALTHY: "DOWN", STOPPED: "DOWN", ERROR: "DOWN", DELETED: "DOWN", UNKNOWN: "UNKNOWN" } as Record<string, MonitorStatus>)[status] ?? "UNKNOWN";
}
