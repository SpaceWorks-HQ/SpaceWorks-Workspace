// Generated from app/w/[workspaceSlug]/docs/[docId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { canSeeDoc } from "@/lib/docs/rules";
import { requireWorkspace } from "@/lib/permissions";

export async function loadgenerateMetadata({ params }: PageProps<"/w/[workspaceSlug]/docs/[docId]">) {
const { workspaceSlug, docId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: workspace.id, archivedAt: null }, select: { title: true, visibility: true } });
return { title: doc && canSeeDoc(membership, doc) ? doc.title : "Docs" };

}
