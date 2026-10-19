import type { CheckStatus } from "@/lib/monitor/types";

/**
 * Pure helpers for certificate and domain expiry (TLS_CERT, DOMAIN_EXPIRY
 * and the free cert reading on HTTPS monitors), plus RDAP parsing
 * (RFC 9083 responses, IANA bootstrap RFC 9224).
 */

const DAY_MS = 86_400_000;

/** Whole days left (floor); negative once expired. */
export function daysUntil(date: Date, now: Date): number {
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

export function expiryStatus(daysLeft: number, warnDays: number, criticalDays: number): CheckStatus {
  if (daysLeft <= criticalDays) return "DOWN";
  if (daysLeft <= warnDays) return "DEGRADED";
  return "UP";
}

/**
 * Which threshold (warn or critical) did this check cross, compared with the
 * previous reading? Returns null when nothing new was crossed, so
 * `cert.expiring` / `domain.expiring` fire once per threshold.
 */
export function crossedThreshold(previousDays: number | null, currentDays: number, warnDays: number, criticalDays: number): number | null {
  const thresholds = [criticalDays, warnDays].sort((a, b) => a - b);
  for (const threshold of thresholds) {
    if (currentDays <= threshold && (previousDays === null || previousDays > threshold)) return threshold;
  }
  return null;
}

export type RdapBootstrap = Array<{ tlds: string[]; urls: string[] }>;

/** Parse https://data.iana.org/rdap/dns.json → [{ tlds, urls }]. */
export function parseRdapBootstrap(json: unknown): RdapBootstrap {
  if (!json || typeof json !== "object") return [];
  const services = (json as { services?: unknown }).services;
  if (!Array.isArray(services)) return [];
  const out: RdapBootstrap = [];
  for (const service of services) {
    if (!Array.isArray(service) || service.length < 2) continue;
    const [tlds, urls] = service as [unknown, unknown];
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
    const httpsUrls = urls.filter((url): url is string => typeof url === "string" && url.startsWith("https://"));
    const anyUrls = httpsUrls.length > 0 ? httpsUrls : urls.filter((url): url is string => typeof url === "string" && url.startsWith("http"));
    if (anyUrls.length === 0) continue;
    out.push({ tlds: tlds.filter((tld): tld is string => typeof tld === "string").map((tld) => tld.toLowerCase()), urls: anyUrls });
  }
  return out;
}

/** Longest matching TLD entry ("co.uk" before "uk"); returns the base URL with a trailing slash. */
export function rdapBaseFor(domain: string, bootstrap: RdapBootstrap): string | null {
  const labels = domain.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 1; i < labels.length; i += 1) {
    const suffix = labels.slice(i).join(".");
    const entry = bootstrap.find((service) => service.tlds.includes(suffix));
    if (entry) return entry.urls[0].endsWith("/") ? entry.urls[0] : `${entry.urls[0]}/`;
  }
  return null;
}

/** The `expiration` event date of an RDAP domain object. */
export function rdapExpiration(json: unknown): Date | null {
  if (!json || typeof json !== "object") return null;
  const events = (json as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    const { eventAction, eventDate } = event as { eventAction?: unknown; eventDate?: unknown };
    if (typeof eventAction === "string" && eventAction.toLowerCase() === "expiration" && typeof eventDate === "string") {
      const date = new Date(eventDate);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

/** Registrar name from the RDAP entity with role "registrar" (vCard fn), when present. */
export function rdapRegistrar(json: unknown): string | null {
  const entities = (json as { entities?: unknown } | null)?.entities;
  if (!Array.isArray(entities)) return null;
  for (const entity of entities) {
    if (!entity || typeof entity !== "object") continue;
    const roles = (entity as { roles?: unknown }).roles;
    if (!Array.isArray(roles) || !roles.includes("registrar")) continue;
    const vcard = (entity as { vcardArray?: unknown }).vcardArray;
    if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
      for (const field of vcard[1] as unknown[]) {
        if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string") return field[3].slice(0, 120);
      }
    }
  }
  return null;
}
