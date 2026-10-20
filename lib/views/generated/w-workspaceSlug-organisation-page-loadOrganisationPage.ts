// Generated from app/w/[workspaceSlug]/organisation/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { orgData } from "@/lib/orgPeople/service";
import { indentedTree } from "@/lib/orgPeople/rules";
import { canManageOrgPeople } from "@/lib/roles";

export async function loadOrganisationPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ edit?: string; person?: string }> }) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const q = await searchParams;
const data = await orgData(actor);
const manager = canManageOrgPeople(actor.membership);
const editing = data.departments.find(d => d.id === q.edit);
const person = data.people.find(p => p.id === q.person);
const reports = data.people.filter(p => p.managerId === actor.user.id);
const tree = indentedTree(data.departments);
const reportingTree = indentedTree(data.people.map(p => ({ ...p, parentId: p.managerId })));
const base = `/w/${workspaceSlug}`;
return viewDto({ actor, data, manager, editing, person, reports, tree, reportingTree, base } as const);
}
