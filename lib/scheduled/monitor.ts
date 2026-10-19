import "server-only";
import { runDueChecks } from "@/lib/monitor/scheduler";
import { sweepHeartbeats } from "@/lib/monitor/heartbeatService";
import { runRollupJobs, runRetention } from "@/lib/monitor/rollups";
import { sendIncidentReminders } from "@/lib/monitor/incidents";
import { maintenanceEvents, escalations } from "@/lib/monitor/periodic";
import { syncDueConnections, checkCostBudgets } from "@/lib/monitor/cloud/sync";
import { startMonitorWorker } from "@/lib/monitor/worker";
export async function run(now: Date): Promise<void> {
  if (process.env.MONITOR_WORKER_INPROCESS === "true") startMonitorWorker();
  await runRollupJobs(now);
  await Promise.all([sweepHeartbeats(now), runRetention(now), sendIncidentReminders(now), maintenanceEvents(now), escalations(now), checkCostBudgets(now)]);
  if (process.env.MONITOR_WORKER_INPROCESS !== "true") {
    await Promise.all([runDueChecks({ claimWindowMs: 0, maxRetryWaitMs: 0 }), syncDueConnections(now)]);
  }
}
