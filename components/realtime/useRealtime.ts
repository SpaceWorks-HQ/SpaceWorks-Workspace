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
    let source: EventSource | undefined;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const path = `/api/realtime/${encodeURIComponent(workspaceSlug)}`;
        const backend = process.env.NEXT_PUBLIC_BACKEND_ORIGIN;
        let url = path;
        if (backend) {
          const response = await fetch(`${path}/ticket`, { method: "POST", cache: "no-store" });
          if (!response.ok) throw new Error("Stream ticket unavailable");
          const { token } = await response.json();
          url = `${backend}${path}?ticket=${encodeURIComponent(token)}`;
        }
        if (stopped) return;
        source = new EventSource(url);
        source.addEventListener("message", listener);
        if (backend) source.onerror = () => { source?.close(); if (!stopped) timer = setTimeout(connect, 5_000); };
      } catch { if (!stopped) timer = setTimeout(connect, 10_000); }
    };
    const listener = (message: MessageEvent<string>) => {
      try {
        handler.current(JSON.parse(message.data) as RealtimeEvent);
      } catch {
        // Ignore malformed events.
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      source?.removeEventListener("message", listener);
      source?.close();
    };
  }, [workspaceSlug]);
}
