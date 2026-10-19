import { execFile } from "node:child_process";
import { Resolver } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { down, latencyStatus, type CheckContext } from "@/lib/monitor/checks/context";
import { daysUntil, expiryStatus } from "@/lib/monitor/expiry";
import { classifyNetworkError } from "@/lib/monitor/net/http";
import type { DnsConfig, PingConfig, TcpConfig, TlsConfig } from "@/lib/monitor/schemas";
import { checkAddress, checkPort, normalizeHost, resolveTarget } from "@/lib/monitor/ssrf";
import type { CheckOutcome } from "@/lib/monitor/types";

/** TCP connect (optionally completing a TLS handshake) to a validated, pinned address. */
export function tcpConnect(
  address: { address: string; family: number },
  port: number,
  options: { timeoutMs: number; tls?: boolean; servername?: string; rejectUnauthorized?: boolean },
): Promise<{ ok: true; latencyMs: number; socket: tls.TLSSocket | net.Socket } | { ok: false; error: string; message: string; latencyMs: number }> {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const socket = options.tls
      ? tls.connect({ host: address.address, port, servername: options.servername && !net.isIP(options.servername) ? options.servername : undefined, rejectUnauthorized: options.rejectUnauthorized ?? true })
      : net.connect({ host: address.address, port, family: address.family });
    const finish = (result: Awaited<ReturnType<typeof tcpConnect>>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok) socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, error: "TIMEOUT", message: "No answer before the timeout.", latencyMs: Date.now() - started }), options.timeoutMs);
    socket.once(options.tls ? "secureConnect" : "connect", () => finish({ ok: true, latencyMs: Date.now() - started, socket }));
    socket.once("error", (error) => finish({ ok: false, ...classifyNetworkError(error), latencyMs: Date.now() - started }));
  });
}

export async function runTcpCheck(config: TcpConfig, ctx: CheckContext): Promise<CheckOutcome> {
  const portVerdict = checkPort(config.port);
  if (!portVerdict.ok) return down(portVerdict.error, portVerdict.message);
  const target = await resolveTarget(config.host, ctx.policy, ctx.lookup);
  if (!target.ok) return down(target.error, target.message);
  const address = target.addresses[0];
  const result = await tcpConnect(address, config.port, { timeoutMs: ctx.timeoutMs, tls: config.tls, servername: target.hostname });
  if (!result.ok) return down(result.error, result.message, { resolvedIp: address.address, latencyMs: result.error === "TIMEOUT" ? result.latencyMs : null });
  result.socket.destroy();
  const status = latencyStatus(result.latencyMs, ctx.degradedLatencyMs);
  return { status, latencyMs: result.latencyMs, resolvedIp: address.address, message: status === "DEGRADED" ? `Slow connect: ${result.latencyMs} ms.` : undefined };
}

/** Parse round-trip time from `ping` output ("time=12.3 ms"). */
export function parsePingRtt(output: string): number | null {
  const match = output.match(/time[=<]\s*([\d.]+)\s*ms/i);
  return match ? Math.max(0, Math.round(Number(match[1]))) : null;
}

export function pingArgs(address: string, timeoutMs: number, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  const seconds = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
  const v6 = net.isIPv6(address);
  if (platform === "darwin") return { file: v6 ? "ping6" : "ping", args: v6 ? ["-c", "1", address] : ["-c", "1", "-t", seconds, address] };
  return { file: "ping", args: [...(v6 ? ["-6"] : []), "-c", "1", "-W", seconds, address] };
}

/** Run `ping` once without a shell (the address is already validated). */
export function icmpPing(address: string, timeoutMs: number): Promise<{ ok: true; rttMs: number } | { ok: false; unavailable: boolean; message: string }> {
  const { file, args } = pingArgs(address, timeoutMs);
  return new Promise((resolve) => {
    execFile(/* turbopackIgnore: true */ file, args, { timeout: timeoutMs + 1000, windowsHide: true }, (error, stdout) => {
      const rtt = parsePingRtt(String(stdout ?? ""));
      if (!error && rtt !== null) return resolve({ ok: true, rttMs: rtt });
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const unavailable = code === "ENOENT" || code === "EACCES" || /operation not permitted|permission denied/i.test(String((error as Error | null)?.message ?? ""));
      resolve({ ok: false, unavailable, message: unavailable ? "ICMP is not available on this host." : "No reply to ping." });
    });
  });
}

/** ICMP ping with a TCP :443 → :80 fallback when ICMP is unavailable in the container. */
export async function runPingCheck(config: PingConfig, ctx: CheckContext & { icmpAvailable: boolean }): Promise<CheckOutcome> {
  const target = await resolveTarget(config.host, ctx.policy, ctx.lookup);
  if (!target.ok) return down(target.error, target.message);
  const address = target.addresses[0];
  if (ctx.icmpAvailable) {
    const result = await icmpPing(address.address, ctx.timeoutMs);
    if (result.ok) {
      const status = latencyStatus(result.rttMs, ctx.degradedLatencyMs);
      return { status, latencyMs: result.rttMs, resolvedIp: address.address };
    }
    if (!result.unavailable) return down("TIMEOUT", result.message, { resolvedIp: address.address });
  }
  const fallbackStarted = Date.now();
  let lastError: { error: string; message: string } = { error: "ICMP_UNAVAILABLE", message: "ICMP is not available on this host." };
  for (const port of [443, 80]) {
    const result = await tcpConnect(address, port, { timeoutMs: Math.max(1, ctx.timeoutMs - (Date.now() - fallbackStarted)) });
    if (result.ok) {
      result.socket.destroy();
      return { status: latencyStatus(result.latencyMs, ctx.degradedLatencyMs), latencyMs: result.latencyMs, resolvedIp: address.address, meta: { fallback: `tcp:${port}` } };
    }
    lastError = result;
  }
  return down(lastError.error, `${lastError.message} (ICMP unavailable, TCP fallback on 443 and 80 failed.)`, { resolvedIp: address.address, meta: { fallback: "tcp" } });
}

/** TLS certificate expiry and trust (chain + host name). */
export async function runTlsCheck(config: TlsConfig, ctx: CheckContext): Promise<CheckOutcome & { daysLeft?: number; validTo?: Date }> {
  const target = await resolveTarget(config.host, ctx.policy, ctx.lookup);
  if (!target.ok) return down(target.error, target.message);
  const address = target.addresses[0];
  const servername = normalizeHost(config.sni || config.host);
  const result = await tcpConnect(address, config.port, { timeoutMs: ctx.timeoutMs, tls: true, servername, rejectUnauthorized: false });
  if (!result.ok) return down(result.error === "TIMEOUT" ? "TIMEOUT" : "TLS_ERROR", result.message, { resolvedIp: address.address });
  const socket = result.socket as tls.TLSSocket;
  const peer = socket.getPeerCertificate();
  const hostnameError = tls.checkServerIdentity(servername, peer);
  const authorized = socket.authorized && !hostnameError;
  const authError = hostnameError ? (hostnameError as NodeJS.ErrnoException).code : socket.authorizationError ? String(socket.authorizationError) : null;
  socket.destroy();
  if (!peer || !peer.valid_to) return down("TLS_ERROR", "The server sent no certificate.", { resolvedIp: address.address });
  const validTo = new Date(peer.valid_to);
  if (Number.isNaN(validTo.getTime())) return down("TLS_ERROR", "The certificate expiry date is invalid.", { resolvedIp: address.address });
  const daysLeft = daysUntil(validTo, ctx.now);
  const meta = {
    certDaysLeft: daysLeft,
    certValidTo: validTo.toISOString(),
    issuer: typeof peer.issuer?.O === "string" ? peer.issuer.O : typeof peer.issuer?.CN === "string" ? peer.issuer.CN : null,
    subjectAltName: peer.subjectaltname?.slice(0, 300) ?? null,
  };
  if (!authorized) {
    return { status: "DOWN", latencyMs: result.latencyMs, resolvedIp: address.address, error: "TLS_INVALID", message: `The certificate is not trusted (${authError ?? "unknown reason"}).`, meta, daysLeft, validTo };
  }
  const status = expiryStatus(daysLeft, config.warnDays, config.criticalDays);
  return {
    status,
    latencyMs: result.latencyMs,
    resolvedIp: address.address,
    ...(status === "UP" ? {} : { error: "CERT_EXPIRING", message: daysLeft < 0 ? "The certificate has expired." : `The certificate expires in ${daysLeft} days.` }),
    meta,
    daysLeft,
    validTo,
  };
}

/** Normalise DNS answers to comparable strings. */
export function normalizeDnsAnswers(recordType: DnsConfig["recordType"], answers: unknown): string[] {
  const list = Array.isArray(answers) ? answers : answers ? [answers] : [];
  return list
    .map((answer) => {
      if (typeof answer === "string") return answer;
      if (Array.isArray(answer)) return answer.join("");
      if (answer && typeof answer === "object") {
        const record = answer as Record<string, unknown>;
        if (recordType === "MX") return `${record.priority} ${record.exchange}`;
        if (recordType === "CAA") return `${record.critical ?? 0} ${Object.keys(record).find((key) => key !== "critical") ?? ""} ${Object.entries(record).find(([key]) => key !== "critical")?.[1] ?? ""}`;
        if (recordType === "SOA") return `${record.nsname} ${record.hostmaster} ${record.serial}`;
      }
      return String(answer);
    })
    .map((value) => value.trim().toLowerCase().replace(/\.$/, ""));
}

export function dnsMatches(actual: string[], expected: string[], mode: DnsConfig["matchMode"]): boolean {
  if (expected.length === 0) return actual.length > 0;
  const want = expected.map((value) => value.trim().toLowerCase().replace(/\.$/, ""));
  if (mode === "exact") return want.length === actual.length && want.every((value) => actual.includes(value));
  if (mode === "any") return want.some((value) => actual.includes(value));
  return want.every((value) => actual.includes(value));
}

export async function runDnsCheck(config: DnsConfig, ctx: CheckContext): Promise<CheckOutcome> {
  const resolver = new Resolver({ timeout: ctx.timeoutMs, tries: 1 });
  if (config.resolver) {
    const verdict = checkAddress(config.resolver, ctx.policy);
    if (!verdict.ok) return down(verdict.error, `Resolver ${config.resolver}: ${verdict.message}`);
    resolver.setServers([config.resolver]);
  }
  const started = Date.now();
  let answers: unknown;
  try {
    answers = await resolver.resolve(normalizeHost(config.hostname), config.recordType as "A");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    const latencyMs = Date.now() - started;
    if (code === "ETIMEOUT") return down("TIMEOUT", "The resolver did not answer in time.", { latencyMs });
    return down("DNS_FAIL", code === "ENOTFOUND" ? "The name does not exist (NXDOMAIN)." : code === "ENODATA" ? `No ${config.recordType} records.` : `Lookup failed (${code || "error"}).`, { latencyMs });
  }
  const latencyMs = Date.now() - started;
  const normalized = normalizeDnsAnswers(config.recordType, answers);
  const meta = { dnsAnswers: normalized.slice(0, 20) };
  if (!dnsMatches(normalized, config.expected, config.matchMode)) {
    return { status: "DOWN", latencyMs, error: "ASSERTION_FAILED", message: `Expected ${config.expected.join(", ")}; got ${normalized.join(", ") || "nothing"}.`.slice(0, 500), meta };
  }
  return { status: latencyStatus(latencyMs, ctx.degradedLatencyMs), latencyMs, meta };
}
