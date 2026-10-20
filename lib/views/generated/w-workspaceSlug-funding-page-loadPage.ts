// Generated from app/w/[workspaceSlug]/funding/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";

export async function loadPage({ params }: PageProps<"/w/[workspaceSlug]/funding">) {
const { workspaceSlug } = await params;
await requireWorkspace(workspaceSlug, "ADMIN");
redirect(`/w/${workspaceSlug}/funding/tracker`);

}
