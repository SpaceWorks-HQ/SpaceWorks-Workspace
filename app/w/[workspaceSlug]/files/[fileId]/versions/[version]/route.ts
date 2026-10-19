import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { notFoundResponse, routeActor } from "@/lib/files/request";
import { listVersions, selectVersion } from "@/lib/files/versions";
import { fileResponse } from "@/lib/storage";

export const dynamic = "force-dynamic";

/**
 * Download one version of a file (always as an attachment). Same access rule
 * as /api/files/[id] (lib/files.ts): active member of the file's workspace,
 * admins for admin-only docs, finance visibility for receipts. 404 otherwise.
 */
export async function GET(_request: Request, ctx: RouteContext<"/w/[workspaceSlug]/files/[fileId]/versions/[version]">) {
  const { workspaceSlug, fileId, version } = await ctx.params;
  const actor = await routeActor(workspaceSlug);
  if (!actor) return notFoundResponse();
  const downloadable = await findDownloadableFile(fileId, actor.user.id);
  if (!downloadable || downloadable.workspaceId !== actor.workspace.id) return notFoundResponse();
  const file = await prisma.fileObject.findUnique({
    where: { id: downloadable.id },
    select: { filename: true, currentVersion: true, storageKey: true, size: true, contentType: true, createdAt: true, uploadedById: true, versions: true },
  });
  if (!file) return notFoundResponse();
  const selected = selectVersion(listVersions(file, file.versions), Number(version));
  if (!selected) return notFoundResponse();
  const dot = file.filename.lastIndexOf(".");
  const filename = selected.version === file.currentVersion ? file.filename : dot > 0 ? `${file.filename.slice(0, dot)} (v${selected.version})${file.filename.slice(dot)}` : `${file.filename} (v${selected.version})`;
  return fileResponse({ storageKey: selected.storageKey, filename, contentType: selected.contentType, size: selected.size }, { download: true });
}
