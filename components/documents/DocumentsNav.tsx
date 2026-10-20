"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
export function DocumentsNav() {
  const params = useParams<{ workspaceSlug: string }>(),
    path = usePathname(),
    base = `/w/${params.workspaceSlug}/documents`;
  return (
    <nav
      aria-label="Documents"
      className="flex min-h-11 gap-5 overflow-x-auto border-b border-line text-label"
    >
      {[
        [base, "Documents"],
        [`${base}/settings`, "Tax settings and templates"],
      ].map(([href, title]) => (
        <Link
          key={href}
          aria-current={path === href ? "page" : undefined}
          href={href}
          className={`shrink-0 border-b-2 py-3 ${path === href ? "border-primary text-ink" : "border-transparent text-ink-muted"}`}
        >
          {title}
        </Link>
      ))}
    </nav>
  );
}
