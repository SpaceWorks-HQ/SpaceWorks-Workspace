// Generated from app/w/[workspaceSlug]/contacts/[contactId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewContacts } from "@/lib/roles";
import { contactChannels, getContact, listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadContactPage({ params }: PageProps<"/w/[workspaceSlug]/contacts/[contactId]">) {
const { workspaceSlug, contactId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewContacts(ctx.membership)) notFound();
const contact = await getContact(ctx, contactId);
if (!contact) notFound();
const [orgs, teams, members] = await Promise.all([listOrganisations(ctx), listTeams(ctx), listMembers(ctx)]);
const channels = contactChannels(contact);
const phones = Array.isArray(contact.phones) ? contact.phones : [];
const sensitivePhone = phones.some(p => p && typeof p === "object" && !Array.isArray(p) && p.sensitive === true);
return viewDto({ ctx, contact, orgs, teams, members, channels, sensitivePhone } as const);
}
