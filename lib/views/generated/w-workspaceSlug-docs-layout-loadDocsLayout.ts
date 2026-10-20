// Generated from app/w/[workspaceSlug]/docs/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { canCreateDocs } from "@/lib/docs/rules";
import { listDocTemplates, listTreeDocs } from "@/lib/docs/service";
import { requireWorkspace } from "@/lib/permissions";

export async function loadDocsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/docs">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug, "GUEST");
const actor = { workspace, user, membership };
const canCreate = canCreateDocs(membership);
const [tree, templates] = await Promise.all([listTreeDocs(workspace.id, membership.role), canCreate ? listDocTemplates(actor) : Promise.resolve([])]);
return viewDto({ workspace, membership, canCreate, tree, templates } as const);
}
