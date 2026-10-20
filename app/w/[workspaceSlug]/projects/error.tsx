"use client";
import { Button } from "@/components/ui/button";
export default function ProjectsError({ reset }: { reset: () => void }) {
  return <div role="alert" className="space-y-4 rounded-xl border border-line bg-panel p-6"><h2 className="text-h2">Couldn’t load projects.</h2><p>Try loading this page again.</p><Button onClick={reset}>Try again</Button></div>;
}
