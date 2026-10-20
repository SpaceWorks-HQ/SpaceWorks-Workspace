// Generated from app/w/[workspaceSlug]/responsibilities/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { orgData, responsibilities } from "@/lib/orgPeople/service";
import { orgFiles } from "@/lib/orgPeople/files";
import { canManageOrgPeople } from "@/lib/roles";

export async function loadResponsibilitiesPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ q?: string; status?: string; mine?: string; edit?: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const q = await searchParams;
const [data, rows] = await Promise.all([orgData(actor), responsibilities(actor, { q: q.q, status: ["ACTIVE", "PAUSED", "ARCHIVED"].includes(q.status ?? "") ? q.status : undefined, userId: q.mine === "1" ? actor.user.id : undefined })]);
const files = await orgFiles(actor, "responsibility", rows.map(r => r.id));
const manager = canManageOrgPeople(actor.membership);
const editing = rows.find(r => r.id === q.edit);
const base = `/w/${workspaceSlug}`;
return viewDto({ actor, data, rows, files, manager, editing, base } as const);
}
