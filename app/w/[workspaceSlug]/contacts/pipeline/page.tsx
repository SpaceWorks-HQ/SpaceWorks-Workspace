import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { listDeals, listOrganisations, STAGES } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { currencyMinorDigits, formatMoney } from "@/lib/format/money";
import { mutateContacts } from "@/app/actions/contacts";
import { EditorForm, type FormField } from "@/components/people/AreaForms";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/display";
import { ContactsNav } from "@/components/contacts/RelationshipViews";
export const metadata = { title: "Community pipeline" };
export default async function PipelinePage({ params }: PageProps<"/w/[workspaceSlug]/contacts/pipeline">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  if (!canViewContacts(ctx.membership)) notFound();
  const [deals, orgs, members] = await Promise.all([listDeals(ctx), listOrganisations(ctx), listMembers(ctx)]);
  const manage = canManageContacts(ctx.membership);
  const editableOrgs = orgs.filter(o => manage || o.ownerId === ctx.user.id || o.createdById === ctx.user.id);
  const fields = (deal?: typeof deals[number]): FormField[] => [
    { name: "title", label: "Opportunity", required: true, value: deal?.title, maxLength: 160 },
    { name: "organisationId", label: "Organisation", type: "select", value: deal?.organisationId, options: editableOrgs.map(o => ({ value: o.id, label: o.name })) },
    { name: "type", label: "Type", type: "select", value: deal?.type ?? "SPONSORSHIP", options: [{ value: "SPONSORSHIP", label: "Sponsorship" }, { value: "PARTNERSHIP", label: "Partnership" }, { value: "GRANT", label: "Grant" }, { value: "IN_KIND", label: "In kind" }, { value: "VENUE", label: "Venue" }] },
    { name: "stage", label: "Stage", type: "select", value: deal?.stage ?? "Prospect", options: STAGES.map(value => ({ value, label: value })) },
    { name: "amountMinor", label: "Value", parse: "money", value: deal?.amountMinor == null ? "" : String(deal.amountMinor / 10 ** currencyMinorDigits(deal.currency)), helper: "Enter the full currency amount, for example 1250.50." },
    { name: "currency", label: "Currency", value: deal?.currency ?? ctx.workspace.currency, maxLength: 3 },
    { name: "ownerId", label: "Owner", type: "select", parse: "nullable", value: deal?.ownerId ?? "", options: [{ value: "", label: "You" }, ...(manage ? members : members.filter(m => m.id === ctx.user.id)).map(m => ({ value: m.id, label: m.name }))] },
  ];
  return <div className="flex min-w-0 flex-col gap-6"><PageHeader title="Community pipeline" description="Track sponsorships and partnerships from first hello to shared plans." /><ContactsNav slug={workspaceSlug} />
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">{STAGES.map(stage => { const rows = deals.filter(d => d.stage === stage); return <section key={stage} aria-label={stage} className="min-w-0 rounded-xl border border-line bg-surface p-4"><h2 className="mb-4 text-h4">{stage} <span className="text-caption text-ink-muted">{rows.length}</span></h2><ul className="flex flex-col gap-3">{rows.map(d => <li key={d.id}><Card className="flex flex-col gap-3 p-4"><h3 className="break-words text-title">{d.title}</h3><Link className="min-h-11 text-accent-text underline" href={`/w/${workspaceSlug}/contacts/organisations/${d.organisationId}`}>{d.organisation.name}</Link><p className="text-body-ui tabular-nums">{d.amountMinor === null ? "Value to agree" : formatMoney(d.amountMinor, d.currency)}</p>{manage || d.ownerId === ctx.user.id ? <details><summary className="min-h-11 cursor-pointer text-label text-accent-text">Update opportunity</summary><EditorForm action={mutateContacts.bind(null, workspaceSlug, "deal")} fixed={{ id: d.id }} fields={fields(d)} /></details> : null}</Card></li>)}</ul>{!rows.length ? <p className="text-caption text-ink-muted">No opportunities here yet.</p> : null}</section>; })}</div>
    {editableOrgs.length ? <Card id="new-opportunity" className="max-w-3xl"><CardHeader title="Add an opportunity" /><EditorForm action={mutateContacts.bind(null, workspaceSlug, "deal")} label="Create opportunity" resetOnSuccess fields={fields()} /></Card> : <EmptyState patch title="Add an organisation to start an opportunity." action={<Link className="flex min-h-11 items-center text-accent-text underline" href={`/w/${workspaceSlug}/contacts/organisations`}>Add organisation</Link>} />}
  </div>;
}
