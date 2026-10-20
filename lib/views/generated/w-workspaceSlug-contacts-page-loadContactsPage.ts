// Generated from app/w/[workspaceSlug]/contacts/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewContacts } from "@/lib/roles";
import { listContacts, listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadContactsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/contacts">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewContacts(ctx.membership)) notFound();
const q = await searchParams;
const search = typeof q.q === "string" ? q.q : "";
const [contacts, orgs, teams, members] = await Promise.all([listContacts(ctx, search), listOrganisations(ctx), listTeams(ctx), listMembers(ctx)]);
return viewDto({ ctx, search, contacts, orgs, teams, members } as const);
}
