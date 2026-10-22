import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { notFound } from "next/navigation";
import { requireWorkspace, canViewSubscriptions } from "@/lib/permissions";
import { listSubscriptions } from "@/lib/subscriptions/service";
import { costTotals } from "@/lib/subscriptions/costs";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";
import { prisma } from "@/lib/db";
import { listPickableDestinations, getScopedDestinationIds } from "@/lib/notify/scopedRules";
import { saveSubscriptionRecord } from "@/app/actions/subscriptions";
import { OpsForm, type OpsField } from "@/components/requests/OpsForm";
import { OpsLayout, Editor, Empty, choices, words } from "@/components/requests/OpsLayout";
import { Card, Chip } from "@/components/ui/display";
import { formatMoney, currencyMinorDigits } from "@/lib/format/money";
import { formatDate } from "@/lib/format/datetime";
export const metadata = { title: "Subscriptions" };
export default async function SubscriptionsPage({ params }: PageProps<"/w/[workspaceSlug]/subscriptions">) {
 const { workspaceSlug } = await params; const a = await requireWorkspace(workspaceSlug, "MEMBER"); if (!canViewSubscriptions(a.membership)) notFound();
 const [rows, pickers, destinations, services] = await Promise.all([listSubscriptions(a), opsPickers(a), isAdmin(a) ? listPickableDestinations(a.workspace.id,a.membership.role) : [], prisma.serviceCatalogItem.findMany({ where:{workspaceId:a.workspace.id},select:{id:true,name:true} })]);
 const fields: OpsField[] = [{name:"name",label:"Name",required:true},{name:"amount",label:"Cost per billing cycle",required:true},{name:"currency",label:"Currency",value:a.workspace.currency,required:true},{name:"period",label:"Billing cycle",required:true,value:"MONTHLY",options:choices(["MONTHLY","QUARTERLY","YEARLY","ONE_TIME","USAGE"])},{name:"kind",label:"Type",value:"SAAS",required:true,options:choices(["DOMAIN","SAAS","HOSTING","INSURANCE","LICENSE","LEASE","MEMBERSHIP","OTHER"])},{name:"nextRenewalAt",label:"Next renewal",type:"date"},{name:"ownerId",label:"Owner",options:pickers.members},{name:"teamId",label:"Team",options:pickers.teams},{name:"serviceId",label:"Service",options:services.map(s=>({value:s.id,label:s.name}))},{name:"autoRenew",label:"Auto-renew",type:"checkbox",checked:true},{name:"reminderOffsets",label:"Remind days before renewal",value:"30,7,1",helper:"Separate days with commas."},{name:"status",label:"Status",value:"ACTIVE",required:true,options:choices(["ACTIVE","CANCELLING","CANCELLED","EXPIRED"])},{name:"destinationIds",label:"Send renewal reminders to",multiple:true,options:destinations.map(d=>({value:d.id,label:d.name}))}];
 const scopedDestinations = new Map(await Promise.all(rows.map(async r => [r.id, await getScopedDestinationIds(a.workspace.id,"SUBSCRIPTION",r.id)] as const)));
 const totals = costTotals(rows);
 return <OpsLayout title="Subscriptions" description="Track recurring costs, ownership and renewal reminders." slug={workspaceSlug}>
  <div className="grid gap-4 sm:grid-cols-2">{Object.entries(totals).map(([c,t])=><Card key={c}><h2 className="text-label">{c} recurring costs</h2><p className="mt-2 text-title">{formatMoney(t.monthlyMinor,c)} / month</p><p className="text-body-ui text-ink-muted">{formatMoney(t.yearlyMinor,c)} / year</p></Card>)}</div><p className="text-caption text-ink-muted">Totals include active and cancelling recurring plans. One-time and usage costs are listed separately. Dates use {a.workspace.timezone}.</p>
  {isAdmin(a)&&<Editor title="Add subscription" open={!rows.length}><OpsForm action={saveSubscriptionRecord.bind(null,workspaceSlug)} fields={fields} label="Save subscription" /></Editor>}
  {!rows.length&&<Empty patch>No subscriptions yet. Add one to track its next renewal.</Empty>}
  {rows.map(r=>{ const scoped = scopedDestinations.get(r.id) ?? []; return <Card key={r.id} id={r.id}><div className="flex flex-wrap justify-between gap-3"><h2 className="text-title">{r.name}</h2><Chip>{words(r.status)}</Chip></div><p className="mt-3 text-body-ui">{r.amountMinor!=null ? `${formatMoney(r.amountMinor,r.currency)} · ${words(r.period)}` : "Costs are visible to admins"}</p><p className="text-body-ui text-ink-muted">{r.nextRenewalAt?`Renews ${formatDate(r.nextRenewalAt,a.workspace.timezone)}`:"No renewal date"} · {r.autoRenew?"Auto-renew on":"Auto-renew off"}</p>{isAdmin(a)&&<details className="mt-4"><summary className="min-h-11 cursor-pointer text-label">Edit subscription</summary><OpsForm action={saveSubscriptionRecord.bind(null,workspaceSlug)} label="Save changes" hidden={{id:r.id}} fields={fields.map(f=>({...f,value:f.name==="amount"?String((r.amountMinor??0)/10**currencyMinorDigits(r.currency)):f.name==="nextRenewalAt"?r.nextRenewalAt ? zonedDatetimeLocalValue(r.nextRenewalAt,a.workspace.timezone).slice(0,10) : "":f.name==="reminderOffsets"?r.reminderOffsets.join(","):f.name==="destinationIds"?scoped.join(","):String((r as Record<string,unknown>)[f.name]??""),checked:f.name==="autoRenew"?r.autoRenew:f.checked}))} /></details>}</Card>;})}
 </OpsLayout>;
}
