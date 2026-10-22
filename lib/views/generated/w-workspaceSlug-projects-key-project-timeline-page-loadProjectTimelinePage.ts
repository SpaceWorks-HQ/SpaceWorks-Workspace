// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/timeline/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan } from "@/lib/projects/plusQueries";

export async function loadProjectTimelinePage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/timeline">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const plan = await getProjectPlan(context, key);
if (!plan) notFound();
return viewDto({ plan } as const);
}
