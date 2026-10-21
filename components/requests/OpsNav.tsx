"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function OpsNav({ slug }: { slug: string }) {
 const path = usePathname();
 return <nav aria-label="Operations" className="flex flex-wrap gap-x-5 gap-y-2 border-b border-line text-label">{["requests", "catalogue", "subscriptions", "vault", "assets", "forms"].map(area => {
  const href = `/w/${slug}/${area}`;
  const active = path === href || path.startsWith(`${href}/`);
  return <Link key={area} href={href} aria-current={active ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 text-accent-text underline-offset-8 hover:underline ${active ? "border-accent-text" : "border-transparent"}`}>{area[0].toUpperCase() + area.slice(1)}</Link>;
 })}</nav>;
}
