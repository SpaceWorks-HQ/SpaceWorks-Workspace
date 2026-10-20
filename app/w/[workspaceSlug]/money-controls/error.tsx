"use client";
import { EmptyState } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <EmptyState
      patch
      title="Couldn't load these records."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
