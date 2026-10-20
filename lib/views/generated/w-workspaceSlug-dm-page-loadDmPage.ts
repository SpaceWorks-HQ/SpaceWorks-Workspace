// Generated from app/w/[workspaceSlug]/dm/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { getSidebar } from "@/lib/chat/queries";

export async function loadDmPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/dm">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const { to } = await searchParams;
const startWith = (typeof to === "string" ? to.split(",") : [])
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== ctx.user.id)
    .slice(0, 7);
const sidebar = await getSidebar(ctx);
return viewDto({ startWith, sidebar } as const);
}
