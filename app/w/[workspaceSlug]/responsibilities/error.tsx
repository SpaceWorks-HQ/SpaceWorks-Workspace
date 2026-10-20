"use client";
import { Button } from "@/components/ui/button";
export default function OrgError({ reset }: { reset: () => void }) { return <div role="alert" className="space-y-4 p-6"><h2 className="text-h3">Couldn’t load this people tool.</h2><p>Try again. If this continues, contact a workspace admin.</p><Button onClick={reset}>Try again</Button></div>; }
