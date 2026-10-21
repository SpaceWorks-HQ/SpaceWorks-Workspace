import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { contactChannels, getContact, listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";
import { mutateContacts } from "@/app/actions/contacts";
import { ActionButton } from "@/components/people/AreaForms";
import { Card, CardHeader, Chip, PageHeader } from "@/components/ui/display";
import { ContactEditor } from "@/components/contacts/Editors";
import { ContactsNav, InteractionLog, RecordLinks } from "@/components/contacts/RelationshipViews";
import { TransferTools } from "@/components/contacts/TransferTools";
export const metadata = { title: "Contact" };
export default async function ContactPage({ params }: PageProps<"/w/[workspaceSlug]/contacts/[contactId]">) {
  const { workspaceSlug, contactId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewContacts(ctx.membership)) notFound();
  const contact = await getContact(ctx, contactId);
  if (!contact) notFound();
  const [orgs, teams, members] = await Promise.all([listOrganisations(ctx), listTeams(ctx), listMembers(ctx)]);
  const channels = contactChannels(contact);
  const phones = Array.isArray(contact.phones) ? contact.phones : [];
  const sensitivePhone = phones.some(p => p && typeof p === "object" && !Array.isArray(p) && p.sensitive === true);
  return <div className="flex min-w-0 flex-col gap-6">
    <PageHeader title={contact.displayName} description={contact.kinds.join(" · ")} /><ContactsNav slug={workspaceSlug} />
    <Card className="flex flex-col gap-3"><p className="break-all text-body-ui">{channels.email || "No email shared"}</p><p>{channels.phone || "No phone shared"}</p><div className="flex flex-wrap gap-2">{contact.tags.map(t => <Chip key={t}>{t}</Chip>)}{contact.doNotContact ? <Chip tone="warning">Do not contact</Chip> : null}</div><p className="whitespace-pre-wrap break-words text-body-ui">{contact.notesMd}</p>{contact.organisations.map(o => <Link className="flex min-h-11 items-center text-accent-text underline" href={`/w/${workspaceSlug}/contacts/organisations/${o.organisationId}`} key={o.organisationId}>{o.name}{o.title ? ` · ${o.title}` : ""}</Link>)}</Card>
    <div className="grid min-w-0 gap-6 md:grid-cols-2"><InteractionLog slug={workspaceSlug} timezone={ctx.workspace.timezone} contactId={contact.id} editable={contact.editable} interactions={contact.interactions} /><RecordLinks slug={workspaceSlug} fromType="contact" fromId={contact.id} editable={contact.editable} links={contact.links} /></div>
    {contact.editable ? <Card className="max-w-3xl"><details><summary className="min-h-11 cursor-pointer text-title">Edit contact</summary><ContactEditor slug={workspaceSlug} teams={teams} members={canManageContacts(ctx.membership) ? members : members.filter(m => m.id === ctx.user.id)} organisations={orgs} contact={{ ...contact, ...channels, sensitivePhone }} /></details></Card> : null}
    {canManageContacts(ctx.membership) ? <Card className="max-w-3xl"><CardHeader title="Export or remove contact" /><TransferTools slug={workspaceSlug} id={contact.id} /><div className="mt-6"><ActionButton action={mutateContacts.bind(null, workspaceSlug, "delete")} input={{ type: "contact", id: contact.id }} destructive confirm="Remove this contact?">Remove contact…</ActionButton></div></Card> : null}
  </div>;
}
