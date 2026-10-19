import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { getOrganisation } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";
import { mutateContacts } from "@/app/actions/contacts";
import { ActionButton } from "@/components/people/AreaForms";
import { Card, Chip, PageHeader } from "@/components/ui/display";
import { OrganisationEditor } from "@/components/contacts/Editors";
import { ContactsNav, InteractionLog, RecordLinks } from "@/components/contacts/RelationshipViews";
export const metadata = { title: "Organisation" };
export default async function OrganisationPage({ params }: PageProps<"/w/[workspaceSlug]/contacts/organisations/[organisationId]">) {
  const { workspaceSlug, organisationId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewContacts(ctx.membership)) notFound();
  const organisation = await getOrganisation(ctx, organisationId);
  if (!organisation) notFound();
  const [teams, members] = await Promise.all([listTeams(ctx), listMembers(ctx)]);
  return <div className="flex min-w-0 flex-col gap-6"><PageHeader title={organisation.name} description={organisation.kinds.map(k => k.charAt(0) + k.slice(1).toLowerCase()).join(" · ")} /><ContactsNav slug={workspaceSlug} />
    <Card className="flex flex-col gap-3"><Chip>{organisation.status.replaceAll("_", " ").toLowerCase()}</Chip>{organisation.website ? <a href={organisation.website} rel="noreferrer" target="_blank" className="min-h-11 break-all text-primary underline">{organisation.website}</a> : null}<p className="whitespace-pre-wrap break-words">{organisation.address}</p><p className="whitespace-pre-wrap break-words">{organisation.notesMd}</p><div className="flex flex-wrap gap-2">{organisation.tags.map(t => <Chip key={t}>{t}</Chip>)}</div>{organisation.contacts.map(c => <Link className="flex min-h-11 items-center text-primary underline" key={c.contactId} href={`/w/${workspaceSlug}/contacts/${c.contactId}`}>{c.name}{c.title ? ` · ${c.title}` : ""}</Link>)}</Card>
    <div className="grid min-w-0 gap-6 md:grid-cols-2"><InteractionLog slug={workspaceSlug} timezone={ctx.workspace.timezone} organisationId={organisation.id} editable={organisation.editable} interactions={organisation.interactions} /><RecordLinks slug={workspaceSlug} fromType="organisation" fromId={organisation.id} editable={organisation.editable} links={organisation.links} /></div>
    {organisation.editable ? <Card className="max-w-3xl"><details><summary className="min-h-11 cursor-pointer text-title">Edit organisation</summary><OrganisationEditor slug={workspaceSlug} teams={teams} members={canManageContacts(ctx.membership) ? members : members.filter(m => m.id === ctx.user.id)} organisation={organisation} /></details></Card> : null}
    {canManageContacts(ctx.membership) ? <ActionButton action={mutateContacts.bind(null, workspaceSlug, "delete")} input={{ type: "organisation", id: organisation.id }} destructive confirm="Remove this organisation from the directory and pipeline?">Remove organisation…</ActionButton> : null}
  </div>;
}
