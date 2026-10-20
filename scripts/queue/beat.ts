import { syncSchedules } from "@/lib/queue/beat";
import { runProcess } from "./runtime";
void runProcess("beat", async () => {
  await syncSchedules();
  // Reconcile once per process/deploy. BullMQ produces repeats even while beat restarts.
  return { stop: async () => undefined, healthy: async () => true };
}).catch(() => { console.error("[queue] Beat startup failed. Check Redis and job schedules."); process.exit(1); });
