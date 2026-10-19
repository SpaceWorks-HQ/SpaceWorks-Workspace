import { promises as dnsPromises, type LookupAddress } from "node:dns";
import net from "node:net";

/**
 * SSRF guard for every outbound monitor connection (HTTP, TCP, ping, TLS,
 * DNS resolvers, Postgres, Redis, RDAP, Prometheus).
 *
 * 1. Resolve the host once and validate every A/AAAA answer against the
 *    blocked ranges below (private, loopback, link-local incl. cloud
 *    metadata, CGNAT, multicast, reserved, IPv4-mapped and NAT64 IPv6).
 * 2. Connect to the validated address only (`pinnedLookup`), so a DNS answer
 *    that changes between check and connect (rebinding) cannot reach a
 *    private address.
 * 3. Private targets are allowed only when the instance sets
 *    MONITOR_ALLOW_PRIVATE_TARGETS=true AND a workspace admin allow-listed
 *    the CIDR or host name. Metadata addresses are never allowed.
 */

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const BLOCKED_V6: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["2001::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
];

/** Cloud metadata endpoints: never reachable, not even through the allow-list. */
const NEVER_ALLOWED = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"]);
const NEVER_ALLOWED_HOSTS = new Set(["metadata.google.internal", "metadata", "metadata.goog", "instance-data", "instance-data.ec2.internal"]);

const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of BLOCKED_V4) blockedV4.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of BLOCKED_V6) blockedV6.addSubnet(address, prefix, "ipv6");

export type NetworkPolicy = {
  /** Instance switch MONITOR_ALLOW_PRIVATE_TARGETS. */
  allowPrivate: boolean;
  /** Workspace allow-list entries (CIDR, single IP, host name or `*.suffix`). */
  allowlist: string[];
};

export const STRICT_POLICY: NetworkPolicy = { allowPrivate: false, allowlist: [] };

export function privateTargetsEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MONITOR_ALLOW_PRIVATE_TARGETS === "true";
}

export type Verdict = { ok: true } | { ok: false; error: "SSRF_BLOCKED"; message: string };

const blocked = (message: string): Verdict => ({ ok: false, error: "SSRF_BLOCKED", message });

/** Strip URL brackets and a zone id from an IPv6 literal. */
export function normalizeHost(host: string): string {
  let value = host.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone > 0 && net.isIPv6(value.slice(0, zone))) value = value.slice(0, zone);
  if (net.isIPv6(value)) {
    try { value = new URL(`http://[${value}]/`).hostname.slice(1, -1); } catch { /* Invalid literals fail validation below. */ }
  }
  return value.replace(/\.$/, "");
}

/** `::ffff:10.0.0.1` (or its hex form) → `10.0.0.1`; anything else unchanged. */
export function unmapIpv4(address: string): string {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted && net.isIPv4(dotted[1])) return dotted[1];
  const hex = lower.match(/^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return address;
}

/** Is this literal IP inside a blocked range? (Ignores the allow-list.) */
export function isBlockedAddress(address: string): boolean {
  const value = unmapIpv4(normalizeHost(address));
  const family = net.isIP(value);
  if (family === 0) return true;
  return family === 4 ? blockedV4.check(value, "ipv4") : !globalV6.check(value, "ipv6") || blockedV6.check(value, "ipv6");
}

export function isNeverAllowed(address: string): boolean {
  return NEVER_ALLOWED.has(unmapIpv4(normalizeHost(address)));
}

/** Parse one allow-list entry; returns a normalized value or null when invalid. */
export function normalizeAllowlistEntry(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value || value.length > 253) return null;
  const [address, prefixRaw, ...rest] = value.split("/");
  if (rest.length > 0) return null;
  const family = net.isIP(address);
  if (family !== 0) {
    if (NEVER_ALLOWED.has(address)) return null;
    if (prefixRaw === undefined) return address;
    const prefix = Number(prefixRaw);
    const max = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < (family === 4 ? 8 : 16) || prefix > max) return null;
    return `${address}/${prefix}`;
  }
  if (prefixRaw !== undefined) return null;
  if (!/^(\*\.)?[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)*$/.test(value)) return null;
  if (NEVER_ALLOWED_HOSTS.has(value.replace(/^\*\./, ""))) return null;
  return value;
}

function matchesHostEntry(hostname: string, entry: string) {
  if (entry.startsWith("*.")) return hostname.endsWith(entry.slice(1)) && hostname.length > entry.length - 1;
  return hostname === entry;
}

function allowlistedAddress(address: string, policy: NetworkPolicy): boolean {
  const value = unmapIpv4(address);
  const family = net.isIP(value);
  if (family === 0) return false;
  for (const entry of policy.allowlist) {
    const [base, prefix] = entry.split("/");
    const entryFamily = net.isIP(base);
    if (entryFamily !== family) continue;
    if (prefix === undefined) {
      if (base === value) return true;
      continue;
    }
    const list = new net.BlockList();
    list.addSubnet(base, Number(prefix), family === 4 ? "ipv4" : "ipv6");
    if (list.check(value, family === 4 ? "ipv4" : "ipv6")) return true;
  }
  return false;
}

function allowlistedHost(hostname: string | null, policy: NetworkPolicy): boolean {
  if (!hostname || net.isIP(hostname)) return false;
  return policy.allowlist.some((entry) => net.isIP(entry.split("/")[0]) === 0 && matchesHostEntry(hostname, entry));
}

/**
 * May the checker connect to `address`? `hostname` is the name the user
 * entered (host-name allow-list entries apply to its answers).
 */
export function checkAddress(address: string, policy: NetworkPolicy, hostname: string | null = null): Verdict {
  const value = unmapIpv4(normalizeHost(address));
  if (net.isIP(value) === 0) return blocked("That is not a valid IP address.");
  if (NEVER_ALLOWED.has(value)) return blocked("Cloud metadata addresses can never be monitored.");
  if (!isBlockedAddress(value)) return { ok: true };
  if (policy.allowPrivate && (allowlistedAddress(value, policy) || allowlistedHost(hostname ? normalizeHost(hostname) : null, policy))) return { ok: true };
  return blocked(
    policy.allowPrivate
      ? `${value} is a private or reserved address. An admin can allow it under Services settings.`
      : `${value} is a private or reserved address, which monitors cannot reach on this instance.`,
  );
}

/** Host-name rules that apply before resolving (localhost, metadata, single-label service names). */
export function checkHostname(host: string, policy: NetworkPolicy): Verdict {
  const hostname = normalizeHost(host);
  if (!hostname) return blocked("Enter a host name.");
  if (net.isIP(hostname)) return checkAddress(hostname, policy, null);
  if (NEVER_ALLOWED_HOSTS.has(hostname)) return blocked("Cloud metadata addresses can never be monitored.");
  const internal = hostname === "localhost" || hostname.endsWith(".localhost") || !hostname.includes(".");
  if (internal && !(policy.allowPrivate && allowlistedHost(hostname, policy))) {
    return blocked(`${hostname} is an internal host name. Use a public name, or ask an admin to allow it.`);
  }
  return { ok: true };
}

export function checkPort(port: number): Verdict {
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? { ok: true } : blocked("Choose a port between 1 and 65535.");
}

export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

const systemLookup: LookupFn = (hostname) => dnsPromises.lookup(hostname, { all: true, verbatim: true });

export type ResolvedTarget =
  | { ok: true; hostname: string; addresses: LookupAddress[] }
  | { ok: false; error: "SSRF_BLOCKED" | "DNS_FAIL"; message: string };

/**
 * Resolve `host` and validate every answer. Blocks when ANY answer is
 * blocked, so a mixed public/private record cannot be used to sneak in.
 */
export async function resolveTarget(host: string, policy: NetworkPolicy, lookup: LookupFn = systemLookup): Promise<ResolvedTarget> {
  const hostname = normalizeHost(host);
  const nameVerdict = checkHostname(hostname, policy);
  if (!nameVerdict.ok) return nameVerdict;
  const literal = net.isIP(hostname);
  if (literal) return { ok: true, hostname, addresses: [{ address: unmapIpv4(hostname), family: net.isIP(unmapIpv4(hostname)) }] };
  let answers: LookupAddress[];
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      answers = await Promise.race([lookup(hostname), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS timeout")), 5000); })]);
    } finally { clearTimeout(timer); }
  } catch {
    return { ok: false, error: "DNS_FAIL", message: `Couldn't resolve ${hostname}.` };
  }
  if (answers.length === 0) return { ok: false, error: "DNS_FAIL", message: `${hostname} has no address records.` };
  for (const answer of answers) {
    const verdict = checkAddress(answer.address, policy, hostname);
    if (!verdict.ok) return { ok: false, error: "SSRF_BLOCKED", message: `${hostname} resolves to a blocked address. ${verdict.message}` };
  }
  return { ok: true, hostname, addresses: answers.map((answer) => ({ address: unmapIpv4(answer.address), family: net.isIP(unmapIpv4(answer.address)) })) };
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * A `lookup` for node:http/https/net/tls that always answers with the
 * already-validated address (DNS pinning).
 */
export function pinnedLookup(address: LookupAddress) {
  return (_hostname: string, options: { all?: boolean } | number | undefined, callback?: LookupCallback) => {
    const cb = (typeof options === "function" ? options : callback) as LookupCallback;
    const all = typeof options === "object" && options !== null && options.all;
    if (all) cb(null, [address]);
    else cb(null, address.address, address.family);
  };
}
