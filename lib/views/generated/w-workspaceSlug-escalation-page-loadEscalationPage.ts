// Generated from app/w/[workspaceSlug]/escalation/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { escalationData } from "@/lib/orgPeople/service";
import { canManageOrgPeople } from "@/lib/roles";

export async function loadEscalationPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ q?: string; hours?: string; edit?: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const q = await searchParams;
const data = await escalationData(actor);
const manager = canManageOrgPeople(actor.membership);
const editing = data.paths.find(p => p.id === q.edit);
const paths = data.paths.filter(p => !q.q || p.title.toLowerCase().includes(q.q.toLowerCase().slice(0, 160)));
const base = `/w/${workspaceSlug}`;
return viewDto({ actor, data, manager, editing, paths, base } as const);
}
