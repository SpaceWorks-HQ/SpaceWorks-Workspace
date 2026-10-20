// Generated from app/w/[workspaceSlug]/files/[fileId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { libraryWhere } from "@/lib/files/service";
import { requireWorkspace } from "@/lib/permissions";
import { getObject } from "@/lib/storage";
const TEXT_PREVIEW_BYTES = 100_000;
async function textPreview(storageKey: string) {
  const object = await getObject(storageKey).catch(() => null);
  if (!object) return null;
  const slice = object.body.slice(0, TEXT_PREVIEW_BYTES);
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(slice), truncated: object.body.byteLength > TEXT_PREVIEW_BYTES };
}
export async function loadgenerateMetadata({ params }: PageProps<"/w/[workspaceSlug]/files/[fileId]">) {
const { workspaceSlug, fileId } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const file = await prisma.fileObject.findFirst({ where: { ...(await libraryWhere({ workspace, user, membership })), id: fileId }, select: { filename: true } });
return { title: file?.filename ?? "Files" };

}
