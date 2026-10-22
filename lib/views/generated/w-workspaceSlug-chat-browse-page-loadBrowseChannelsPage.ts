// Generated from app/w/[workspaceSlug]/chat/browse/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { browseChannels, listTeamOptions } from "@/lib/chat/queries";

export async function loadBrowseChannelsPage({ params }: PageProps<"/w/[workspaceSlug]/chat/browse">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const [channels, teams] = await Promise.all([browseChannels(ctx), listTeamOptions(ctx)]);
return viewDto({ channels, teams } as const);
}
