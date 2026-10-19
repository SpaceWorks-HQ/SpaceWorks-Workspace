"use client";

import { Button } from "@/components/ui/button";

export default function FinanceError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-4 rounded-xl border border-line bg-panel p-6">
      <h2 className="text-h3 text-ink">The kitty didn&apos;t load.</h2>
      <p className="text-body-ui text-ink-secondary">Try again to load the finance records.</p>
      <Button variant="primary" onClick={retry}>Try again</Button>
    </div>
  );
}
