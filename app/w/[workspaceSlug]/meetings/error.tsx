"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div className="space-y-4 p-6" role="alert">
      <h2 className="text-h3">Couldn’t load this page.</h2>
      <p className="text-ink-muted">Try loading it again.</p>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
