"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { folderCrumbs } from "@/lib/files/versions";

export function FileFolderBreadcrumbs({ folder, libraryHref }: {
  folder: string;
  libraryHref: (path: string) => string;
}) {
  return (
    <nav aria-label="Folder" className="min-w-0">
      <ol className="flex flex-wrap items-center gap-1 text-body-ui">
        <li><Link href={libraryHref("/")} className={cn("hover:underline", folder === "/" ? "font-semibold text-ink" : "text-ink-muted")}>All files</Link></li>
        {folderCrumbs(folder).map((crumb, index, list) => (
          <li key={crumb.path} className="flex items-center gap-1">
            <span aria-hidden className="text-ink-muted">/</span>
            <Link href={libraryHref(crumb.path)} aria-current={index === list.length - 1 ? "page" : undefined} className={cn("hover:underline", index === list.length - 1 ? "font-semibold text-ink" : "text-ink-muted")}>{crumb.name}</Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
