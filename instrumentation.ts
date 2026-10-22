export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
    if (process.env.NODE_ENV !== "production" && !process.env.REDIS_URL && process.env.JOBS_INPROCESS === "true") {
      const { startOutboxWorker } = await import("@/lib/outboxWorker");
      startOutboxWorker();
    }
  }
}
