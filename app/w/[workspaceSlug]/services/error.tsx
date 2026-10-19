"use client";
import { Button } from "@/components/ui/button";
export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="space-y-4 rounded-xl border border-line bg-panel p-6"><h1 className="text-h2">Services could not load.</h1><p className="text-body-ui text-ink-muted">Try again to refresh the service health.</p><Button onClick={retry}>Try again</Button></div>;
}
