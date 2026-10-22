import Link from "next/link";
import { RestoreDocButton } from "@/components/docs/RestoreButtons";
import { Card, EmptyState, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { canArchiveDoc } from "@/lib/docs/rules";
import { visibleDocsWhere } from "@/lib/docs/service";
import { formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Archived pages" };

/** Pages archived on their own (sub-pages archived with a parent come back with it). */
export default async function ArchivedDocsPage({ params }: PageProps<"/w/[workspaceSlug]/docs/archived">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const archived = await prisma.doc.findMany({
    where: { ...visibleDocsWhere(workspace.id, membership.role), archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    take: 200,
    select: { id: true, title: true, archivedAt: true, visibility: true, createdById: true, parent: { select: { archivedAt: true } }, _count: { select: { children: true } } },
  });
  const roots = archived.filter((doc) => doc.parent?.archivedAt?.getTime() !== doc.archivedAt!.getTime());

  return (
    <div className="flex flex-col gap-6">
      <PageHeader kicker={<Link href={`/w/${workspace.slug}/docs`} className="hover:text-ink hover:underline">Docs</Link>} title="Archived pages" description="Archived pages are hidden from the tree and search. Restoring brings back their sub-pages too." />
      {roots.length === 0 ? (
        <EmptyState patch title="Nothing archived.">Pages you archive wait here until someone restores them.</EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {roots.map((doc) => (
              <li key={doc.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-body-ui font-semibold text-ink">{doc.title}</span>
                  <span className="block text-caption text-ink-muted">
                    Archived {formatRelativeTime(doc.archivedAt!, workspace.timezone)}
                    {doc._count.children > 0 ? ` · with sub-pages` : ""}
                  </span>
                </span>
                {canArchiveDoc(membership, doc, user.id) ? <RestoreDocButton slug={workspace.slug} docId={doc.id} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
