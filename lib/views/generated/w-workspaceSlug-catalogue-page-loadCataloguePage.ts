// Generated from app/w/[workspaceSlug]/catalogue/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canViewCatalogue } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listCatalogue } from "@/lib/catalogue/service";
import { listVault } from "@/lib/vault/service";
import { opsPickers } from "@/lib/approvals/pickers";
import { isAdmin } from "@/lib/approvals/context";
import { type OpsField } from "@/components/requests/OpsForm";
import { choices } from "@/components/requests/OpsLayout";

export async function loadCataloguePage({ params }: PageProps<"/w/[workspaceSlug]/catalogue">) {
const { workspaceSlug } = await params;
const a = await requireWorkspace(workspaceSlug,"MEMBER");
if (!canViewCatalogue(a.membership)) notFound();
const [rows,pickers,vault,monitors,resources] = await Promise.all([listCatalogue(a),opsPickers(a),listVault(a),prisma.monitor.findMany({where:{workspaceId:a.workspace.id},select:{id:true,name:true}}),prisma.cloudResource.findMany({where:{workspaceId:a.workspace.id},select:{id:true,name:true}})]);
const fields: OpsField[] = [{name:"name",label:"Service name",required:true},{name:"slug",label:"Short name",required:true,helper:"Lower-case words with hyphens."},{name:"kind",label:"Type",required:true,value:"INTERNAL_APP",options:choices(["INTERNAL_APP","WEBSITE","SAAS_ACCOUNT","DOMAIN","SERVER","DATABASE","STORAGE","REPO","BOT","DEVICE","OTHER"])},{name:"url",label:"URL",type:"url"},{name:"description",label:"Description",type:"textarea"},{name:"ownerId",label:"Owner",options:pickers.members},{name:"teamId",label:"Owning team",options:pickers.teams},{name:"environment",label:"Environment",required:true,value:"PROD",options:choices(["PROD","STAGING","DEV","NONE"])},{name:"criticality",label:"Criticality",required:true,value:"TIER2",options:[{value:"TIER1",label:"Tier 1 — critical"},{value:"TIER2",label:"Tier 2 — important"},{value:"TIER3",label:"Tier 3 — supporting"}]},{name:"lifecycle",label:"Lifecycle",value:"ACTIVE",required:true,options:choices(["PLANNED","ACTIVE","DEPRECATED","RETIRED"])},{name:"runbookDocId",label:"Runbook",options:pickers.docs},{name:"renewalAt",label:"Renewal or billing date",type:"date"},{name:"monitorIds",label:"Linked monitors",multiple:true,options:monitors.map(r=>({value:r.id,label:r.name}))},{name:"cloudResourceIds",label:"Linked cloud resources",multiple:true,options:resources.map(r=>({value:r.id,label:r.name}))},{name:"vaultItemIds",label:"Linked vault items",multiple:true,options:vault.map(r=>({value:r.id,label:r.title}))},...(isAdmin(a)?[{name:"amount",label:"Billing cost"},{name:"currency",label:"Currency",value:a.workspace.currency},{name:"costPeriod",label:"Billing cycle",options:choices(["MONTHLY","QUARTERLY","YEARLY","ONE_TIME","USAGE"])}]:[])];
return viewDto({ a, rows, pickers, monitors, resources, fields } as const);
}
