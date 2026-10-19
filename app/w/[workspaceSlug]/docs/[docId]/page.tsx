import Link from "next/link";
import { notFound } from "next/navigation";
import { DocEditor } from "@/components/docs/DocEditor";
import { Card } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { canArchiveDoc, canEditDoc, canSeeDoc, verificationState } from "@/lib/docs/rules";
import { sanitizeDocHtml } from "@/lib/docs/sanitize";
import { ancestorIds } from "@/lib/docs/tree";
import { formatBytes, relativeInSentence } from "@/lib/files/versions";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { hasRoleAtLeast } from "@/lib/roles";

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/docs/[docId]">) {
  const { workspaceSlug, docId } = await params;
  const { workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: workspace.id, archivedAt: null }, select: { title: true, visibility: true } });
  return { title: doc && canSeeDoc(membership, doc) ? doc.title : "Docs" };
}

export default async function DocPage({ params }: PageProps<"/w/[workspaceSlug]/docs/[docId]">) {
  const { workspaceSlug, docId } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const doc = await prisma.doc.findFirst({
    where: { id: docId, workspaceId: workspace.id, archivedAt: null },
    select: {
      id: true, parentId: true, title: true, contentHtml: true, visibility: true, updatedAt: true, createdAt: true, createdById: true, verifiedUntil: true,
      updatedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
      files: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, filename: true, size: true, folder: true } },
    },
  });
  if (!doc || !canSeeDoc(membership, doc)) notFound();

  const [allDocs, members] = await Promise.all([
    prisma.doc.findMany({ where: { workspaceId: workspace.id, archivedAt: null, ...(hasRoleAtLeast(membership.role, "ADMIN") ? {} : { visibility: "WORKSPACE" }) }, select: { id: true, parentId: true, title: true } }),
    prisma.membership.findMany({
      where: { workspaceId: workspace.id, status: "ACTIVE", ...(doc.visibility === "ADMINS" ? { role: { in: ["OWNER", "ADMIN"] } } : {}) },
      select: { user: { select: { id: true, name: true, email: true } } },
    }),
  ]);
  const titles = new Map(allDocs.map((item) => [item.id, item.title]));
  const breadcrumbs = ancestorIds(allDocs, doc.id).map((id) => ({ id, title: titles.get(id) ?? "Untitled" }));
  const state = verificationState(doc.verifiedUntil);
  const editedBy = doc.updatedBy?.name ?? doc.createdBy?.name ?? "a former member";
  const attachments = doc.files.filter((file) => file.folder !== "/Doc images");

  return (
    <div className="flex flex-col gap-8">
      <DocEditor
        key={doc.id}
        doc={{
          id: doc.id,
          title: doc.title,
          html: sanitizeDocHtml(doc.contentHtml),
          version: doc.updatedAt.toISOString(),
          visibility: doc.visibility,
          parentId: doc.parentId,
          verification: {
            state,
            label: doc.verifiedUntil ? (state === "due_soon" ? `Review by ${formatDate(doc.verifiedUntil, workspace.timezone)}` : `Verified until ${formatDate(doc.verifiedUntil, workspace.timezone)}`) : null,
          },
        }}
        canEdit={canEditDoc(membership, doc)}
        canArchive={canArchiveDoc(membership, doc, user.id)}
        currentUserId={user.id}
        members={members.map((member) => ({ id: member.user.id, name: member.user.name ?? member.user.email.split("@")[0]! }))}
        breadcrumbs={breadcrumbs}
        meta={`Edited ${relativeInSentence(formatRelativeTime(doc.updatedAt, workspace.timezone))} by ${editedBy}`}
      />
      {attachments.length > 0 ? (
        <Card as="section" aria-labelledby="doc-files" className="max-w-[760px]">
          <h2 id="doc-files" className="text-title text-ink">Linked files</h2>
          <ul className="mt-3 divide-y divide-line">
            {attachments.map((file) => (
              <li key={file.id} className="flex min-h-12 items-center justify-between gap-3">
                <Link href={`/w/${workspace.slug}/files/${file.id}`} className="min-w-0 truncate text-body-ui text-accent-text underline-offset-4 hover:underline">{file.filename}</Link>
                <span className="shrink-0 text-caption tabular-nums text-ink-muted">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
