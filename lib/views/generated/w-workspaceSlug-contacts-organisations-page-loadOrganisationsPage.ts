// Generated from app/w/[workspaceSlug]/contacts/organisations/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewContacts } from "@/lib/roles";
import { listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadOrganisationsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/contacts/organisations">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewContacts(ctx.membership)) notFound();
const query = await searchParams;
const q = typeof query.q === "string" ? query.q : "";
const [organisations, teams, members] = await Promise.all([listOrganisations(ctx, q), listTeams(ctx), listMembers(ctx)]);
return viewDto({ ctx, q, organisations, teams, members } as const);
}
