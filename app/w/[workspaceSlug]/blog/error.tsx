"use client";

import { Button } from "@/components/ui/button";

export default function BlogError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-xl border border-line bg-panel p-6">
      <h2 className="text-h3 text-ink">The posts didn&apos;t load.</h2>
      <p className="text-body-ui text-ink-secondary">Try again to load the blog.</p>
      <Button variant="primary" onClick={retry}>Try again</Button>
    </div>
  );
}
