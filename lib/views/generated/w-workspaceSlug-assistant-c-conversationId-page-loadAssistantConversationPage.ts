// Generated from app/w/[workspaceSlug]/assistant/c/[conversationId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadChatPage } from "@/lib/assistant/pageData";

export async function loadAssistantConversationPage({ params }: PageProps<"/w/[workspaceSlug]/assistant/c/[conversationId]">) {
const { workspaceSlug, conversationId } = await params;
const { user, workspace } = await requireWorkspace(workspaceSlug, "MEMBER");
const data = await loadChatPage({ workspaceId: workspace.id, timeZone: workspace.timezone, userId: user.id, userEmail: user.email, conversationId });
if (!data?.active) notFound();
const active = data.active;
return viewDto({ workspace, data, active } as const);
}
