// Generated from app/w/[workspaceSlug]/chat/search/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";

export async function loadChatSearchPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/chat/search">) {
const { workspaceSlug } = await params;
await requireWorkspace(workspaceSlug, "GUEST");
const { q } = await searchParams;
const query = typeof q === "string" ? q.slice(0, 200) : "";
return viewDto({ query } as const);
}
