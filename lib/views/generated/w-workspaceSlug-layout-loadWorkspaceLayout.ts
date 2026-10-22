// Generated from app/w/[workspaceSlug]/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { getShellData } from "@/lib/appShell";
import { touchLastSeen } from "@/lib/presence";
import { requireWorkspace } from "@/lib/permissions";

export async function loadWorkspaceLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]">) {
const { workspaceSlug } = await params;
const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
const data = await getShellData(user, workspace, membership);
await touchLastSeen(user.id);
return viewDto({ data } as const);
}
