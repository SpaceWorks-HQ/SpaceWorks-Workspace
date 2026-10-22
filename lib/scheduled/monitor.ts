import "server-only";
import { sweepHeartbeats } from "@/lib/monitor/heartbeatService";
import { runRollupJobs, runRetention } from "@/lib/monitor/rollups";
import { sendIncidentReminders } from "@/lib/monitor/incidents";
import { maintenanceEvents, escalations } from "@/lib/monitor/periodic";
import { syncDueConnections, checkCostBudgets } from "@/lib/monitor/cloud/sync";
export async function run(now: Date): Promise<void> {
  await runRollupJobs(now);
  await Promise.all([sweepHeartbeats(now), runRetention(now), sendIncidentReminders(now), maintenanceEvents(now), escalations(now), checkCostBudgets(now)]);
  await syncDueConnections(now);
}
