// Generated from app/w/[workspaceSlug]/helpdesk/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { members } from "@/lib/opsGaps/context";
import { requireWorkspace } from "@/lib/permissions";

export async function loadNewHelpTicketPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const handlers = (await members(actor)).filter(m=>["OWNER","ADMIN"].includes(m.role)).map(m=>({value:m.userId,label:m.user.name??"Admin"}));
return viewDto({ handlers } as const);
}
