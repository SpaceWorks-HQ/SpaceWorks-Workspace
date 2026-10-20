// Generated from app/w/[workspaceSlug]/docs/[docId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { canSeeDoc, verificationState } from "@/lib/docs/rules";
import { ancestorIds } from "@/lib/docs/tree";
import { requireWorkspace } from "@/lib/permissions";
import { hasRoleAtLeast } from "@/lib/roles";

export async function loadDocPage({ params }: PageProps<"/w/[workspaceSlug]/docs/[docId]">) {
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
return viewDto({ user, workspace, membership, doc, members, breadcrumbs, state, editedBy, attachments } as const);
}
