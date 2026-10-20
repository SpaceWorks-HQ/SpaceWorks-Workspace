// Generated from app/w/[workspaceSlug]/vault/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canUseVault } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listVault } from "@/lib/vault/service";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";
import { type OpsField } from "@/components/requests/OpsForm";
import { choices } from "@/components/requests/OpsLayout";

export async function loadVaultPage({ params }: PageProps<"/w/[workspaceSlug]/vault">) {
const {workspaceSlug}=await params;
const a=await requireWorkspace(workspaceSlug,"MEMBER");
if(!canUseVault(a.membership))notFound();
const [items,pickers,collections,grants,logs]=await Promise.all([listVault(a),opsPickers(a),isAdmin(a)?prisma.vaultCollection.findMany({where:{workspaceId:a.workspace.id},select:{id:true,name:true}}):[],isAdmin(a)?prisma.vaultGrant.findMany({where:{workspaceId:a.workspace.id},take:200}):[],isAdmin(a)?prisma.vaultAccessLog.findMany({where:{workspaceId:a.workspace.id},orderBy:{createdAt:"desc"},take:50}):[]]);
const itemFields:OpsField[]=[{name:"title",label:"Item title",required:true},{name:"type",label:"Type",value:"LOGIN",required:true,options:choices(["LOGIN","API_KEY","SECRET_NOTE","SSH_KEY","CARD_REFERENCE","WIFI","TOTP"])},{name:"url",label:"Website",type:"url"},{name:"username",label:"Login username",helper:"Used only for login items."},{name:"secret",label:"Secret or card last four digits",type:"password",required:true,helper:"Card references accept exactly four digits. Never enter a full card number or security code."},{name:"sensitivity",label:"Sensitivity",value:"HIGH",required:true,options:[{value:"HIGH",label:"Sensitive — fresh MFA required"},{value:"NORMAL",label:"Normal — grant required"}]},{name:"rotateEveryDays",label:"Rotate every number of days",type:"number"},...(isAdmin(a)?[{name:"collectionId",label:"Collection",options:collections.map(c=>({value:c.id,label:c.name}))}]:[])];
return viewDto({ a, items, pickers, collections, grants, logs, itemFields } as const);
}
