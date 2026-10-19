import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RestoreRevisionButton } from "@/components/docs/RestoreButtons";
import styles from "@/components/docs/DocProse.module.css";
import { Card, Chip, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { canEditDoc, canSeeDoc } from "@/lib/docs/rules";
import { sanitizeDocHtml } from "@/lib/docs/sanitize";
import { formatDayTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { cn } from "@/lib/cn";

export const metadata = { title: "Version history" };

/** Saved versions of a page (one per editing session), newest first, with a read-only preview and restore. */
export default async function DocHistoryPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/docs/[docId]/history">) {
  const { workspaceSlug, docId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: workspace.id, archivedAt: null }, select: { id: true, title: true, visibility: true } });
  if (!doc || !canSeeDoc(membership, doc)) notFound();
  const revisions = await prisma.docRevision.findMany({
    where: { docId: doc.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, createdAt: true, author: { select: { name: true } } },
  });
  const requested = (await searchParams).rev;
  const selectedId = typeof requested === "string" && revisions.some((revision) => revision.id === requested) ? requested : revisions[0]?.id;
  const selected = selectedId ? await prisma.docRevision.findFirst({ where: { id: selectedId, docId: doc.id }, select: { id: true, title: true, contentHtml: true, createdAt: true } }) : null;
  const isCurrent = selected?.id === revisions[0]?.id;
  const label = selected ? formatDayTime(selected.createdAt, workspace.timezone) : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={
          <Link href={`/w/${workspace.slug}/docs/${doc.id}`} className="inline-flex items-center gap-1.5 hover:text-ink hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> Back to {doc.title}
          </Link>
        }
        title="Version history"
        description="A version is kept for each editing session. Restoring adds a new version, so nothing is ever lost."
      />
      {revisions.length === 0 ? (
        <Card><p className="text-body-ui text-ink-muted">No saved versions yet. Versions appear once someone edits the page.</p></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Versions" className="min-w-0">
            <Card padding="none">
              <ol className="max-h-[320px] divide-y divide-line overflow-y-auto xl:max-h-none">
                {revisions.map((revision, index) => {
                  const active = revision.id === selectedId;
                  return (
                    <li key={revision.id}>
                      <Link
                        href={`/w/${workspace.slug}/docs/${doc.id}/history?rev=${revision.id}`}
                        aria-current={active ? "true" : undefined}
                        className={cn("flex min-h-14 flex-col justify-center gap-0.5 px-4 py-2.5 transition-colors duration-[120ms]", active ? "bg-accent-soft" : "hover:bg-subtle")}
                      >
                        <span className="flex items-center gap-2 text-body-ui font-semibold tabular-nums text-ink">
                          {formatDayTime(revision.createdAt, workspace.timezone)}
                          {index === 0 ? <Chip tone="success" size="sm">Current</Chip> : null}
                        </span>
                        <span className="truncate text-caption text-ink-muted">{revision.author?.name ?? "Former member"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </Card>
          </nav>
          {selected ? (
            <Card as="section" aria-label={`Version from ${label}`} padding="lg" className="flex min-w-0 flex-col gap-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-caption text-ink-muted">Version from {label}</p>
                {!isCurrent && canEditDoc(membership, doc) ? <RestoreRevisionButton slug={workspace.slug} docId={doc.id} revisionId={selected.id} label={label} /> : null}
              </div>
              <h2 className="text-h2 text-ink">{selected.title}</h2>
              <div className={styles.prose} dangerouslySetInnerHTML={{ __html: sanitizeDocHtml(selected.contentHtml) }} />
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
