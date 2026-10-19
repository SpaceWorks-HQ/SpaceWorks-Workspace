import Link from "next/link";
import { RestoreFileButton } from "@/components/files/RestoreFileButton";
import { Card, EmptyState, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { FILE_TRASH_DAYS, libraryWhere } from "@/lib/files/service";
import { formatBytes, relativeInSentence } from "@/lib/files/versions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";

export const metadata = { title: "Recently deleted files" };

export default async function DeletedFilesPage({ params }: PageProps<"/w/[workspaceSlug]/files/deleted">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const files = await prisma.fileObject.findMany({
    where: await libraryWhere({ workspace, user, membership }, { deleted: true }),
    orderBy: { deletedAt: "desc" },
    take: 200,
    select: { id: true, filename: true, folder: true, size: true, deletedAt: true, uploadedById: true },
  });
  const admin = hasRoleAtLeast(membership.role, "ADMIN");
  const contributor = canContribute(membership);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={<Link href={`/w/${workspace.slug}/files`} className="hover:text-ink hover:underline">Files</Link>}
        title="Recently deleted"
        description={`Deleted files stay here for ${FILE_TRASH_DAYS} days, then they and their versions are removed for good.`}
      />
      {files.length === 0 ? (
        <EmptyState title="Nothing deleted.">Files you delete wait here for {FILE_TRASH_DAYS} days in case you need them back.</EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {files.map((file) => (
              <li key={file.id} className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-body-ui font-semibold text-ink">{file.filename}</span>
                  <span className="block text-caption text-ink-muted">
                    {file.folder === "/" ? "All files" : file.folder} · {formatBytes(file.size)} · deleted {relativeInSentence(formatRelativeTime(file.deletedAt!, workspace.timezone))}
                  </span>
                </span>
                {admin || (contributor && file.uploadedById === user.id) ? <RestoreFileButton slug={workspace.slug} fileId={file.id} /> : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
