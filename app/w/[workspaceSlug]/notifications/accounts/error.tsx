"use client";
import { Button } from "@/components/ui/button";
export default function ErrorState({ reset }: { reset: () => void }) { return <div role="alert" className="space-y-4 rounded-xl border border-line bg-panel p-6"><p>Couldn’t load this page. Try again.</p><Button onClick={reset}>Try again</Button></div>; }
