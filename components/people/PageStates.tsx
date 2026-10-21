"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/display";

/** Loading placeholder for people, teams, rota and contacts pages. */
export function PeopleLoading({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label}</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** Error boundary body: says what happened and offers a retry. */
export function PeopleError({ what, error, reset }: { what: string; error: unknown; reset?: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error(`[people] ${what} failed to load`, error);
    else console.error(`[people] ${what} failed to load`);
  }, [error, what]);
  return (
    <EmptyState patch title={`Couldn't load ${what}.`} action={reset ? <Button variant="primary" onClick={reset}>Try again</Button> : undefined}>
      Check your connection and try again. If it keeps happening, tell an admin.
    </EmptyState>
  );
}
