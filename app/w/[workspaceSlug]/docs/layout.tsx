import { DocsShell } from "@/components/docs/DocsShell";
import { canCreateDocs, canManageDocVisibility } from "@/lib/docs/rules";
import { listDocTemplates, listTreeDocs } from "@/lib/docs/service";
import { requireWorkspace } from "@/lib/permissions";

/**
 * Docs frame with the page tree. Every docs page still calls
 * requireWorkspace itself (layouts do not re-run on client navigation).
 */
export default async function DocsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/docs">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
  const actor = { workspace, user, membership };
  const canCreate = canCreateDocs(membership);
  const [tree, templates] = await Promise.all([listTreeDocs(workspace.id, membership.role), canCreate ? listDocTemplates(actor) : Promise.resolve([])]);
  return (
    <DocsShell slug={workspace.slug} tree={tree} canCreate={canCreate} isAdmin={canManageDocVisibility(membership)} templates={templates}>
      {children}
    </DocsShell>
  );
}
