// Generated from app/w/[workspaceSlug]/assets/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canUseAssets } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { listAssets } from "@/lib/assets/service";
import { isAdmin } from "@/lib/approvals/context";
import { opsPickers } from "@/lib/approvals/pickers";

export async function loadAssetsPage({ params }: PageProps<"/w/[workspaceSlug]/assets">) {
const {workspaceSlug}=await params;
const a=await requireWorkspace(workspaceSlug,"MEMBER");
if(!canUseAssets(a.membership))notFound();
const [rows,pickers,keys]=await Promise.all([listAssets(a),opsPickers(a),isAdmin(a)?prisma.accessCredential.findMany({where:{workspaceId:a.workspace.id},orderBy:{label:"asc"}}):[]]);
return viewDto({ a, rows, pickers, keys } as const);
}
