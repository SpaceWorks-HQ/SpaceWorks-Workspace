// Generated from app/w/[workspaceSlug]/pipeline/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/pipeline">) {
const { workspaceSlug } = await params;
await requireWorkspace(workspaceSlug, "MEMBER");
redirect(`/w/${workspaceSlug}/contacts/pipeline`);

}
