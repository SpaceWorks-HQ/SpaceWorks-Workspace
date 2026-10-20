"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
export default function OpsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="p-6"><EmptyState patch="idle" title="Operations could not load. Try again." action={<Button variant="primary" onClick={reset}>Try again</Button>} /></div>; }
