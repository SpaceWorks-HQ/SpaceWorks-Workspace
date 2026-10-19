"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ContactsNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/w/${slug}/contacts`;
  return <nav aria-label="Relationships" className="flex flex-wrap gap-5 border-b border-line text-label">
    {[["", "Contacts"], ["/organisations", "Organisations"], ["/pipeline", "Pipeline"]].map(([suffix, label]) => {
      const href = `${base}${suffix}`;
      const active = suffix ? pathname.startsWith(href) : !pathname.startsWith(`${base}/organisations`) && !pathname.startsWith(`${base}/pipeline`);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex min-h-11 items-center border-b-2 ${active ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>;
    })}
  </nav>;
}
