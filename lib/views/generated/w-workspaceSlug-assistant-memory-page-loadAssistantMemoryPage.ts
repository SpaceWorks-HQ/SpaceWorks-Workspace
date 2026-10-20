// Generated from app/w/[workspaceSlug]/assistant/memory/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { searchMemories } from "@/lib/assistant/memory";
import { userNames } from "@/lib/assistant/tools/access";

export async function loadAssistantMemoryPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/assistant/memory">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const query = (await searchParams).q;
const q = typeof query === "string" ? query.slice(0, 200) : "";
const rows = await searchMemories(workspace.id, q, 100);
const names = await userNames(rows.map((r) => r.createdById));
const now = new Date();
return viewDto({ workspace, query, q, rows, names, now } as const);
}
