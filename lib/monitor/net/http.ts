import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { TLSSocket } from "node:tls";
import { checkPort, pinnedLookup, resolveTarget, type LookupFn, type NetworkPolicy } from "@/lib/monitor/ssrf";

/**
 * SSRF-safe HTTP(S) client for monitors, RDAP and Prometheus queries.
 * Every hop (including each redirect) is resolved, validated and pinned to
 * the validated IP; bodies are capped; Set-Cookie is never kept.
 */

export const MAX_BODY_BYTES = 1024 * 1024;
const USER_AGENT = "SpaceWorks-Monitor/1.0 (+uptime check)";
const CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
]);

export type GuardedRequestOptions = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  ignoreTls?: boolean;
  maxBodyBytes?: number;
  policy: NetworkPolicy;
  /** Test hook: replaces system DNS. */
  lookup?: LookupFn;
};

export type GuardedResponse = {
  ok: true;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  bodyTruncated: boolean;
  latencyMs: number;
  ttfbMs: number;
  resolvedIp: string;
  finalUrl: string;
  redirects: number;
  cert: { validTo: Date | null; authorized: boolean; error: string | null } | null;
};

export type GuardedFailure = { ok: false; error: string; message: string; latencyMs: number; resolvedIp?: string };

export function classifyNetworkError(error: unknown): { error: string; message: string } {
  const err = error as NodeJS.ErrnoException & { code?: string };
  const code = err?.code ?? "";
  if (err?.message === "TIMEOUT" || code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return { error: "TIMEOUT", message: "No response before the timeout." };
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { error: "DNS_FAIL", message: "The host name did not resolve." };
  if (code === "ECONNREFUSED") return { error: "CONN_REFUSED", message: "The server refused the connection." };
  if (code === "ECONNRESET" || code === "EPIPE") return { error: "CONN_RESET", message: "The connection was reset." };
  if (CERT_ERRORS.has(code)) return { error: "TLS_INVALID", message: `The certificate was rejected (${code}).` };
  if (code.startsWith("ERR_SSL") || code === "EPROTO" || code.startsWith("ERR_TLS")) return { error: "TLS_ERROR", message: "The TLS handshake failed." };
  if (code === "EHOSTUNREACH" || code === "ENETUNREACH") return { error: "NETWORK_ERROR", message: "The host is unreachable." };
  return { error: "NETWORK_ERROR", message: "The connection failed." };
}

function cleanHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name === "set-cookie") continue;
    out[name] = value;
  }
  return out;
}

type HopResult =
  | { kind: "response"; response: GuardedResponse }
  | { kind: "redirect"; location: string; status: number }
  | { kind: "failure"; failure: GuardedFailure };

function oneHop(url: URL, options: GuardedRequestOptions, address: { address: string; family: number }, deadline: number, started: number, redirectsSoFar: number): Promise<HopResult> {
  return new Promise((resolve) => {
    const isHttps = url.protocol === "https:";
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const remaining = Math.max(1, deadline - Date.now());
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*", ...(options.headers ?? {}) };
    if (options.body !== undefined) headers["content-length"] = String(Buffer.byteLength(options.body));
    let settled = false;
    let ttfb = 0;
    const finish = (result: HopResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const request = (isHttps ? https : http).request({
      protocol: url.protocol,
      hostname,
      port: url.port ? Number(url.port) : isHttps ? 443 : 80,
      path: `${url.pathname}${url.search}`,
      method: options.method ?? "GET",
      headers,
      lookup: pinnedLookup(address) as unknown as typeof import("node:dns").lookup,
      agent: false,
      ...(isHttps ? { servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: !options.ignoreTls } : {}),
    });
    const timer = setTimeout(() => request.destroy(new Error("TIMEOUT")), remaining);
    request.on("error", (error) => {
      const classified = classifyNetworkError(error);
      finish({ kind: "failure", failure: { ok: false, ...classified, latencyMs: Date.now() - started, resolvedIp: address.address } });
    });
    request.on("response", (response) => {
      ttfb = Date.now() - started;
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (options.followRedirects !== false && status >= 300 && status < 400 && location && redirectsSoFar >= (options.maxRedirects ?? 5)) {
        response.resume();
        finish({ kind: "failure", failure: { ok: false, error: "NETWORK_ERROR", message: "Too many redirects.", latencyMs: Date.now() - started } });
        request.destroy();
        return;
      }
      if (options.followRedirects !== false && status >= 300 && status < 400 && location) {
        response.resume();
        finish({ kind: "redirect", location, status });
        request.destroy();
        return;
      }
      let cert: GuardedResponse["cert"] = null;
      if (isHttps) {
        const socket = response.socket as TLSSocket;
        const peer = typeof socket.getPeerCertificate === "function" ? socket.getPeerCertificate() : null;
        const validTo = peer && peer.valid_to ? new Date(peer.valid_to) : null;
        cert = { validTo: validTo && !Number.isNaN(validTo.getTime()) ? validTo : null, authorized: Boolean(socket.authorized), error: socket.authorizationError ? String(socket.authorizationError) : null };
      }
      const max = options.maxBodyBytes ?? MAX_BODY_BYTES;
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      const done = () =>
        finish({
          kind: "response",
          response: {
            ok: true,
            status,
            headers: cleanHeaders(response.headers),
            body: Buffer.concat(chunks).toString("utf8"),
            bodyTruncated: truncated,
            latencyMs: Date.now() - started,
            ttfbMs: ttfb,
            resolvedIp: address.address,
            finalUrl: url.toString(),
            redirects: redirectsSoFar,
            cert,
          },
        });
      response.on("data", (chunk: Buffer) => {
        if (truncated) return;
        if (size + chunk.length > max) {
          chunks.push(chunk.subarray(0, max - size));
          size = max;
          truncated = true;
          done();
          response.destroy();
          return;
        }
        chunks.push(chunk);
        size += chunk.length;
      });
      response.on("end", done);
      response.on("error", (error) => {
        if (truncated) return;
        const classified = classifyNetworkError(error);
        finish({ kind: "failure", failure: { ok: false, ...classified, latencyMs: Date.now() - started, resolvedIp: address.address } });
      });
    });
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

export async function guardedRequest(options: GuardedRequestOptions): Promise<GuardedResponse | GuardedFailure> {
  const started = Date.now();
  const deadline = started + options.timeoutMs;
  let current: URL;
  try {
    current = new URL(options.url);
  } catch {
    return { ok: false, error: "CONFIG", message: "The URL is not valid.", latencyMs: 0 };
  }
  let method = (options.method ?? "GET").toUpperCase();
  let body = options.body;
  let headers = options.headers;
  for (let redirects = 0; ; redirects += 1) {
    if (current.protocol !== "http:" && current.protocol !== "https:") return { ok: false, error: "SSRF_BLOCKED", message: "Only http and https URLs can be checked.", latencyMs: Date.now() - started };
    if (current.username || current.password) return { ok: false, error: "CONFIG", message: "Put credentials in a secret header, not in the URL.", latencyMs: Date.now() - started };
    const port = current.port ? Number(current.port) : current.protocol === "https:" ? 443 : 80;
    const portVerdict = checkPort(port);
    if (!portVerdict.ok) return { ok: false, error: portVerdict.error, message: portVerdict.message, latencyMs: Date.now() - started };
    const target = await resolveTarget(current.hostname, options.policy, options.lookup);
    if (!target.ok) return { ok: false, error: target.error, message: target.message, latencyMs: Date.now() - started };
    if (Date.now() >= deadline) return { ok: false, error: "TIMEOUT", message: "No response before the timeout.", latencyMs: Date.now() - started };
    const hop = await oneHop(current, { ...options, method, body, headers }, target.addresses[0], deadline, started, redirects);
    if (hop.kind === "failure") return hop.failure;
    if (hop.kind === "response") return hop.response;
    let next: URL;
    try {
      next = new URL(hop.location, current);
    } catch {
      return { ok: false, error: "NETWORK_ERROR", message: "The redirect location is not a valid URL.", latencyMs: Date.now() - started };
    }
    if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method === "POST")) {
      method = "GET";
      body = undefined;
    }
    if (next.origin !== current.origin) {
      if (body) return { ok: false, error: "SSRF_BLOCKED", message: "Cross-origin redirects with a request body are blocked.", latencyMs: Date.now() - started };
      headers = Object.fromEntries(Object.entries(headers ?? {}).filter(([key]) => ["accept", "user-agent"].includes(key.toLowerCase())));
    }
    current = next;
  }
}
