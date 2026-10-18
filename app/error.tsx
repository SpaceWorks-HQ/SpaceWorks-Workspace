"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") console.error("[ui] route error", error);
    else console.error("[ui] route error");
  }, [error]);
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-4 px-4 py-16 text-center">
      <span aria-hidden className="relative mb-2 block size-16">
        <span className="absolute inset-0 rounded-[16px] bg-sw-sky" />
        <span className="absolute -right-2 -top-2 size-7 rounded-full bg-sw-citron" />
      </span>
      <h1 className="text-h1 text-ink">This page didn&apos;t load.</h1>
      <p className="text-body-ui text-ink-secondary">Try again. If it keeps happening, tell whoever runs your Space Works workspace.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  );
}
