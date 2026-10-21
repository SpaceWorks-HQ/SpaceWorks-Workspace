import { ListLayout } from "@/components/ui/layouts";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, Card } from "@/components/ui/display";

export function CollaborationShell({
  slug,
  title,
  description,
  children,
}: {
  slug: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <ListLayout header={<PageHeader title={title} description={description} />}>
      <nav
        aria-label="Work collaboration"
        className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line"
      >
        {[
          "cycles",
          "meetings",
          "goals",
          "polls",
          "ideas",
          "templates",
          "changelog",
          "sign",
        ].map((area) => (
          <Link
            key={area}
            href={`/w/${slug}/${area}`}
            className="inline-flex min-h-11 items-center text-label text-accent-text underline-offset-8 hover:underline"
          >
            {area === "sign"
              ? "Acknowledgements"
              : area[0].toUpperCase() + area.slice(1)}
          </Link>
        ))}
      </nav>
      {children}
    </ListLayout>
  );
}
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Card as="section" className="min-w-0 space-y-4">
      <h2 className="text-h4">{title}</h2>
      {children}
    </Card>
  );
}
export function Disclosure({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <Card>
      <details open={open}>
        <summary className="flex min-h-11 cursor-pointer items-center text-title text-accent-text">
          {title}
        </summary>
        <div className="mt-4">{children}</div>
      </details>
    </Card>
  );
}
export function EntryLink({
  href,
  title,
  meta,
}: {
  href: string;
  title: string;
  meta?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="block min-h-14 rounded-xl border border-line bg-panel p-5 hover:bg-subtle"
      >
        <span className="break-words text-title">{title}</span>
        {meta ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-muted">
            {meta}
          </div>
        ) : null}
      </Link>
    </li>
  );
}
export function TextBody({ children }: { children?: string | null }) {
  return children ? (
    <p className="whitespace-pre-wrap break-words text-body-ui text-ink-secondary">
      {children}
    </p>
  ) : null;
}
