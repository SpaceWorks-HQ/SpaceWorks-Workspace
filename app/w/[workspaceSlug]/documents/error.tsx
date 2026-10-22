"use client";
import { Button } from "@/components/ui/button";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="space-y-4 p-6">
      <p>Couldn&apos;t open documents. Try again.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
