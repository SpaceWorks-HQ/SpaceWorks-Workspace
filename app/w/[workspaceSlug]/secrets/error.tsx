"use client";
import { EmptyState } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="p-6">
      <EmptyState patch title="Couldn't load Secrets. Try again." action={<Button variant="secondary" onClick={reset}>Try again</Button>} />
    </div>
  );
}
