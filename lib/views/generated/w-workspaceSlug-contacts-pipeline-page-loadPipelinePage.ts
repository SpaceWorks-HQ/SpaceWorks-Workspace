// Generated from app/w/[workspaceSlug]/contacts/pipeline/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageContacts, canViewContacts } from "@/lib/roles";
import { listDeals, listOrganisations, STAGES } from "@/lib/contacts/contacts";
import { listMembers } from "@/lib/people/profiles";
import { currencyMinorDigits } from "@/lib/format/money";
import { type FormField } from "@/components/people/AreaForms";

export async function loadPipelinePage({ params }: PageProps<"/w/[workspaceSlug]/contacts/pipeline">) {
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
return viewDto({ ctx, deals, members, manage, editableOrgs } as const);
}
