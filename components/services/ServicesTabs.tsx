"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function ServicesTabs({ slug, tabs }: { slug: string; tabs: string[][] }) {
  const pathname = usePathname();
  return <nav aria-label="Services" className="flex flex-wrap gap-x-4 border-b border-line">{tabs.map(([path, label]) => {
    const href = `/w/${slug}/services${path}`, active = pathname === href || Boolean(path && pathname.startsWith(`${href}/`));
    return <Link key={path} href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 text-label text-accent-text ${active ? "border-accent-text" : "border-transparent hover:border-line"}`}>{label}</Link>;
  })}</nav>;
}
