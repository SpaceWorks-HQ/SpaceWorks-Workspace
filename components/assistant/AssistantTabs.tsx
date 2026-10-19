"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

/** Underline tabs for the assistant area. Memory, skills and jobs are admin pages. */
export function AssistantTabs({ slug, admin }: { slug: string; admin: boolean }) {
  const pathname = usePathname() ?? "";
  const base = `/w/${slug}/assistant`;
  const tabs = [
    { href: base, label: "Chat", active: pathname === base || pathname.startsWith(`${base}/c/`) },
    ...(admin
      ? [
          { href: `${base}/memory`, label: "Memory", active: pathname.startsWith(`${base}/memory`) },
          { href: `${base}/skills`, label: "Skills", active: pathname.startsWith(`${base}/skills`) },
          { href: `${base}/jobs`, label: "Scheduled jobs", active: pathname.startsWith(`${base}/jobs`) },
        ]
      : []),
  ];
  return <NavTabs label="Assistant" items={tabs} />;
}
