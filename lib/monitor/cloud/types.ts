/**
 * Cloud provider adapter contract (read-only accounts). Every adapter maps
 * provider payloads to normalized resources, metrics, costs and alarms.
 * Adapters never write to the database and never log credentials; the
 * sync service (lib/monitor/cloud/sync.ts) persists what they return.
 */

export type CloudProviderKind = "DIGITALOCEAN" | "AWS" | "RENDER" | "CLOUDFLARE" | "HETZNER" | "VERCEL" | "NETLIFY" | "FLY" | "RAILWAY" | "GITHUB_ACTIONS" | "PROMETHEUS";
export type ResourceHealth = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "STOPPED" | "UNKNOWN";

/** Decrypted credentials JSON (shape per provider, see each adapter's `credentialFields`). */
export type CloudCredentials = Record<string, string>;
/** Non-secret connection settings: { regions?: string[], accountId?, teamId?, zoneIds?, org?, repos?, ... }. */
export type CloudConfig = Record<string, unknown>;

export type ResourceSnapshot = {
  externalId: string;
  /** droplet | app | database | load_balancer | ec2 | rds | lightsail | ecs_service | r53_healthcheck | zone | worker | r2_bucket | server | service | site | project | machine | workflow … */
  kind: string;
  name: string;
  region?: string | null;
  status: ResourceHealth;
  /** Provider's own status words, e.g. "active", "running / impaired". */
  statusDetail?: string | null;
  /** Public URL when the resource serves one (used to suggest HTTP monitors). */
  url?: string | null;
  /** Trimmed provider payload (no secrets, ≤ 4 KB). */
  raw?: Record<string, unknown>;
};

export type MetricPoint = { externalId: string; metric: string; ts: Date; value: number };

export type CostInput = {
  granularity: "DAY" | "MONTH" | "MTD" | "FORECAST" | "BALANCE";
  periodStart: Date;
  periodEnd: Date;
  amount: number;
  currency: string;
  breakdown?: Array<{ service: string; amount: number }>;
  isEstimate?: boolean;
};

export type CloudAlarm = { name: string; state: string; resourceExternalId?: string | null; reason?: string | null };

export type CredentialField = {
  key: string;
  label: string;
  /** Secret fields are encrypted and write-only; non-secret ones go to `config`. */
  secret: boolean;
  optional?: boolean;
  placeholder?: string;
  help?: string;
  /** "list" fields are comma-separated in the form and stored as string[] in config. */
  kind?: "text" | "list";
};

/** Minimal HTTP surface adapters use (rate-limited, retries 429/5xx; see lib/monitor/cloud/http.ts). */
export type ProviderHttp = {
  json<T = unknown>(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: T; headers: Headers }>;
};

export type AdapterContext = {
  credentials: CloudCredentials;
  config: CloudConfig;
  http: ProviderHttp;
  now: Date;
  signal?: AbortSignal;
};

export type VerifyResult = { ok: true; accountLabel: string | null } | { ok: false; error: string };

export interface CloudProviderAdapter {
  provider: CloudProviderKind;
  label: string;
  priority: "P0" | "P1";
  credentialFields: CredentialField[];
  /** Step-by-step setup with the least-privilege scopes, shown in the connect form and docs. */
  setupSteps: string[];
  /** IAM / scope policy to copy (AWS JSON policy, Cloudflare token permissions…). */
  policy?: string;
  docsUrl: string;
  /** Minimum spacing between requests for one connection (ms), derived from the provider's published limits. */
  minRequestSpacingMs: number;
  verify(ctx: AdapterContext): Promise<VerifyResult>;
  listResources(ctx: AdapterContext): Promise<ResourceSnapshot[]>;
  /** Last ~15 minutes of key metrics for the given resources. */
  getMetrics?(ctx: AdapterContext, resources: ResourceSnapshot[]): Promise<MetricPoint[]>;
  /** Called at most daily (AWS Cost Explorer costs US$0.01 per request). */
  getCosts?(ctx: AdapterContext): Promise<CostInput[]>;
  listAlarms?(ctx: AdapterContext): Promise<CloudAlarm[]>;
}

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "rate_limited" | "http" | "network" | "config",
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "CloudApiError";
  }
}

/** Keep raw payloads small and free of anything that looks like a secret. */
export function trimRaw(value: Record<string, unknown>, maxBytes = 4096): Record<string, unknown> {
  const SECRET_KEY = /(secret|token|password|passwd|private|credential|key_?id|access_?key|auth)/i;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    if (entry === null || ["string", "number", "boolean"].includes(typeof entry)) out[key] = typeof entry === "string" ? entry.slice(0, 300) : entry;
  }
  let json = JSON.stringify(out);
  while (json.length > maxBytes) {
    const keys = Object.keys(out);
    if (keys.length === 0) break;
    delete out[keys[keys.length - 1]];
    json = JSON.stringify(out);
  }
  return out;
}
