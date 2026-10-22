import Link from "next/link";
import { FilesLibrary } from "@/components/files/FilesLibrary";
import { PageHeader, StatTile } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { libraryWhere, usageSummary } from "@/lib/files/service";
import { childFolders, FILE_KIND_LABEL, formatBytes, isWithinFolder } from "@/lib/files/versions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { maxUploadBytes, normalizeFolder } from "@/lib/storage";

export const metadata = { title: "Files" };

export default async function FilesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/files">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const search = await searchParams;
  const folder = normalizeFolder(typeof search.folder === "string" ? search.folder : "/");
  const query = typeof search.q === "string" ? search.q.trim().slice(0, 100) : "";
  const actor = { workspace, user, membership };
  const where = await libraryWhere(actor);

  const [folderRows, files, usage, deletedCount] = await Promise.all([
    prisma.fileObject.groupBy({ by: ["folder"], where }),
    prisma.fileObject.findMany({
      where: query ? { ...where, filename: { contains: query, mode: "insensitive" }, ...(folder === "/" ? {} : { OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] }) } : { ...where, folder },
      orderBy: query ? [{ createdAt: "desc" }] : [{ filename: "asc" }],
      take: 300,
      select: { id: true, filename: true, contentType: true, size: true, folder: true, currentVersion: true, createdAt: true, uploadedById: true, uploadedBy: { select: { name: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true } } },
    }),
    usageSummary(workspace.id),
    prisma.fileObject.count({ where: await libraryWhere(actor, { deleted: true }) }),
  ]);
  const allFolders = folderRows.map((row) => row.folder);
  const admin = hasRoleAtLeast(membership.role, "ADMIN");
  const contributor = canContribute(membership);

  const uploadLimit = maxUploadBytes();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Files" description="Shared files for the whole crew: build files, photos, manuals and paperwork." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Files" value={usage.files.toLocaleString("en-IN")} />
        <StatTile label="Storage used" value={formatBytes(usage.bytes + usage.versionBytes)} hint="Library, pages and other areas" />
        <StatTile label="Older versions" value={formatBytes(usage.versionBytes)} hint="Newest 20 kept per file" />
        <StatTile label="Recently deleted" value={deletedCount.toLocaleString("en-IN")} hint={`${formatBytes(usage.trashBytes)} · kept 30 days`} href={`/w/${workspace.slug}/files/deleted`} />
      </div>
      <FilesLibrary
        slug={workspace.slug}
        folder={folder}
        query={query}
        subfolders={query ? [] : childFolders(allFolders.filter((path) => isWithinFolder(path, folder)), folder)}
        allFolders={allFolders.includes("/") ? allFolders : ["/", ...allFolders]}
        canUpload={contributor}
        maxUploadLabel={`${Math.floor(uploadLimit / (1024 * 1024))} MB`}
        files={files.map((file) => ({
          id: file.id,
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          folder: file.folder,
          version: file.currentVersion,
          uploadedBy: file.uploadedBy?.name ?? "Former member",
          updated: formatRelativeTime(file.versions[0]?.createdAt ?? file.createdAt, workspace.timezone),
          canDelete: admin || (contributor && file.uploadedById === user.id),
        }))}
      />
      {usage.byKind.length > 0 ? (
        <section aria-labelledby="usage-heading" className="flex flex-col gap-2">
          <h2 id="usage-heading" className="text-label text-ink">Storage by type</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-ink-muted">
            {usage.byKind.map((kind) => (
              <li key={kind.kind} className="tabular-nums">
                {FILE_KIND_LABEL[kind.kind]}: {formatBytes(kind.bytes)} in {kind.files} {kind.files === 1 ? "file" : "files"}
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-muted">
            Includes files attached to pages and other areas, but not chat attachments or <Link href={`/w/${workspace.slug}/files/deleted`} className="text-accent-text underline underline-offset-4">recently deleted</Link> files.
          </p>
        </section>
      ) : null}
    </div>
  );
}
