"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

export type PresenceState = "viewing" | "editing";
export type PresenceEntry = { userId: string; state: PresenceState; at: number };

const PING_MS = 20_000;
const EXPIRE_MS = 50_000;

function ping(slug: string, docId: string, state: PresenceState | "left") {
  return fetch(`/w/${encodeURIComponent(slug)}/docs/${encodeURIComponent(docId)}/presence`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sw-client": "1" },
    body: JSON.stringify({ state }),
    keepalive: state === "left",
  }).catch(() => undefined);
}

/**
 * Who else has this doc open. Pings every 20 s (and when the local state
 * changes), says "left" on close, and listens for others' pings through the
 * docs realtime connection. Entries expire after 50 s of silence.
 */
export function usePresence({ slug, docId, userId, state, subscribe }: { slug: string; docId: string; userId: string; state: PresenceState; subscribe: (listener: (event: RealtimeEvent) => void) => () => void }) {
  const [others, setOthers] = useState<PresenceEntry[]>([]);
  const stateRef = useRef(state);
  const known = useRef(new Map<string, number>());

  useEffect(() => {
    stateRef.current = state;
    void ping(slug, docId, state);
  }, [slug, docId, state]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void ping(slug, docId, stateRef.current);
      for (const [who, at] of known.current) if (Date.now() - at >= EXPIRE_MS) known.current.delete(who);
      setOthers((list) => list.filter((entry) => Date.now() - entry.at < EXPIRE_MS));
    }, PING_MS);
    const leave = () => void ping(slug, docId, "left");
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [slug, docId]);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type !== "doc.presence" || event.channel !== `doc:${docId}`) return;
        const who = typeof event.data?.userId === "string" ? event.data.userId : null;
        if (!who || who === userId) return;
        const next = event.data?.state;
        const active = next === "viewing" || next === "editing";
        // Someone new arrived: answer so they see us without waiting for our next ping.
        if (active && !known.current.has(who)) void ping(slug, docId, stateRef.current);
        if (active) known.current.set(who, Date.now());
        else known.current.delete(who);
        setOthers((list) => {
          const rest = list.filter((entry) => entry.userId !== who);
          return active ? [...rest, { userId: who, state: next, at: Date.now() }] : rest;
        });
      }),
    [subscribe, docId, userId, slug],
  );

  return others;
}
