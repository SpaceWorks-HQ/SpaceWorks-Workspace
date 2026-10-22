// Generated from app/w/[workspaceSlug]/files/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { libraryWhere, usageSummary } from "@/lib/files/service";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, hasRoleAtLeast } from "@/lib/roles";
import { maxUploadBytes, normalizeFolder } from "@/lib/storage";

export async function loadFilesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/files">) {
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
return viewDto({ user, workspace, folder, query, files, usage, deletedCount, allFolders, admin, contributor, uploadLimit } as const);
}
