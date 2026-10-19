import type { MonitorSecret } from "@/lib/monitor/schemas";
import type { LookupFn, NetworkPolicy } from "@/lib/monitor/ssrf";
import type { CheckOutcome, CheckStatus } from "@/lib/monitor/types";

/** Everything a check evaluator needs besides its own config. */
export type CheckContext = {
  policy: NetworkPolicy;
  timeoutMs: number;
  degradedLatencyMs: number | null;
  secret: MonitorSecret | null;
  now: Date;
  /** Test hook: replaces system DNS for SSRF resolution. */
  lookup?: LookupFn;
  /** Synced cloud resource for CLOUD_RESOURCE monitors. */
  cloudResource?: { status: string; statusDetail: string | null; lastSeenAt: Date; goneAt: Date | null; connectionLastSyncAt: Date | null } | null;
  /** Previous reading (days left) for cert/domain threshold crossings. */
  previousDaysLeft?: number | null;
};

/** DEGRADED when an otherwise healthy check is slower than the threshold. */
export function latencyStatus(latencyMs: number | null, degradedLatencyMs: number | null): CheckStatus {
  if (degradedLatencyMs && latencyMs !== null && latencyMs > degradedLatencyMs) return "DEGRADED";
  return "UP";
}

export function down(error: string, message: string, extra: Partial<CheckOutcome> = {}): CheckOutcome {
  return { status: "DOWN", latencyMs: extra.latencyMs ?? null, error, message, ...extra };
}
