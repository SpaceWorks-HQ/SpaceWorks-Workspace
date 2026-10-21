// Generated from app/w/[workspaceSlug]/projects/[key]/(project)/updates/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getProjectPlan, projectUpdates } from "@/lib/projects/plusQueries";

export async function loadProjectUpdatesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/projects/[key]/updates">) {
const { workspaceSlug, key } = await params;
const context = await requireWorkspace(workspaceSlug, "GUEST");
const plan = await getProjectPlan(context, key);
if (!plan) notFound();
const query = await searchParams;
const raw = Number(query.page ?? 0);
const page = Number.isSafeInteger(raw) ? Math.max(0, Math.min(10000, raw)) : 0;
const updates = page ? await projectUpdates(context, plan.projectId, page) : plan.updates;
return viewDto({ plan, page, updates } as const);
}
