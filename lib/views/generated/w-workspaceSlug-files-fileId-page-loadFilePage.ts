// Generated from app/w/[workspaceSlug]/files/[fileId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { libraryWhere } from "@/lib/files/service";
import { fileKind, listVersions } from "@/lib/files/versions";
import { formatRelativeTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute } from "@/lib/roles";
import { getObject } from "@/lib/storage";
const TEXT_PREVIEW_BYTES = 100_000;
async function textPreview(storageKey: string) {
  const object = await getObject(storageKey).catch(() => null);
  if (!object) return null;
  const slice = object.body.slice(0, TEXT_PREVIEW_BYTES);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(slice), truncated: object.body.byteLength > TEXT_PREVIEW_BYTES };
}
export async function loadFilePage({ params }: PageProps<"/w/[workspaceSlug]/files/[fileId]">) {
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
return viewDto({ user, workspace, membership, file, folderRows, kind, preview, versions, contributor, taskLabel } as const);
}
