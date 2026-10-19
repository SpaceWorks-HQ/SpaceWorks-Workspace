import { z } from "zod";

/**
 * Monitor configuration contracts (pure and client-safe: the monitor form
 * imports the labels and limits). Server code re-validates every input with
 * these schemas; secrets travel in `secret` and are never echoed back.
 */

export const MONITOR_TYPES = ["HTTP", "TCP", "PING", "DNS", "TLS_CERT", "DOMAIN_EXPIRY", "HEARTBEAT", "POSTGRES", "REDIS", "CLOUD_RESOURCE", "PROMQL"] as const;
export type MonitorTypeName = (typeof MONITOR_TYPES)[number];

export const MONITOR_TYPE_LABEL: Record<MonitorTypeName, string> = {
  HTTP: "Website or API (HTTP)",
  TCP: "TCP port",
  PING: "Ping",
  DNS: "DNS record",
  TLS_CERT: "TLS certificate",
  DOMAIN_EXPIRY: "Domain expiry",
  HEARTBEAT: "Heartbeat (cron job)",
  POSTGRES: "PostgreSQL",
  REDIS: "Redis",
  CLOUD_RESOURCE: "Cloud resource",
  PROMQL: "Prometheus query",
};

export const MONITOR_TYPE_SHORT: Record<MonitorTypeName, string> = {
  HTTP: "HTTP",
  TCP: "TCP",
  PING: "Ping",
  DNS: "DNS",
  TLS_CERT: "TLS",
  DOMAIN_EXPIRY: "Domain",
  HEARTBEAT: "Heartbeat",
  POSTGRES: "Postgres",
  REDIS: "Redis",
  CLOUD_RESOURCE: "Cloud",
  PROMQL: "PromQL",
};

/** Minimum check interval per type (seconds). */
export const MIN_INTERVAL_SEC: Record<MonitorTypeName, number> = {
  HTTP: 30,
  TCP: 30,
  PING: 30,
  DNS: 30,
  TLS_CERT: 3600,
  DOMAIN_EXPIRY: 43_200,
  HEARTBEAT: 60,
  POSTGRES: 30,
  REDIS: 30,
  CLOUD_RESOURCE: 60,
  PROMQL: 30,
};

export const DEFAULT_INTERVAL_SEC: Record<MonitorTypeName, number> = {
  HTTP: 60,
  TCP: 60,
  PING: 60,
  DNS: 300,
  TLS_CERT: 21_600,
  DOMAIN_EXPIRY: 86_400,
  HEARTBEAT: 300,
  POSTGRES: 60,
  REDIS: 60,
  CLOUD_RESOURCE: 300,
  PROMQL: 60,
};

export const MAX_INTERVAL_SEC = 86_400;
export const MAX_TIMEOUT_MS = 30_000;
export const MIN_TIMEOUT_MS = 1_000;
export const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
export const DNS_RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "CAA", "SOA"] as const;
export const DNS_MATCH_MODES = ["contains-all", "exact", "any"] as const;
export const PROMQL_OPS = ["<", "<=", ">", ">=", "==", "!="] as const;
export const SEVERITIES = ["MINOR", "MAJOR", "CRITICAL"] as const;

const trimmed = (max: number) => z.string().trim().max(max);
const hostname = z
  .string()
  .trim()
  .min(1, "Enter a host name or IP address.")
  .max(253)
  .regex(/^[A-Za-z0-9.:\-_[\]]+$/, "Enter a host name or IP address without a scheme or path.");
const headerName = z.string().trim().min(1).max(100).regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Header names use letters, digits and dashes.");
const header = z.object({ name: headerName, value: z.string().max(2000).regex(/^[^\r\n]*$/, "Header values are one line.") });

export const httpConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .max(2000)
    .url("Enter a full URL starting with https:// or http://.")
    .refine((value) => /^https?:\/\//i.test(value), "Only http:// and https:// URLs can be checked."),
  method: z.enum(HTTP_METHODS).default("GET"),
  headers: z.array(header).max(20).default([]),
  body: z.string().max(64 * 1024, "Keep the request body under 64 KB.").optional(),
  followRedirects: z.boolean().default(true),
  ignoreTls: z.boolean().default(false),
  expectedStatus: trimmed(100)
    .regex(/^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/, "Use codes and ranges like 200-299, 301.")
    .default("200-399"),
  assertions: z.array(trimmed(500).min(1)).max(20).default([]),
});

export const tcpConfigSchema = z.object({ host: hostname, port: z.coerce.number().int().min(1).max(65_535), tls: z.boolean().default(false) });
export const pingConfigSchema = z.object({ host: hostname });
export const dnsConfigSchema = z.object({
  hostname,
  recordType: z.enum(DNS_RECORD_TYPES).default("A"),
  resolver: z.union([z.literal(""), z.ipv4(), z.ipv6()]).optional(),
  expected: z.array(trimmed(500).min(1)).max(20).default([]),
  matchMode: z.enum(DNS_MATCH_MODES).default("contains-all"),
});
export const tlsConfigSchema = z.object({
  host: hostname,
  port: z.coerce.number().int().min(1).max(65_535).default(443),
  sni: trimmed(253).optional(),
  warnDays: z.coerce.number().int().min(1).max(365).default(21),
  criticalDays: z.coerce.number().int().min(0).max(365).default(7),
});
export const domainConfigSchema = z.object({
  domain: hostname,
  warnDays: z.coerce.number().int().min(1).max(365).default(30),
  criticalDays: z.coerce.number().int().min(0).max(365).default(7),
});
export const heartbeatConfigSchema = z.object({
  schedule: z.enum(["SIMPLE", "CRON"]).default("SIMPLE"),
  periodSec: z.coerce.number().int().min(60).max(31 * 86_400).default(300),
  graceSec: z.coerce.number().int().min(0).max(7 * 86_400).default(60),
  cronExpr: trimmed(120).optional(),
  timezone: trimmed(64).default("UTC"),
  /** A `/start` without a finish inside this many seconds marks the job DOWN (0 = off). */
  maxRunSec: z.coerce.number().int().min(0).max(7 * 86_400).default(0),
});
export const databaseConfigSchema = z.object({ hostHint: trimmed(253).optional() });
export const cloudResourceConfigSchema = z.object({});
export const promqlConfigSchema = z.object({
  baseUrl: z.string().trim().max(500).url().refine((value) => /^https?:\/\//i.test(value), "Use an http(s) URL."),
  query: trimmed(1000).min(1),
  op: z.enum(PROMQL_OPS).default("<"),
  threshold: z.coerce.number(),
});

export const CONFIG_SCHEMAS = {
  HTTP: httpConfigSchema,
  TCP: tcpConfigSchema,
  PING: pingConfigSchema,
  DNS: dnsConfigSchema,
  TLS_CERT: tlsConfigSchema,
  DOMAIN_EXPIRY: domainConfigSchema,
  HEARTBEAT: heartbeatConfigSchema,
  POSTGRES: databaseConfigSchema,
  REDIS: databaseConfigSchema,
  CLOUD_RESOURCE: cloudResourceConfigSchema,
  PROMQL: promqlConfigSchema,
} as const;

export type HttpConfig = z.infer<typeof httpConfigSchema>;
export type TcpConfig = z.infer<typeof tcpConfigSchema>;
export type PingConfig = z.infer<typeof pingConfigSchema>;
export type DnsConfig = z.infer<typeof dnsConfigSchema>;
export type TlsConfig = z.infer<typeof tlsConfigSchema>;
export type DomainConfig = z.infer<typeof domainConfigSchema>;
export type HeartbeatConfig = z.infer<typeof heartbeatConfigSchema>;
export type PromqlConfig = z.infer<typeof promqlConfigSchema>;

/** Write-only monitor secrets (encrypted with purpose "monitor-secrets"). */
export const monitorSecretSchema = z.object({
  headers: z.array(header).max(10).optional(),
  connectionString: z.string().trim().max(2000).optional(),
});
export type MonitorSecret = z.infer<typeof monitorSecretSchema>;

export const monitorInputSchema = z
  .object({
    name: trimmed(120).min(1, "Give the monitor a name."),
    type: z.enum(MONITOR_TYPES),
    tags: z.array(trimmed(40).min(1)).max(10).default([]),
    environment: z.enum(["", "production", "staging", "development"]).default(""),
    severity: z.enum(SEVERITIES).default("MAJOR"),
    projectId: z.string().max(64).nullish(),
    intervalSec: z.coerce.number().int().min(30).max(MAX_INTERVAL_SEC).optional(),
    timeoutMs: z.coerce.number().int().min(MIN_TIMEOUT_MS).max(MAX_TIMEOUT_MS).default(10_000),
    retries: z.coerce.number().int().min(0).max(5).default(1),
    retryIntervalSec: z.coerce.number().int().min(5).max(MAX_INTERVAL_SEC).default(20),
    failureThreshold: z.coerce.number().int().min(1).max(20).default(3),
    successThreshold: z.coerce.number().int().min(1).max(20).default(2),
    degradedLatencyMs: z.coerce.number().int().min(1).max(MAX_TIMEOUT_MS).nullish(),
    incidentOnDegraded: z.boolean().default(false),
    reminderIntervalMin: z.coerce.number().int().min(0).max(1440).default(60),
    useWorkspaceRules: z.boolean().default(true),
    destinationIds: z.array(z.string().max(64)).max(50).default([]),
    cloudResourceId: z.string().max(64).nullish(),
    config: z.record(z.string(), z.unknown()).default({}),
    /** Undefined keeps the stored secret; null clears it. */
    secret: monitorSecretSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    const interval = value.intervalSec ?? DEFAULT_INTERVAL_SEC[value.type];
    if (interval < MIN_INTERVAL_SEC[value.type]) {
      ctx.addIssue({ code: "custom", path: ["intervalSec"], message: `Check this type at most every ${describeSeconds(MIN_INTERVAL_SEC[value.type])}.` });
    }
    if (value.type !== "HEARTBEAT" && value.timeoutMs >= interval * 1000) {
      ctx.addIssue({ code: "custom", path: ["timeoutMs"], message: "The timeout must be shorter than the interval." });
    }
    if (value.reminderIntervalMin > 0 && value.reminderIntervalMin < 5) {
      ctx.addIssue({ code: "custom", path: ["reminderIntervalMin"], message: "Remind at most every 5 minutes, or turn reminders off with 0." });
    }
    if (value.type === "CLOUD_RESOURCE" && !value.cloudResourceId) {
      ctx.addIssue({ code: "custom", path: ["cloudResourceId"], message: "Choose a cloud resource." });
    }
  });
export type MonitorInput = z.infer<typeof monitorInputSchema>;

/** Parse the type-specific config; returns field errors under `config.<field>`. */
export function parseMonitorConfig(type: MonitorTypeName, config: unknown) {
  const result = CONFIG_SCHEMAS[type].safeParse(config ?? {});
  if (!result.success) return result;
  if (type === "HEARTBEAT") {
    const hb = result.data as HeartbeatConfig;
    if (hb.schedule === "CRON" && !hb.cronExpr) {
      return { success: false as const, error: new z.ZodError([{ code: "custom", path: ["cronExpr"], message: "Enter a cron schedule like 0 3 * * *.", input: hb.cronExpr }]) };
    }
  }
  if (type === "TLS_CERT" || type === "DOMAIN_EXPIRY") {
    const t = result.data as TlsConfig | DomainConfig;
    if (t.criticalDays >= t.warnDays) {
      return { success: false as const, error: new z.ZodError([{ code: "custom", path: ["criticalDays"], message: "Critical days must be fewer than warning days.", input: t.criticalDays }]) };
    }
  }
  return result;
}

export function describeSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "day" : `${seconds / 86_400} days`;
  if (seconds % 3600 === 0) return seconds === 3600 ? "hour" : `${seconds / 3600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}

/** The public "environment" tag is stored as a tag `env:<value>`. */
export function environmentOf(tags: string[]): string | null {
  const tag = tags.find((value) => value.startsWith("env:"));
  return tag ? tag.slice(4) : null;
}
