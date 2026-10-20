"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
export default function ErrorPage({ reset }: { reset: () => void }) { return <Card><p role="alert">Social could not load. Try again.</p><Button className="mt-3" onClick={reset}>Try again</Button></Card>; }
