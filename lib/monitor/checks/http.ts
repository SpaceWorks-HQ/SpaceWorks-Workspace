import { evaluateAssertions, parseExpectedStatus } from "@/lib/monitor/assertions";
import { down, latencyStatus, type CheckContext } from "@/lib/monitor/checks/context";
import { daysUntil } from "@/lib/monitor/expiry";
import { guardedRequest } from "@/lib/monitor/net/http";
import type { HttpConfig } from "@/lib/monitor/schemas";
import { truncateMessage, type CheckOutcome } from "@/lib/monitor/types";

/** HTTP(S) check: status, assertions, latency thresholds, TLS reading. */
export async function runHttpCheck(config: HttpConfig, ctx: CheckContext): Promise<CheckOutcome> {
  const headers: Record<string, string> = {};
  for (const header of config.headers ?? []) headers[header.name.toLowerCase()] = header.value;
  for (const header of ctx.secret?.headers ?? []) headers[header.name.toLowerCase()] = header.value;
  const response = await guardedRequest({
    url: config.url,
    method: config.method,
    headers,
    body: config.method === "GET" || config.method === "HEAD" ? undefined : config.body,
    timeoutMs: ctx.timeoutMs,
    followRedirects: config.followRedirects,
    ignoreTls: config.ignoreTls,
    policy: ctx.policy,
    lookup: ctx.lookup,
  });
  if (!response.ok) return down(response.error, response.message, { latencyMs: response.error === "TIMEOUT" ? response.latencyMs : null, resolvedIp: response.resolvedIp });

  const certDaysLeft = response.cert?.validTo ? daysUntil(response.cert.validTo, ctx.now) : null;
  const meta: Record<string, unknown> = {
    ttfbMs: response.ttfbMs,
    redirects: response.redirects,
    ...(response.bodyTruncated ? { bodyTruncated: true } : {}),
    ...(certDaysLeft !== null ? { certDaysLeft, certValidTo: response.cert!.validTo!.toISOString() } : {}),
  };
  const excerpt = response.body.slice(0, 300);
  const base = { latencyMs: response.latencyMs, statusCode: response.status, resolvedIp: response.resolvedIp };

  if (!parseExpectedStatus(config.expectedStatus)(response.status)) {
    return { ...base, status: "DOWN", error: "STATUS_MISMATCH", message: `Expected ${config.expectedStatus}, got ${response.status}.`, meta: { ...meta, bodyExcerpt: excerpt } };
  }
  const assertions = config.assertions.length
    ? evaluateAssertions(config.assertions, {
        status: response.status,
        responseTimeMs: response.latencyMs,
        body: response.body,
        headers: response.headers,
        certExpiresInMs: response.cert?.validTo ? response.cert.validTo.getTime() - ctx.now.getTime() : null,
        connected: true,
        ip: response.resolvedIp,
      })
    : undefined;
  const failed = assertions?.filter((assertion) => !assertion.passed) ?? [];
  if (failed.length > 0) {
    return {
      ...base,
      status: "DOWN",
      error: "ASSERTION_FAILED",
      message: truncateMessage(`Failed: ${failed.map((assertion) => assertion.expr).join("; ")}`),
      assertions,
      meta: { ...meta, bodyExcerpt: excerpt },
    };
  }
  const status = latencyStatus(response.latencyMs, ctx.degradedLatencyMs);
  return {
    ...base,
    status,
    message: status === "DEGRADED" ? `Slow response: ${response.latencyMs} ms (threshold ${ctx.degradedLatencyMs} ms).` : undefined,
    assertions,
    meta,
  };
}
