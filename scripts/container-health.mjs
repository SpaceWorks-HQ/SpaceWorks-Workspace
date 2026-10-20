// Readiness is private; the bearer travels only in a request header.
const origin = process.env.SWW_HEALTH_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
const secret = process.env.HEALTHCHECK_SECRET;
try {
  const response = await fetch(`${origin}${secret ? "/api/health/db" : "/api/health"}`, {
    headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: AbortSignal.timeout(4000),
  });
  await response.body?.cancel();
  process.exitCode = response.ok ? 0 : 1;
} catch { process.exitCode = 1; }
