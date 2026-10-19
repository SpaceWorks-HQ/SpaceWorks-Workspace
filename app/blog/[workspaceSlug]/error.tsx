"use client";

import { Button } from "@/components/ui/button";

export default function PublicBlogError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4">
      <h1 className="text-h1 text-ink">The blog didn&apos;t load.</h1>
      <p className="text-body-ui text-ink-secondary">Try again in a moment.</p>
      <Button variant="primary" onClick={retry}>Try again</Button>
    </div>
  );
}
