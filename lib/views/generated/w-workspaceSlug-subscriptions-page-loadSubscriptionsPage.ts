// Generated from app/w/[workspaceSlug]/subscriptions/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canViewSubscriptions } from "@/lib/permissions";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { costTotals } from "@/lib/subscriptions/costs";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";
import { prisma } from "@/lib/db";
import { listPickableDestinations, getScopedDestinationIds } from "@/lib/notify/scopedRules";
import { type OpsField } from "@/components/requests/OpsForm";
import { choices } from "@/components/requests/OpsLayout";

export async function loadSubscriptionsPage({ params }: PageProps<"/w/[workspaceSlug]/subscriptions">) {
const { workspaceSlug } = await params;
const a = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewSubscriptions(a.membership)) notFound();
const [rows, pickers, destinations, services] = await Promise.all([listSubscriptions(a), opsPickers(a), isAdmin(a) ? listPickableDestinations(a.workspace.id,a.membership.role) : [], prisma.serviceCatalogItem.findMany({ where:{workspaceId:a.workspace.id},select:{id:true,name:true} })]);
const fields: OpsField[] = [{name:"name",label:"Name",required:true},{name:"amount",label:"Cost per billing cycle",required:true},{name:"currency",label:"Currency",value:a.workspace.currency,required:true},{name:"period",label:"Billing cycle",required:true,value:"MONTHLY",options:choices(["MONTHLY","QUARTERLY","YEARLY","ONE_TIME","USAGE"])},{name:"kind",label:"Type",value:"SAAS",required:true,options:choices(["DOMAIN","SAAS","HOSTING","INSURANCE","LICENSE","LEASE","MEMBERSHIP","OTHER"])},{name:"nextRenewalAt",label:"Next renewal",type:"date"},{name:"ownerId",label:"Owner",options:pickers.members},{name:"teamId",label:"Team",options:pickers.teams},{name:"serviceId",label:"Service",options:services.map(s=>({value:s.id,label:s.name}))},{name:"autoRenew",label:"Auto-renew",type:"checkbox",checked:true},{name:"reminderOffsets",label:"Remind days before renewal",value:"30,7,1",helper:"Separate days with commas."},{name:"status",label:"Status",value:"ACTIVE",required:true,options:choices(["ACTIVE","CANCELLING","CANCELLED","EXPIRED"])},{name:"destinationIds",label:"Send renewal reminders to",multiple:true,options:destinations.map(d=>({value:d.id,label:d.name}))}];
const scopedDestinations = new Map(await Promise.all(rows.map(async r => [r.id, await getScopedDestinationIds(a.workspace.id,"SUBSCRIPTION",r.id)] as const)));
const totals = costTotals(rows);
return viewDto({ a, rows, fields, scopedDestinations, totals } as const);
}
