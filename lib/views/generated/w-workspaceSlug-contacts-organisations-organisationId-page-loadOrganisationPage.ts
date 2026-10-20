// Generated from app/w/[workspaceSlug]/contacts/organisations/[organisationId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewContacts } from "@/lib/roles";
import { getOrganisation } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadOrganisationPage({ params }: PageProps<"/w/[workspaceSlug]/contacts/organisations/[organisationId]">) {
const { workspaceSlug, organisationId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewContacts(ctx.membership)) notFound();
const organisation = await getOrganisation(ctx, organisationId);
if (!organisation) notFound();
const [teams, members] = await Promise.all([listTeams(ctx), listMembers(ctx)]);
return viewDto({ ctx, organisation, teams, members } as const);
}
