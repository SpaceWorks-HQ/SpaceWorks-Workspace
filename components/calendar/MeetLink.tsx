"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export function MeetLink({ url, pending, error }: { url?: string | null; pending?: boolean; error?: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!pending || url) return;
    const timer = setInterval(() => { if (!document.hidden) router.refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [pending, url, router]);
  if (url) return <div className="flex flex-wrap items-center gap-3"><a className="break-all text-accent-text underline" href={url} target="_blank" rel="noopener noreferrer">{url}</a><Button variant="primary" asChild><a href={url} target="_blank" rel="noopener noreferrer">Join {url.startsWith("https://meet.google.com/") ? "Google Meet" : "video meeting"}</a></Button></div>;
  return pending ? <p role="status" className="text-ink-muted">Meet link being created…</p> : error ? <p role="alert" className="text-danger-fg">{error}</p> : null;
}
