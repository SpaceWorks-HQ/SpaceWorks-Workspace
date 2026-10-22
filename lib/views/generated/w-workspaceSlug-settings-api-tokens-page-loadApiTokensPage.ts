// Generated from app/w/[workspaceSlug]/settings/api-tokens/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { canManageApiTokens, requireWorkspace } from "@/lib/permissions";
import { listApiTokens } from "@/lib/apiTokens";
import { notFound } from "next/navigation";

export async function loadApiTokensPage({ params }: PageProps<"/w/[workspaceSlug]/settings/api-tokens">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageApiTokens(membership)) notFound();
const tokens = await listApiTokens(workspace.id);
const now = new Date();
return viewDto({ workspace, tokens, now } as const);
}
