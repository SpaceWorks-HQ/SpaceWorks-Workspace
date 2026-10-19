import "server-only";

import { EventEmitter } from "events";
import type Redis from "ioredis";
import { createRedisConnection, getRedis, isRedisConfigured } from "@/lib/redis";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

export type { RealtimeEvent } from "@/lib/realtimeTypes";
export { isEventVisibleTo } from "@/lib/realtimeTypes";

/**
 * Workspace-scoped realtime fan-out. `publish` sends through Redis pub/sub
 * so every replica's SSE connections receive it; without Redis (development)
 * an in-process EventEmitter is used instead. Publishing is best effort and
 * never throws: a failed publish must not fail the mutation that caused it.
 *
 * Consumers: /api/realtime/[workspaceSlug] (SSE) subscribes per connection;
 * browser code uses `useRealtime` from components/realtime/useRealtime.ts.
 */

type Handler = (event: RealtimeEvent) => void;

const STATE_KEY = Symbol.for("sww.realtime");
type RealtimeState = {
  emitter: EventEmitter;
  subscriber?: Redis | null;
  /** workspaceId -> number of local handlers, to (un)subscribe Redis channels. */
  refs: Map<string, number>;
};

function state(): RealtimeState {
  const g = globalThis as typeof globalThis & { [STATE_KEY]?: RealtimeState };
  if (!g[STATE_KEY]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    g[STATE_KEY] = { emitter, refs: new Map() };
  }
  return g[STATE_KEY]!;
}

const redisChannel = (workspaceId: string) => `sww:rt:${workspaceId}`;
const localEvent = (workspaceId: string) => `ws:${workspaceId}`;

function subscriber(): Redis | null {
  const s = state();
  if (s.subscriber !== undefined) return s.subscriber;
  s.subscriber = createRedisConnection();
  s.subscriber?.on("message", (channel: string, raw: string) => {
    if (!channel.startsWith("sww:rt:")) return;
    try {
      s.emitter.emit(localEvent(channel.slice("sww:rt:".length)), JSON.parse(raw) as RealtimeEvent);
    } catch {
      // Ignore malformed payloads.
    }
  });
  return s.subscriber;
}

/**
 * Publish an event to everyone connected to a workspace (subject to
 * `audience` and `user:` channel filtering in the SSE route).
 */
export async function publish(
  workspaceId: string,
  channel: string,
  event: Omit<RealtimeEvent, "channel" | "at"> & { at?: string },
): Promise<void> {
  const full: RealtimeEvent = { ...event, channel, at: event.at ?? new Date().toISOString() };
  try {
    const redis = isRedisConfigured() ? getRedis() : null;
    if (redis) {
      await redis.publish(redisChannel(workspaceId), JSON.stringify(full));
    } else {
      state().emitter.emit(localEvent(workspaceId), full);
    }
  } catch {
    console.warn("[realtime] publish failed");
  }
}

/** Publish to one member's private stream (`user:<id>`). */
export function publishToUser(workspaceId: string, userId: string, event: Omit<RealtimeEvent, "channel" | "at" | "audience">) {
  return publish(workspaceId, `user:${userId}`, { ...event, audience: [userId] });
}

/** Subscribe to all events of a workspace. Returns an unsubscribe function. */
export async function subscribe(workspaceId: string, handler: Handler): Promise<() => void> {
  const s = state();
  const name = localEvent(workspaceId);
  s.emitter.on(name, handler);
  const sub = isRedisConfigured() ? subscriber() : null;
  const count = (s.refs.get(workspaceId) ?? 0) + 1;
  s.refs.set(workspaceId, count);
  if (sub && count === 1) {
    try {
      await sub.subscribe(redisChannel(workspaceId));
    } catch {
      console.warn("[realtime] subscribe failed");
    }
  }
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    s.emitter.off(name, handler);
    const remaining = (s.refs.get(workspaceId) ?? 1) - 1;
    if (remaining <= 0) {
      s.refs.delete(workspaceId);
      if (sub) void sub.unsubscribe(redisChannel(workspaceId)).catch(() => undefined);
    } else {
      s.refs.set(workspaceId, remaining);
    }
  };
}
