// Generated from app/w/[workspaceSlug]/volunteering/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";

export async function loadNewHoursPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug,"MEMBER");
const max = zonedDatetimeLocalValue(new Date(),actor.workspace.timezone);
return viewDto({ actor, max } as const);
}
