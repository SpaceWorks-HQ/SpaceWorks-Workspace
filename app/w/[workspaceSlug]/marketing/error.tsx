"use client";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) { return <div role="alert" className="space-y-4 rounded-xl border border-line bg-panel p-6"><h2 className="text-h2">Couldn&apos;t load these tools.</h2><p>Try again to load your records.</p><Button onClick={reset}>Try again</Button></div>; }
