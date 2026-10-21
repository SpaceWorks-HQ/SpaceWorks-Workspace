import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { contactChannels, listContacts, listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";
import { mutateContacts } from "@/app/actions/contacts";
import { Card, CardHeader, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { EditorForm } from "@/components/people/AreaForms";
import { ContactsNav, accessFields } from "@/components/contacts/RelationshipViews";
import { TransferTools } from "@/components/contacts/TransferTools";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
export const metadata = { title: "Contacts" };
export default async function ContactsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/contacts">) {
  const { workspaceSlug } = await params; const ctx = await requireWorkspace(workspaceSlug, "MEMBER"); if (!canViewContacts(ctx.membership)) notFound(); const q = await searchParams; const search = typeof q.q === "string" ? q.q : ""; const [contacts, orgs, teams, members] = await Promise.all([listContacts(ctx, search), listOrganisations(ctx), listTeams(ctx), listMembers(ctx)]);
  return <div className="flex flex-col gap-6"><PageHeader title="Contacts" description="Keep in touch with the people who support the community." /><ContactsNav slug={workspaceSlug} /><form className="flex flex-wrap items-end gap-3"><Field label="Search names or tags"><Input type="search" name="q" defaultValue={search} /></Field><Button variant="secondary" type="submit">Find contacts</Button></form>{contacts.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{contacts.map(c => <li key={c.id}><Card className="h-full"><Link href={`/w/${workspaceSlug}/contacts/${c.id}`} className="text-title text-accent-text underline">{c.displayName}</Link><p className="my-2 break-all text-body-ui text-ink-secondary">{contactChannels(c).email}</p><div className="flex flex-wrap gap-2">{c.tags.map(t => <Chip key={t}>{t}</Chip>)}{c.doNotContact ? <Chip tone="warning">Do not contact</Chip> : null}</div></Card></li>)}</ul> : <EmptyState patch title="No contacts yet. Add someone the crew should know." />}<Card className="max-w-3xl"><details><summary className="min-h-11 cursor-pointer text-title">Add contact</summary><EditorForm action={mutateContacts.bind(null, workspaceSlug, "contact")} label="Create contact" resetOnSuccess fields={[{ name: "displayName", label: "Name", required: true, maxLength: 160 }, { name: "email", label: "Email", type: "email" }, { name: "phone", label: "Phone", maxLength: 60 }, { name: "sensitivePhone", label: "Phone visible only to owner and admins", type: "checkbox" }, { name: "kinds", label: "Contact kinds", parse: "tags", helper: "For example: mentor, press, speaker, vendor-rep." }, { name: "organisationId", label: "Organisation", type: "select", parse: "nullable", options: [{ value: "", label: "No organisation" }, ...orgs.map(o => ({ value: o.id, label: o.name }))] }, { name: "nextFollowUpAt", label: "Next follow-up", type: "date", parse: "iso" }, ...accessFields(teams, canManageContacts(ctx.membership) ? members : members.filter(m => m.id === ctx.user.id))]} /></details></Card>{canManageContacts(ctx.membership) ? <Card className="max-w-3xl"><CardHeader title="Import and export" /><TransferTools slug={workspaceSlug} /></Card> : null}</div>;
}
