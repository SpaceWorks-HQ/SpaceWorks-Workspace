// Generated from app/w/[workspaceSlug]/assistant/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";

export async function loadAssistantLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/assistant">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
return viewDto({ workspace, membership } as const);
}
