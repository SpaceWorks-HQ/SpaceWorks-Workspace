"use client";

import { useEffect, useRef } from "react";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

/**
 * Subscribe to a workspace's realtime stream (SSE). `onEvent` receives every
 * event visible to the signed-in member; filter by `type`/`channel` in the
 * callback and refetch through server code. EventSource reconnects itself.
 */
export function useRealtime(workspaceSlug: string, onEvent: (event: RealtimeEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/realtime/${encodeURIComponent(workspaceSlug)}`);
    const listener = (message: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(message.data) as RealtimeEvent);
      } catch {
        // Ignore malformed events.
      }
    };
    source.addEventListener("message", listener);
    return () => {
      source.removeEventListener("message", listener);
      source.close();
    };
  }, [workspaceSlug]);
}
