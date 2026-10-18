import "server-only";

import Redis from "ioredis";

const REDIS_KEY = Symbol.for("sww.redis");
type RedisStore = { client?: Redis | null };
type GlobalWithRedis = typeof globalThis & { [REDIS_KEY]?: RedisStore };

function store(): RedisStore {
  const g = globalThis as GlobalWithRedis;
  return (g[REDIS_KEY] ??= {});
}

export function isRedisConfigured() {
  const url = process.env.REDIS_URL?.trim();
  return Boolean(url && url !== "memory://");
}

/** Build a new connection (used for pub/sub subscribers, which cannot issue other commands). */
export function createRedisConnection(): Redis | null {
  if (!isRedisConfigured()) return null;
  const client = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2, connectTimeout: 2000, lazyConnect: true });
  client.on("error", () => console.warn("[redis] connection error"));
  return client;
}

/** Shared command connection for the process, or null when Redis is not configured. */
export function getRedis(): Redis | null {
  const s = store();
  if (s.client !== undefined) return s.client;
  s.client = createRedisConnection();
  return s.client;
}
