"use client";

import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/display";

/** Loading placeholder for the community pages: a header and a few card rows. */
export function CommunityLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label}…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  );
}

/** Error boundary body: says what happened and offers a retry. */
export function CommunityError({ what, reset }: { what: string; reset: () => void }) {
  return (
    <EmptyState patch title={`Couldn't load ${what}.`} action={<Button variant="primary" onClick={reset}>Try again</Button>}>
      Check your connection and try again. If it keeps happening, tell an admin.
    </EmptyState>
  );
}
