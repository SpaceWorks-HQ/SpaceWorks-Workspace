"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
export function OpsLoading() {
 return <Card><p role="status" className="text-body-ui text-ink-muted">Loading operations…</p></Card>;
}
export function OpsErrorState({ retry }: { error: unknown; retry: () => void }) {
 return <Card><h2 className="text-h3">Couldn&apos;t load this page.</h2><p className="my-4 text-body-ui text-ink-muted">Try again to fetch the latest records.</p><Button onClick={retry}>Try again</Button></Card>;
}
