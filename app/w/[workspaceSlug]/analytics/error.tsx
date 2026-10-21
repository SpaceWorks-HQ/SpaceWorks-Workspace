"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return (
    <div
      role="alert"
      className="space-y-4 rounded-xl border border-line bg-panel p-6"
    >
      <h2 className="text-h2">The report could not be prepared</h2>
      <p>Check the period and filters, then try again.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <a
          href="?period=month&section=home"
          className="min-h-11 py-3 text-accent-text underline"
        >
          Reset filters
        </a>
      </div>
    </div>
  );
}
