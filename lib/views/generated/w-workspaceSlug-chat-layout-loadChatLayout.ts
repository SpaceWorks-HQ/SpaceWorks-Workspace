// Generated from app/w/[workspaceSlug]/chat/layout.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { getChatShellData } from "@/lib/chat/queries";

export async function loadChatLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/chat">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const data = await getChatShellData(ctx);
return viewDto({ ctx, data } as const);
}
