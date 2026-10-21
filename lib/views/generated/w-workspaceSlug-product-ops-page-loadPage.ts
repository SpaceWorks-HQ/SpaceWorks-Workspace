// Generated from app/w/[workspaceSlug]/product-ops/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/product-ops">) {
const {workspaceSlug}=await params;
await requireWorkspace(workspaceSlug,"MEMBER");
redirect(`/w/${workspaceSlug}/product-ops/roadmap`);

}
