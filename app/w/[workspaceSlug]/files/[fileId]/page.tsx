import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FileDetailActions, FileVersions } from "@/components/files/FileDetail";
import { Card, DetailList, PageHeader } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { libraryWhere } from "@/lib/files/service";
import { FILE_KIND_LABEL, fileKind, formatBytes, listVersions } from "@/lib/files/versions";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { fileUrl, getObject } from "@/lib/storage";

export async function generateMetadata({ params }: PageProps<"/w/[workspaceSlug]/files/[fileId]">) {
  const { workspaceSlug, fileId } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const file = await prisma.fileObject.findFirst({ where: { ...(await libraryWhere({ workspace, user, membership })), id: fileId }, select: { filename: true } });
  return { title: file?.filename ?? "Files" };
}

const TEXT_PREVIEW_BYTES = 100_000;

async function textPreview(storageKey: string) {
  const object = await getObject(storageKey).catch(() => null);
  if (!object) return null;
  const slice = object.body.slice(0, TEXT_PREVIEW_BYTES);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(slice), truncated: object.body.byteLength > TEXT_PREVIEW_BYTES };
}

export default async function FilePage({ params }: PageProps<"/w/[workspaceSlug]/files/[fileId]">) {
  const { workspaceSlug, fileId } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const actor = { workspace, user, membership };
  const where = await libraryWhere(actor);
  const file = await prisma.fileObject.findFirst({
    where: { ...where, id: fileId },
    include: {
      uploadedBy: { select: { name: true } },
      doc: { select: { id: true, title: true, visibility: true } },
      task: { select: { id: true, number: true, title: true, project: { select: { key: true } } } },
      versions: { orderBy: { version: "desc" } },
    },
  });
  if (!file) notFound();
  const [folderRows, uploaders] = await Promise.all([
    prisma.fileObject.groupBy({ by: ["folder"], where }),
    prisma.user.findMany({ where: { id: { in: [...new Set(file.versions.map((v) => v.uploadedById).filter((id): id is string => Boolean(id)))] } }, select: { id: true, name: true } }),
  ]);
  const names = new Map(uploaders.map((person) => [person.id, person.name ?? "Former member"]));
  const kind = fileKind(file.contentType);
  const preview = kind === "text" ? await textPreview(file.storageKey) : null;
  const versions = listVersions(file, file.versions).map((version) => ({
    version: version.version,
    size: version.size,
    note: version.note ?? null,
    uploadedBy: version.uploadedById ? names.get(version.uploadedById) ?? file.uploadedBy?.name ?? "Former member" : "Former member",
    when: formatRelativeTime(version.createdAt, workspace.timezone),
  }));
  const contributor = canContribute(membership);
  const taskLabel = file.task ? `${file.task.project ? `${file.task.project.key}-` : "#"}${file.task.number} ${file.task.title}` : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={
          <Link href={`/w/${workspace.slug}/files${file.folder === "/" ? "" : `?folder=${encodeURIComponent(file.folder)}`}`} className="inline-flex items-center gap-1.5 hover:text-ink hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> {file.folder === "/" ? "All files" : file.folder}
          </Link>
        }
        title={<span className="break-all">{file.filename}</span>}
        description={`${FILE_KIND_LABEL[kind]} · ${formatBytes(file.size)} · version ${file.currentVersion}`}
      />
      <FileDetailActions
        slug={workspace.slug}
        file={{ id: file.id, filename: file.filename, folder: file.folder }}
        canEdit={contributor}
        canDelete={hasRoleAtLeast(membership.role, "ADMIN") || (contributor && file.uploadedById === user.id)}
        folders={folderRows.map((row) => row.folder)}
        links={{ doc: file.doc ? { id: file.doc.id, label: file.doc.title } : null, task: file.task && taskLabel ? { id: file.task.id, label: taskLabel } : null }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card padding="none" as="section" aria-label="Preview" className="overflow-hidden">
          {kind === "image" ? (
            <div className="flex justify-center bg-surface p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- private file served by the authorised file route */}
              <img src={fileUrl(file.id)} alt={file.filename} className="max-h-[70vh] max-w-full rounded-md object-contain" />
            </div>
          ) : kind === "pdf" ? (
            <div className="flex flex-col">
              <iframe src={fileUrl(file.id)} title={`Preview of ${file.filename}`} className="h-[70vh] w-full border-0 bg-surface" />
              <p className="border-t border-line px-5 py-3 text-caption text-ink-muted">
                No preview showing? <a href={fileUrl(file.id)} target="_blank" rel="noopener noreferrer" className="text-accent-text underline underline-offset-4">Open the PDF in a new tab</a>.
              </p>
            </div>
          ) : preview ? (
            <div className="flex flex-col">
              <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words bg-surface p-5 code-text text-sm text-ink">{preview.text}</pre>
              {preview.truncated ? <p className="border-t border-line px-5 py-3 text-caption text-ink-muted">Showing the first 100 KB. Download the file to see all of it.</p> : null}
            </div>
          ) : (
            <p className="px-5 py-10 text-center text-body-ui text-ink-muted">No preview for this type of file. Download it to open it.</p>
          )}
        </Card>
        <Card as="section" aria-label="Details">
          <DetailList
            items={[
              { label: "Folder", value: file.folder === "/" ? "All files" : file.folder },
              { label: "Uploaded by", value: file.uploadedBy?.name ?? "Former member" },
              { label: "Added", value: formatDayTime(file.createdAt, workspace.timezone) },
              { label: "Page", value: file.doc ? <Link href={`/w/${workspace.slug}/docs/${file.doc.id}`} className="text-accent-text underline underline-offset-4">{file.doc.title}</Link> : "None" },
              { label: "Task", value: taskLabel ?? "None" },
            ]}
          />
        </Card>
      </div>

      <FileVersions slug={workspace.slug} fileId={file.id} currentVersion={file.currentVersion} versions={versions} canEdit={contributor} />
    </div>
  );
}
