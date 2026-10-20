"use client";
import { EmptyState } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
export default function CalendarError({ reset }: { reset: () => void }) {
  return (
    <EmptyState
      title="Couldn't load the calendar."
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
