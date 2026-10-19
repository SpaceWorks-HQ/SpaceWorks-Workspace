export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    // Tests and one-off scripts can opt out of the in-process mail worker.
    if (process.env.OUTBOX_WORKER !== "0") {
      const { startOutboxWorker } = await import("@/lib/outboxWorker");
      startOutboxWorker();
    }
    // Development only: run the Services monitor check scheduler in-process.
    if (process.env.MONITOR_WORKER_INPROCESS === "true") {
      const { startMonitorWorker } = await import("@/lib/monitor/worker");
      startMonitorWorker();
    }
  }
}
