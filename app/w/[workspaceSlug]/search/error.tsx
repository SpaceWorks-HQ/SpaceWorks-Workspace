"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 py-8">
      <h2 className="text-h3">This page couldn’t load.</h2>
      <p>Try again in a moment.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
