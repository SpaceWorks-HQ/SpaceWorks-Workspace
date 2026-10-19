import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF guard for user-supplied URLs (webhook destinations, Mattermost
 * servers, SEO audits). A URL passes when it is http(s), carries no
 * credentials, uses a normal port, and every address its host resolves to is
 * public. Private, loopback, link-local, CGNAT, multicast, documentation and
 * unique-local ranges are refused unless ALLOW_PRIVATE_WEBHOOK_TARGETS=true
 * (self-hosters posting to a LAN service).
 *
 * The guarded fetch transport also validates DNS when the socket connects.
 * Callers never follow redirects automatically; see docs/INTEGRATIONS.md.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };
export type Resolver = (host: string) => Promise<string[]>;

const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

export function privateTargetsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS === "true";
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Block(ip: string, [base, bits]: [string, number]) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** Expand an IPv6 address to eight 16-bit groups (handles "::" and an embedded IPv4 tail). */
function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase().split("%")[0]!;
  const v4Tail = address.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Tail) {
    const n = ipv4ToInt(v4Tail[1]!);
    address = address.slice(0, -v4Tail[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = address.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").filter(Boolean).map((group) => parseInt(group, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  if (address.includes("::")) {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    return [...left, ...new Array<number>(missing).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

/** True for any address that must not be reached from the server by default. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip.split("%")[0]!);
  if (family === 4) return V4_BLOCKS.some((block) => inV4Block(ip, block));
  if (family !== 6) return true;
  const groups = ipv6Groups(ip);
  if (!groups) return true;
  const [g0, g1, , , , g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge the embedded address.
  if (groups.slice(0, 5).every((group) => group === 0) && (g5 === 0xffff || g5 === 0)) {
    const v4 = `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
    return isPrivateAddress(v4);
  }
  if (g0 === 0x64 && g1 === 0xff9b) return true; // NAT64 well-known prefix
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (deprecated)
  if ((g0 & 0xff00) === 0xff00) return true; // multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation
  if (g0 === 0x2002) return true; // 6to4 can embed private IPv4
  return false;
}

const BLOCKED_HOSTNAMES = /^(localhost|localhost\.localdomain|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;

/** Parse and validate the shape of a URL (no DNS). */
export function parseTargetUrl(raw: string, options: { allowHttp?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "Enter a full URL starting with https://." };
  }
  const allowHttp = options.allowHttp ?? (privateTargetsAllowed() || process.env.NODE_ENV !== "production");
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return { ok: false, error: "Use an https:// URL." };
  if (url.username || url.password) return { ok: false, error: "Put credentials in the secret field, not in the URL." };
  if (url.port && !["80", "443", "8080", "8443", "8065"].includes(url.port) && !privateTargetsAllowed()) {
    return { ok: false, error: "Use a standard web port (443, 80, 8443, 8080 or 8065)." };
  }
  if (raw.length > 2048) return { ok: false, error: "That URL is too long." };
  return { ok: true, url };
}

/**
 * Full check: shape, hostname and every resolved address. Pass `resolver`
 * in tests. With ALLOW_PRIVATE_WEBHOOK_TARGETS=true only the shape is checked.
 */
export async function checkPublicUrl(raw: string, options: { resolver?: Resolver; allowPrivate?: boolean; allowHttp?: boolean } = {}): Promise<UrlCheck> {
  const parsed = parseTargetUrl(raw, options);
  if (!parsed.ok) return parsed;
  const allowPrivate = options.allowPrivate ?? privateTargetsAllowed();
  if (allowPrivate) return parsed;
  const host = parsed.url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.test(host)) return { ok: false, error: "That address points at a private network." };
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await (options.resolver ?? defaultResolver)(host);
    } catch {
      return { ok: false, error: "That host name does not resolve." };
    }
  }
  if (addresses.length === 0) return { ok: false, error: "That host name does not resolve." };
  if (addresses.some(isPrivateAddress)) return { ok: false, error: "That address points at a private network." };
  return parsed;
}
