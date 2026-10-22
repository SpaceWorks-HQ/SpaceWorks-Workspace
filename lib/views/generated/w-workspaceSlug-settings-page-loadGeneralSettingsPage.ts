// Generated from app/w/[workspaceSlug]/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";

export async function loadGeneralSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
return viewDto({ workspace } as const);
}
