"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtime } from "@/components/realtime/useRealtime";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

/**
 * Re-render the current server page when community data changes elsewhere
 * (an announcement goes out). Events carry ids only;
 * the refresh re-reads through the page's own permission checks.
 */
export function LiveRefresh({ slug, types }: { slug: string; types: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = types.join(",");

  const onEvent = useCallback(
    (event: RealtimeEvent) => {
      if (!key.split(",").includes(event.type)) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    },
    [key, router],
  );
  useRealtime(slug, onEvent);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return null;
}
