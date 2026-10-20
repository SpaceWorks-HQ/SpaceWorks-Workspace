// Generated from app/w/[workspaceSlug]/docs/[docId]/history/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canSeeDoc } from "@/lib/docs/rules";
import { formatDayTime } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";

export async function loadDocHistoryPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/docs/[docId]/history">) {
const { workspaceSlug, docId } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const doc = await prisma.doc.findFirst({ where: { id: docId, workspaceId: workspace.id, archivedAt: null }, select: { id: true, title: true, visibility: true } });
if (!doc || !canSeeDoc(membership, doc)) notFound();
const revisions = await prisma.docRevision.findMany({
    where: { docId: doc.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, createdAt: true, author: { select: { name: true } } },
  });
const requested = (await searchParams).rev;
const selectedId = typeof requested === "string" && revisions.some((revision) => revision.id === requested) ? requested : revisions[0]?.id;
const selected = selectedId ? await prisma.docRevision.findFirst({ where: { id: selectedId, docId: doc.id }, select: { id: true, title: true, contentHtml: true, createdAt: true } }) : null;
const isCurrent = selected?.id === revisions[0]?.id;
const label = selected ? formatDayTime(selected.createdAt, workspace.timezone) : "";
return viewDto({ workspace, membership, doc, revisions, selectedId, selected, isCurrent, label } as const);
}
