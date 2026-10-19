import "server-only";

import { deliverOutboxBatch } from "@/lib/outbox";
import { recordHeartbeatFailure, recordHeartbeatStarted, recordHeartbeatSuccess } from "@/lib/operationalHeartbeat";
import { purgeExpiredOperationalData } from "@/lib/retention";

export const OUTBOX_HEARTBEAT_KEY = "outbox-scheduler";
const OUTBOX_WORKER_INTERVAL_MS = 60_000;
const WORKER_KEY = Symbol.for("sww.outboxWorker");

type WorkerState = { started: boolean; running: boolean; timer?: ReturnType<typeof setInterval> };

/** One delivery + retention pass, with its heartbeat. */
export async function runOutboxScheduler() {
  await recordHeartbeatStarted(OUTBOX_HEARTBEAT_KEY).catch(() => undefined);
  try {
    const result = await deliverOutboxBatch();
    const purged = await purgeExpiredOperationalData();
    await recordHeartbeatSuccess(OUTBOX_HEARTBEAT_KEY, result).catch(() => undefined);
    return { ...result, purged };
  } catch (error) {
    await recordHeartbeatFailure(OUTBOX_HEARTBEAT_KEY, error).catch(() => undefined);
    throw error;
  }
}

/**
 * Start one polling worker per Node.js process. Row claims make this safe
 * across replicas; the globalThis guard avoids duplicate timers during HMR.
 */
export function startOutboxWorker() {
  const g = globalThis as typeof globalThis & { [WORKER_KEY]?: WorkerState };
  if (g[WORKER_KEY]?.started) return;
  const state: WorkerState = { started: true, running: false };
  g[WORKER_KEY] = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await runOutboxScheduler();
    } catch {
      console.error("[outbox worker] scheduler run failed");
    } finally {
      state.running = false;
    }
  };

  void tick();
  state.timer = setInterval(() => void tick(), OUTBOX_WORKER_INTERVAL_MS);
  state.timer.unref?.();
}
