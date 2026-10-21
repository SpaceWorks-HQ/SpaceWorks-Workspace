"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <EmptyState patch title="The report could not be prepared. Check the period and filters, then try again." action={
        <div className="flex flex-wrap gap-3">
          <Button onClick={reset} variant="primary">Try again</Button>
          <Button asChild variant="secondary"><a href="?period=month&section=home">Reset filters</a></Button>
        </div>
      } />
    </div>
  );
}
