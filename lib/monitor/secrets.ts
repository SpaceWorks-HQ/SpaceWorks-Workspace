import "server-only";

import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { prisma, type DbClient } from "@/lib/db";
import { monitorSecretSchema, type MonitorSecret } from "@/lib/monitor/schemas";
import { normalizeAllowlistEntry, privateTargetsEnabled, type NetworkPolicy } from "@/lib/monitor/ssrf";

/**
 * Write-only secrets: monitor auth headers / connection strings (purpose
 * "monitor-secrets") and cloud credentials (purpose "cloud-credentials").
 * Decrypted values only ever reach the checker and provider adapters.
 */

export function sealMonitorSecret(secret: MonitorSecret | null): string | null {
  if (!secret) return null;
  const clean: MonitorSecret = {};
  if (secret.headers?.length) clean.headers = secret.headers;
  if (secret.connectionString) clean.connectionString = secret.connectionString;
  if (!clean.headers && !clean.connectionString) return null;
  return encryptSecret("monitor-secrets", JSON.stringify(clean));
}

export function openMonitorSecret(value: string | null): MonitorSecret | null {
  if (!value) return null;
  try {
    const parsed = monitorSecretSchema.safeParse(JSON.parse(decryptSecret("monitor-secrets", value)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** What the form may show about a stored secret: names and a hint, never values. */
export function describeMonitorSecret(value: string | null): { headerNames: string[]; hasConnectionString: boolean; connectionHost: string | null } {
  const secret = openMonitorSecret(value);
  let connectionHost: string | null = null;
  if (secret?.connectionString) {
    try {
      connectionHost = new URL(secret.connectionString).hostname;
    } catch {
      connectionHost = null;
    }
  }
  return { headerNames: secret?.headers?.map((header) => header.name) ?? [], hasConnectionString: Boolean(secret?.connectionString), connectionHost };
}

export function sealCloudCredentials(credentials: Record<string, string>): string {
  return encryptSecret("cloud-credentials", JSON.stringify(credentials));
}

export function openCloudCredentials(value: string): Record<string, string> {
  const parsed = JSON.parse(decryptSecret("cloud-credentials", value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid credentials payload.");
  return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, entry]) => typeof entry === "string")) as Record<string, string>;
}

/** Last four characters of the longest secret value ("•••• abcd"). */
export function credentialHint(credentials: Record<string, string>, secretKeys: string[]): string | null {
  const values = secretKeys.map((key) => credentials[key]).filter((value): value is string => Boolean(value));
  const longest = values.sort((a, b) => b.length - a.length)[0];
  return longest && longest.length >= 8 ? longest.slice(-4) : null;
}

/** The SSRF policy for one workspace (allow-list applies only when the instance allows private targets). */
export async function loadNetworkPolicy(workspaceId: string, client: DbClient = prisma): Promise<NetworkPolicy> {
  const allowPrivate = privateTargetsEnabled();
  if (!allowPrivate) return { allowPrivate: false, allowlist: [] };
  const rows = await client.monitorNetworkAllowlist.findMany({ where: { workspaceId }, select: { cidrOrHost: true } });
  return { allowPrivate, allowlist: rows.map((row) => normalizeAllowlistEntry(row.cidrOrHost)).filter((entry): entry is string => entry !== null) };
}
