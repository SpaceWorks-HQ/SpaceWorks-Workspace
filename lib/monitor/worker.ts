import "server-only";

/**
 * Services monitor check scheduler (5-second tick, leased rows, SSRF-safe
 * checks). Production runs it in a separate worker process; development can
 * start it inside the web process with MONITOR_WORKER_INPROCESS=true
 * (instrumentation.ts). Placeholder until the monitor build replaces it.
 */
export function startMonitorWorker(): void {}
