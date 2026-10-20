// Generated from app/w/[workspaceSlug]/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";

export async function loadgenerateMetadata({ params }: LayoutProps<"/w/[workspaceSlug]">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug);
return { title: { default: workspace.name, template: `%s · ${workspace.name}` } };

}
