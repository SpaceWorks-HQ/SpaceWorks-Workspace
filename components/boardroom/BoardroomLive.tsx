"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/useRealtime";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

/** Refreshes the session page when the runner announces a new turn or the end (events carry ids only). */
export function BoardroomLive({ slug, sessionId, active }: { slug: string; sessionId: string; active: boolean }) {
  const router = useRouter();
  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (active && event.channel === `boardroom:${sessionId}` && event.type.startsWith("boardroom.")) router.refresh();
    },
    [active, router, sessionId],
  );
  useRealtime(slug, onEvent);
  return null;
}
