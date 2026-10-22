import { createHash } from "node:crypto";
export type SecretsOptions = {
  host: string;
  token: string;
  project: string;
  environment?: string;
  path?: string;
  cacheTtlMs?: number;
  signal?: AbortSignal;
};
const cache = new Map<
  string,
  {
    until: number;
    values: Record<string, string>;
  }
>();
export function normaliseHost(input: string) {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Use an HTTPS host, or HTTP on localhost.");
  return url.origin;
}
export async function request(
  host: string,
  path: string,
  token?: string,
  body?: unknown,
  signal?: AbortSignal,
) {
  const response = await fetch(normaliseHost(host) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    let reason =
      "Request failed. Check your session and environment permissions.";
    try {
      const json = await response.json();
      if (typeof json.error === "string" && json.error.length < 250)
        reason = json.error;
    } catch {}
    throw new Error(reason);
  }
  return response;
}
export async function getSecrets(
  options: SecretsOptions,
): Promise<Record<string, string>> {
  const host = normaliseHost(options.host),
    query = new URLSearchParams({
      project: options.project,
      environment: options.environment ?? "dev",
      path: options.path ?? "/",
      format: "json",
    });
  const key = createHash("sha256")
    .update(options.token)
    .update(host)
    .update(query.toString())
    .digest("hex");
  const cacheTtlMs = options.cacheTtlMs ?? 0;
  const cacheEnabled = cacheTtlMs > 0;
  const entry = cacheEnabled ? cache.get(key) : undefined;
  if (entry && entry.until > Date.now()) return { ...entry.values };
  if (cacheEnabled) cache.delete(key);
  const response = await request(
    host,
    "/api/v1/secrets?" + query,
    options.token,
    undefined,
    options.signal,
  );
  const values = await response.json();
  if (
    !values ||
    typeof values !== "object" ||
    Array.isArray(values) ||
    Object.values(values).some((v) => typeof v !== "string")
  )
    throw new Error("The server returned an invalid secrets response.");
  const bytes = Object.entries(values).reduce(
    (total, [key, value]) =>
      total + Buffer.byteLength(key) + Buffer.byteLength(String(value)),
    0,
  );
  if (cacheEnabled && bytes <= 1_000_000) {
    if (cache.size >= 100) cache.clear();
    cache.set(key, {
      until: Date.now() + Math.min(cacheTtlMs, 300000),
      values,
    });
  }
  return { ...values };
}
export function clearSecretsCache() {
  cache.clear();
}
