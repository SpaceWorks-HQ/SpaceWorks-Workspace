import { TransferTools } from "@/components/contacts/TransferTools";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { listOrganisations } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { ContactsNav } from "@/components/contacts/RelationshipViews";
import { OrganisationEditor } from "@/components/contacts/Editors";
export const metadata = { title: "Organisations" };
export default async function OrganisationsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/contacts/organisations">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewContacts(ctx.membership)) notFound();
  const query = await searchParams; const q = typeof query.q === "string" ? query.q : "";
  const [organisations, teams, members] = await Promise.all([listOrganisations(ctx, q), listTeams(ctx), listMembers(ctx)]);
  return <div className="flex flex-col gap-6"><PageHeader title="Organisations" description="Sponsors, partners, venues and everyone who helps us make things." /><ContactsNav slug={workspaceSlug} />
    <form className="flex flex-wrap items-end gap-3"><Field label="Search organisations"><Input type="search" name="q" defaultValue={q} /></Field><Button type="submit" variant="secondary">Find organisations</Button></form>
    {organisations.length ? <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{organisations.map(o => <li key={o.id}><Card className="flex h-full flex-col gap-3"><Link className="text-title text-primary underline" href={`/w/${workspaceSlug}/contacts/organisations/${o.id}`}>{o.name}</Link><p className="break-all text-body-ui text-ink-muted">{o.domain}</p><div className="flex flex-wrap gap-2">{o.kinds.map(k => <Chip key={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</Chip>)}{o.tags.map(t => <Chip key={t}>{t}</Chip>)}</div></Card></li>)}</ul> : <EmptyState title={q ? "No organisations match your search." : "No organisations yet. Add a community partner."} action={<a className="flex min-h-11 items-center text-primary underline" href="#new-organisation">Add organisation</a>} />}
    <Card id="new-organisation" className="max-w-3xl"><details open={!organisations.length}><summary className="min-h-11 cursor-pointer text-title">Add organisation</summary><OrganisationEditor slug={workspaceSlug} teams={teams} members={canManageContacts(ctx.membership) ? members : members.filter(m => m.id === ctx.user.id)} /></details></Card>
    {canManageContacts(ctx.membership) ? <Card className="max-w-3xl"><h2 className="mb-4 text-h4">Import and export</h2><TransferTools slug={workspaceSlug} dataset="organisations" /></Card> : null}
  </div>;
}
