// Generated from app/w/[workspaceSlug]/requests/approvals/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getApprovalView } from "@/lib/approvals/engine";

export async function loadApprovalsPage({ params }: PageProps<"/w/[workspaceSlug]/requests/approvals">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
const requests = await prisma.approvalRequest.findMany({ where: { workspaceId: actor.workspace.id, requesterId: actor.user.id, subjectType: { in: ["CUSTOM", "VAULT_ACCESS"] } }, orderBy: { createdAt: "desc" }, take: 100 });
const views = new Map(await Promise.all(requests.map(async r => [r.id, await getApprovalView(actor, r.subjectType, r.subjectId)] as const)));
return viewDto({ actor, requests, views } as const);
}
