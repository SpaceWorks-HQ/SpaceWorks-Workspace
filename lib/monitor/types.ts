/** Result of one check run (stored as a MonitorCheck row). Pure and client-safe. */
export type CheckStatus = "UP" | "DEGRADED" | "DOWN" | "UNKNOWN";

export type AssertionResult = { expr: string; passed: boolean; actual?: string };

export interface CheckOutcome {
  status: CheckStatus;
  latencyMs: number | null;
  statusCode?: number;
  resolvedIp?: string;
  /** Machine code: TIMEOUT, DNS_FAIL, CONN_REFUSED, TLS_ERROR, TLS_INVALID, ASSERTION_FAILED, SSRF_BLOCKED… */
  error?: string;
  /** Human-readable, at most 500 characters. */
  message?: string;
  assertions?: AssertionResult[];
  meta?: Record<string, unknown>;
}

export const CHECK_ERROR_LABEL: Record<string, string> = {
  TIMEOUT: "Timed out",
  DNS_FAIL: "DNS lookup failed",
  CONN_REFUSED: "Connection refused",
  CONN_RESET: "Connection reset",
  NETWORK_ERROR: "Network error",
  TLS_ERROR: "TLS handshake failed",
  TLS_INVALID: "Certificate not trusted",
  CERT_EXPIRING: "Certificate expiring",
  DOMAIN_EXPIRING: "Domain expiring",
  ASSERTION_FAILED: "Assertion failed",
  STATUS_MISMATCH: "Unexpected status code",
  SSRF_BLOCKED: "Blocked private address",
  MISSED: "Heartbeat missed",
  FAILED: "Job reported failure",
  RUN_TOO_LONG: "Job ran too long",
  RDAP_UNAVAILABLE: "No RDAP data",
  QUERY_FAILED: "Query failed",
  THRESHOLD: "Threshold crossed",
  UNHEALTHY: "Resource unhealthy",
  STALE: "Cloud data out of date",
  CONFIG: "Configuration problem",
  ICMP_UNAVAILABLE: "Ping unavailable",
};

export function truncateMessage(value: string | undefined | null, max = 500): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
