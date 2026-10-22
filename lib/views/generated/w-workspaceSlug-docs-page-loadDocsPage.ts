// Generated from app/w/[workspaceSlug]/docs/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { canCreateDocs, VERIFY_DUE_SOON_DAYS } from "@/lib/docs/rules";
import { searchDocs, visibleDocsWhere } from "@/lib/docs/service";
import { requireWorkspace } from "@/lib/permissions";
function snippet(text: string, query: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const at = clean.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  const start = Math.max(0, at > 40 ? at - 40 : 0);
  const piece = clean.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${piece}${start + 180 < clean.length ? "…" : ""}`;
}
function reviewHorizon() {
  return new Date(Date.now() + VERIFY_DUE_SOON_DAYS * 86_400_000);
}
export async function loadDocsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/docs">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const search = await searchParams;
const query = typeof search.q === "string" ? search.q.trim().slice(0, 200) : "";
const visible = { ...visibleDocsWhere(workspace.id, membership.role), archivedAt: null };
const soon = reviewHorizon();
const [total, recent, review, results] = await Promise.all([
    prisma.doc.count({ where: visible }),
    prisma.doc.findMany({
      where: visible,
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, title: true, updatedAt: true, visibility: true, updatedBy: { select: { name: true } } },
    }),
    prisma.doc.findMany({
      where: { ...visible, verifiedUntil: { lte: soon }, OR: [{ verifiedById: user.id }, { verifiedById: null, createdById: user.id }] },
      orderBy: { verifiedUntil: "asc" },
      take: 10,
      select: { id: true, title: true, verifiedUntil: true },
    }),
    query ? searchDocs(workspace.id, membership.role, query) : Promise.resolve(null),
  ]);
const canCreate = canCreateDocs(membership);
return viewDto({ workspace, query, total, recent, review, results, canCreate } as const);
}
