"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
export default function JobsError({ retry }: { error: unknown; retry: () => void }) {
  return <EmptyState patch title="Jobs could not be loaded." action={<Button onClick={retry}>Try again</Button>} />;
}
