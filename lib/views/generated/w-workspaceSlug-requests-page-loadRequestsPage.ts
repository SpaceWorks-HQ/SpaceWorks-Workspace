// Generated from app/w/[workspaceSlug]/requests/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canSubmitRequests } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/approvals/context";
import { listRequests, budgetTotals } from "@/lib/requests/service";
import { getApprovalView } from "@/lib/approvals/engine";
import { opsPickers } from "@/lib/approvals/pickers";

export async function loadRequestsPage({ params }: PageProps<"/w/[workspaceSlug]/requests">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canSubmitRequests(actor.membership)) notFound();
const [requests, budgets, pickers, policies] = await Promise.all([listRequests(actor), budgetTotals(actor), opsPickers(actor), isAdmin(actor) ? prisma.approvalPolicy.findMany({ where: { workspaceId: actor.workspace.id, isDefault: true } }) : []]);
const all = [...requests.purchases.map(r => ({ ...r, kind: "purchase_request" as const, owner: r.requesterId, files: r.fileIds })), ...requests.reimbursements.map(r => ({ ...r, kind: "reimbursement" as const, owner: r.claimantId, title: String((r.items as Array<{description?:string}>)[0]?.description ?? "Reimbursement"), files: r.receiptFileIds }))];
const approvals = new Map(await Promise.all(all.map(async r => [r.id, await getApprovalView(actor, r.kind === "purchase_request" ? "PURCHASE_REQUEST" : "REIMBURSEMENT", r.id)] as const)));
return viewDto({ actor, budgets, pickers, policies, all, approvals } as const);
}
