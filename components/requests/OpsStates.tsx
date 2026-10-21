"use client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/display";
import { BrandPageLoader } from "@/components/brand/BrandLoader";
export function OpsLoading() {
 return <BrandPageLoader label="Loading operations" />;
}
export function OpsErrorState({ retry }: { error: unknown; retry: () => void }) {
 return <EmptyState patch title="Couldn't load this page. Try again." action={<Button onClick={retry}>Try again</Button>} />;
}
