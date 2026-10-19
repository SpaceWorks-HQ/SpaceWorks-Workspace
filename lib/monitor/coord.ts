import "server-only";

import { getRedis } from "@/lib/redis";

/**
 * Cross-replica coordination for the monitor (Redis when configured,
 * process memory otherwise): one-time claims, short locks, fixed-window
 * counters and a small JSON cache. Keys live under `sww:monitor:`.
 */

const PREFIX = "sww:monitor:";
const STORE_KEY = Symbol.for("sww.monitorCoord");
type MemoryEntry = { value: string; expiresAt: number };
type GlobalWithStore = typeof globalThis & { [STORE_KEY]?: Map<string, MemoryEntry> };

function memory(): Map<string, MemoryEntry> {
  const g = globalThis as GlobalWithStore;
  return (g[STORE_KEY] ??= new Map());
}

function memoryGet(key: string): string | null {
  const entry = memory().get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory().delete(key);
    return null;
  }
  return entry.value;
}

function memorySetNx(key: string, value: string, ttlMs: number): boolean {
  if (memoryGet(key) !== null) return false;
  memory().set(key, { value, expiresAt: Date.now() + ttlMs });
  if (memory().size > 10_000) {
    const now = Date.now();
    for (const [k, entry] of memory()) if (entry.expiresAt <= now) memory().delete(k);
  }
  return true;
}

/** True exactly once per key inside `ttlMs` across replicas (SET NX PX). */
export async function claimOnce(key: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  if (redis) {
    try {
      return (await redis.set(PREFIX + key, "1", "PX", ttlMs, "NX")) === "OK";
    } catch {
      // A configured coordinator must fail closed across replicas.
      return false;
    }
  }
  return memorySetNx(PREFIX + key, "1", ttlMs);
}

export async function releaseClaim(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(PREFIX + key);
    } catch {
      // ignore
    }
  }
  memory().delete(PREFIX + key);
}

/** Fixed-window counter; returns true while the count stays within `max`. */
export async function withinLimit(key: string, max: number, windowMs: number): Promise<boolean> {
  const full = `${PREFIX}limit:${key}:${Math.floor(Date.now() / windowMs)}`;
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.incr(full);
      if (count === 1) await redis.pexpire(full, windowMs);
      return count <= max;
    } catch {
      return false;
    }
  }
  const current = Number(memoryGet(full) ?? "0") + 1;
  memory().set(full, { value: String(current), expiresAt: Date.now() + windowMs });
  return current <= max;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  let raw: string | null = null;
  if (redis) {
    try {
      raw = await redis.get(PREFIX + key);
    } catch {
      raw = null;
    }
  }
  raw ??= memoryGet(PREFIX + key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const raw = JSON.stringify(value);
  memory().set(PREFIX + key, { value: raw, expiresAt: Date.now() + ttlMs });
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(PREFIX + key, raw, "PX", ttlMs);
    } catch {
      // memory copy is enough
    }
  }
}

/** Wait until `key` can be claimed (token-bucket style spacing), up to `maxWaitMs`. */
export async function waitForSlot(key: string, spacingMs: number, maxWaitMs: number, signal?: AbortSignal): Promise<boolean> {
  const until = Date.now() + maxWaitMs;
  while (Date.now() <= until && !signal?.aborted) {
    if (await claimOnce(`slot:${key}`, spacingMs)) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(spacingMs, 250)));
  }
  return false;
}
