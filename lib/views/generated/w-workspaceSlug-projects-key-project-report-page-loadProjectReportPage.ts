// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/report/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan } from "@/lib/projects/plusQueries";

export async function loadProjectReportPage({ params }: PageProps<"/w/[workspaceSlug]/projects/[key]/report">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const plan = await getProjectPlan(context, key);
if (!plan) notFound();
const generatedAt = new Date().toISOString();
return viewDto({ plan, generatedAt } as const);
}
