// Generated from app/w/[workspaceSlug]/assistant/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { loadChatPage } from "@/lib/assistant/pageData";

export async function loadAssistantPage({ params }: PageProps<"/w/[workspaceSlug]/assistant">) {
const { workspaceSlug } = await params;
const { user, workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
const data = (await loadChatPage({ workspaceId: workspace.id, timeZone: workspace.timezone, userId: user.id, userEmail: user.email }))!;
return viewDto({ workspace, data } as const);
}
